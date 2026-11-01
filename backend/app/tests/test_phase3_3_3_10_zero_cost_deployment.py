import json
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.executor import ExecutionLoop
from backend.app.agent_runtime.llm.base import (
    LLMBudgetExceededError,
    LLMProvider,
    LLMRateLimitError,
    LLMResponse,
    LLMResponseError,
    LLMUnsupportedCapabilityError,
    LLMUsage,
    LLMZeroCostPolicyError,
    ToolCallRequest,
)
from backend.app.agent_runtime.llm.capabilities import (
    CapabilityRequirement,
    ModelCapabilities,
    ModelCapabilityRegistry,
    default_capability_registry,
)
from backend.app.agent_runtime.llm.complexity import TaskComplexityLevel
from backend.app.agent_runtime.llm.cost_controller import CloudCostController
from backend.app.agent_runtime.llm.factory import (
    create_hybrid_llm_router,
    inspect_provider_configuration,
)
from backend.app.agent_runtime.llm.health_monitor import ProviderHealthMonitor
from backend.app.agent_runtime.llm.openai_provider import OpenAIProvider
from backend.app.agent_runtime.llm.router import HybridLLMRouter
from backend.app.agent_runtime.orchestrator.multi_agent_orchestrator import (
    MultiAgentOrchestrator,
)
from backend.app.agent_runtime.policies.engine import PolicyEngine
from backend.app.agent_runtime.policies.permissions import AgentPolicy
from backend.app.agent_runtime.tools.base import ToolPermissionLevel
from backend.app.agent_runtime.tools.registry import default_tool_registry
from backend.app.agent_runtime.verifier import ResultVerifier
from backend.app.core.config import settings
from backend.app.models.agent import AgentModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.task import TaskModel
from backend.app.services.workstation_service import workstation_service
from backend.app.tests.test_phase3_3_3_8_hybrid_llm_routing import MockLiveProvider


# ---------------------------------------------------------------------------
# 1. Model Configuration & OpenRouter require_parameters=true
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_1_zero_cost_model_configuration_and_require_parameters(monkeypatch):
    assert settings.LLM_ROUTING_MODE == "hybrid"
    assert settings.LLM_CLOUD_PROVIDER == "openrouter"
    assert settings.LLM_CLOUD_MODEL == "google/gemma-4-31b-it:free"
    assert settings.LLM_ALLOW_CLOUD_FALLBACK is False
    assert settings.LLM_ZERO_COST_POLICY is True

    cfg = inspect_provider_configuration("openrouter")
    assert cfg["provider"] == "openrouter"
    assert cfg["base_url"] == "https://openrouter.ai/api/v1"
    assert cfg["model"] == "google/gemma-4-31b-it:free"

    # Verify OpenAIProvider sends provider={"require_parameters": True, "allow_fallbacks": False} for OpenRouter
    captured_payloads: List[Dict[str, Any]] = []

    async def _fake_post(url: str, headers: Dict[str, str], json: Dict[str, Any]):
        captured_payloads.append(json)
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = {
            "model": "google/gemma-4-31b-it:free",
            "choices": [
                {
                    "message": {"role": "assistant", "content": '{"status": "ok"}'},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 25, "completion_tokens": 10, "total_tokens": 35, "cost": 0.0},
        }
        return resp

    provider = OpenAIProvider(
        api_key="sk-or-v1-redactedtestkey",
        base_url="https://openrouter.ai/api/v1",
        model="google/gemma-4-31b-it:free",
        provider_name="openrouter",
    )
    with patch("httpx.AsyncClient.post", side_effect=_fake_post):
        res = await provider.generate(
            messages=[{"role": "user", "content": "Ping"}],
            tools=[{"type": "function", "function": {"name": "workspace_list"}}],
        )

    assert len(captured_payloads) == 1
    sent = captured_payloads[0]
    assert sent["model"] == "google/gemma-4-31b-it:free"
    assert sent["provider"] == {"require_parameters": True}
    assert res.usage.is_free_model is True
    assert res.usage.actual_inference_cost_usd == 0.0
    assert res.usage.estimated_cost_usd == 0.0


# ---------------------------------------------------------------------------
# 2. Absolute Zero-Cost Policy Enforcement (Fail-Closed)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_2_absolute_zero_cost_policy_rejects_paid_unverified_and_auto_models():
    reg = ModelCapabilityRegistry()

    # 1. Primary free model is permitted
    ok_free, _ = reg.validate_zero_cost_model("openrouter", "google/gemma-4-31b-it:free")
    assert ok_free is True

    # 2. Paid models (GPT, Claude, Gemini, Llama paid) are rejected
    for paid_provider, paid_model in [
        ("openrouter", "openai/gpt-4o-mini"),
        ("openrouter", "openai/gpt-4o"),
        ("openrouter", "anthropic/claude-3.5-sonnet"),
        ("openrouter", "google/gemini-2.5-flash"),
        ("openrouter", "meta-llama/llama-3.3-70b-instruct"),
        ("openai", "gpt-4o-mini"),
        ("gemini", "gemini-2.0-flash"),
    ]:
        ok, reason = reg.validate_zero_cost_model(paid_provider, paid_model)
        assert ok is False
        assert "ZERO_COST_POLICY_VIOLATION" in reason

    # 3. Missing or unverifiable pricing is rejected
    ok_unverified, reason_unv = reg.validate_zero_cost_model(
        "openrouter", "unknown-vendor/mystery-model:free"
    )
    assert ok_unverified is False
    assert "missing or unverifiable token pricing" in reason_unv

    # 4. openrouter/auto is rejected
    ok_auto, reason_auto = reg.validate_zero_cost_model("openrouter", "openrouter/auto")
    assert ok_auto is False
    assert "forbidden" in reason_auto

    # 5. Generic OpenRouter model ID without ':free' suffix is rejected even if registered with $0
    reg.register_model(
        ModelCapabilities(
            provider="openrouter",
            model_id="google/gemma-4-31b-it",
            is_free=True,
            pricing_verified=True,
            input_price_per_1m_usd=0.0,
            output_price_per_1m_usd=0.0,
        )
    )
    ok_generic, reason_gen = reg.validate_zero_cost_model("openrouter", "google/gemma-4-31b-it")
    assert ok_generic is False
    assert "without ':free' suffix" in reason_gen

    # 6. Router fail-closed behavior: failed free request or paid candidate NEVER triggers a paid call
    cost_ctrl = CloudCostController()
    paid_cloud = MockLiveProvider("openrouter", "openai/gpt-4o-mini", estimated_cost_usd=0.002)
    router = HybridLLMRouter(
        local_provider=None,
        cloud_provider=paid_cloud,
        allow_cloud_fallback=False,
        zero_cost_only=True,
        organization_id="org-zc-strict",
        task_id="task-zc-1",
        agent_id="agent-exec-ceo",
        cost_controller=cost_ctrl,
        health_monitor=ProviderHealthMonitor(),
        capability_registry=reg,
    )
    with pytest.raises(LLMZeroCostPolicyError, match="ZERO_COST_POLICY_VIOLATION"):
        await router.generate(messages=[{"role": "user", "content": "Attempt paid call"}])

    assert paid_cloud.generate_calls == 0
    summary = cost_ctrl.get_organization_summary("org-zc-strict")
    assert summary["organization"]["rejected_paid_model_requests"] == 1
    assert summary["tasks"]["task-zc-1"]["rejected_paid_model_requests"] == 1


# ---------------------------------------------------------------------------
# 3. Model Capability Validation for google/gemma-4-31b-it:free
# ---------------------------------------------------------------------------
def test_3_gemma_4_31b_free_capability_validation():
    cap = default_capability_registry.get_capabilities("openrouter", "google/gemma-4-31b-it:free")
    assert cap.text_generation is True
    assert cap.tool_calling is True
    assert cap.multi_tool_calling is True
    assert cap.multi_turn_tool_execution is True
    assert cap.structured_output is True
    assert cap.json_mode is True
    assert cap.long_context is True
    assert cap.max_context_tokens == 262144
    assert cap.is_free is True
    assert cap.pricing_verified is True
    assert cap.input_price_per_1m_usd == 0.0
    assert cap.output_price_per_1m_usd == 0.0
    assert cap.provider_available is True

    # Verify live catalog parser on OpenRouter's exact google/gemma-4-31b-it:free metadata
    parsed = ModelCapabilityRegistry.parse_openrouter_catalog_entry(
        {
            "id": "google/gemma-4-31b-it:free",
            "context_length": 262144,
            "pricing": {"prompt": "0", "completion": "0"},
            "supported_parameters": [
                "include_reasoning",
                "max_tokens",
                "reasoning",
                "response_format",
                "seed",
                "temperature",
                "tool_choice",
                "tools",
                "top_p",
            ],
        }
    )
    assert parsed.is_free is True
    assert parsed.pricing_verified is True
    assert parsed.input_price_per_1m_usd == 0.0
    assert parsed.output_price_per_1m_usd == 0.0
    assert parsed.tool_calling is True
    assert parsed.multi_tool_calling is True
    assert parsed.structured_output is True
    assert parsed.max_context_tokens == 262144


# ---------------------------------------------------------------------------
# 4. Zero-Cost Routing across LOW, MEDIUM, HIGH & Unsupported Capability
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_4_zero_cost_routing_low_medium_high_and_unsupported_capability():
    cost_ctrl = CloudCostController()

    # Case A: LOW complexity uses local provider when healthy; otherwise uses verified free cloud model
    local_ok = MockLiveProvider("ollama", "qwen2.5:3b")
    free_cloud = MockLiveProvider("openrouter", "google/gemma-4-31b-it:free")
    router_low_local = HybridLLMRouter(
        local_provider=local_ok,
        cloud_provider=free_cloud,
        allow_cloud_fallback=False,
        zero_cost_only=True,
        organization_id="org-zc-route",
        task_id="task-low-1",
        cost_controller=cost_ctrl,
        health_monitor=ProviderHealthMonitor(),
    )
    resp_low_1 = await router_low_local.generate(
        messages=[{"role": "user", "content": "Quick status check."}],
        explicit_complexity=TaskComplexityLevel.LOW,
    )
    assert resp_low_1.provider == "ollama"
    assert local_ok.generate_calls == 1
    assert free_cloud.generate_calls == 0

    # When local provider is unavailable, LOW complexity uses verified free cloud model
    local_down = MockLiveProvider("ollama", "qwen2.5:3b", healthy=False, health_error="Ollama not installed")
    router_low_cloud = HybridLLMRouter(
        local_provider=local_down,
        cloud_provider=free_cloud,
        allow_cloud_fallback=False,
        zero_cost_only=True,
        organization_id="org-zc-route",
        task_id="task-low-2",
        cost_controller=cost_ctrl,
        health_monitor=ProviderHealthMonitor(),
    )
    resp_low_2 = await router_low_cloud.generate(
        messages=[{"role": "user", "content": "Quick status check."}],
        explicit_complexity=TaskComplexityLevel.LOW,
    )
    assert resp_low_2.provider == "openrouter"
    assert resp_low_2.model == "google/gemma-4-31b-it:free"
    assert resp_low_2.routing_metadata["actual_inference_cost_usd"] == 0.0
    assert free_cloud.generate_calls == 1

    # Case B: MEDIUM complexity routes directly to verified free cloud model
    resp_med = await router_low_local.generate(
        messages=[{"role": "user", "content": "Standard report synthesis with workspace tools."}],
        tools=[{"type": "function", "function": {"name": "workspace_list"}}],
        explicit_complexity=TaskComplexityLevel.MEDIUM,
    )
    assert resp_med.provider == "openrouter"
    assert resp_med.model == "google/gemma-4-31b-it:free"
    assert free_cloud.generate_calls == 2

    # Case C: HIGH complexity routes to verified free cloud model when capabilities match
    resp_high = await router_low_local.generate(
        messages=[{"role": "user", "content": "Multi-agent DAG orchestration and security review."}],
        tools=[{"type": "function", "function": {"name": "workspace_list"}}],
        explicit_complexity=TaskComplexityLevel.HIGH,
    )
    assert resp_high.provider == "openrouter"
    assert resp_high.model == "google/gemma-4-31b-it:free"
    assert free_cloud.generate_calls == 3

    # Case D: If free model lacks required capability (e.g. text-only free model on tool task), raises LLMUnsupportedCapabilityError
    reg_custom = ModelCapabilityRegistry()
    reg_custom.register_model(
        ModelCapabilities(
            provider="openrouter",
            model_id="vendor/text-only:free",
            text_generation=True,
            tool_calling=False,
            is_free=True,
            pricing_verified=True,
            input_price_per_1m_usd=0.0,
            output_price_per_1m_usd=0.0,
        )
    )
    text_only_free = MockLiveProvider("openrouter", "vendor/text-only:free")
    router_unsupported = HybridLLMRouter(
        local_provider=None,
        cloud_provider=text_only_free,
        allow_cloud_fallback=False,
        zero_cost_only=True,
        capability_registry=reg_custom,
        cost_controller=cost_ctrl,
        health_monitor=ProviderHealthMonitor(),
    )
    with pytest.raises(LLMUnsupportedCapabilityError, match="UNSUPPORTED_CAPABILITY"):
        await router_unsupported.generate(
            messages=[{"role": "user", "content": "Call workspace_list"}],
            tools=[{"type": "function", "function": {"name": "workspace_list"}}],
            explicit_complexity=TaskComplexityLevel.HIGH,
        )
    assert text_only_free.generate_calls == 0


# ---------------------------------------------------------------------------
# 5. Cost Accounting & Nonzero Cost Emergency Halt Circuit Breaker
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_5_nonzero_cost_emergency_halt_circuit_breaker():
    cost_ctrl = CloudCostController()

    # 1. Normal free call records actual_inference_cost_usd = 0.0 and free_model_requests = 1
    free_ok = MockLiveProvider(
        "openrouter",
        "google/gemma-4-31b-it:free",
        prompt_tokens=250,
        completion_tokens=100,
        actual_cost_usd=0.0,
    )
    router = HybridLLMRouter(
        local_provider=None,
        cloud_provider=free_ok,
        zero_cost_only=True,
        organization_id="org-halt-test",
        task_id="task-halt-1",
        agent_id="agent-exec-ceo",
        cost_controller=cost_ctrl,
        health_monitor=ProviderHealthMonitor(),
    )
    resp = await router.generate(
        messages=[{"role": "user", "content": "Free inference call"}],
        explicit_complexity=TaskComplexityLevel.MEDIUM,
    )
    assert resp.routing_metadata["actual_inference_cost_usd"] == 0.0
    assert resp.routing_metadata["is_free_model"] is True

    summary = cost_ctrl.get_organization_summary("org-halt-test")
    assert summary["organization"]["free_model_requests"] == 1
    assert summary["organization"]["actual_inference_cost_usd"] == 0.0

    # 2. If OpenRouter unexpectedly reports a nonzero cost (> $0.00), trigger emergency halt immediately!
    rogue_nonzero = MockLiveProvider(
        "openrouter",
        "google/gemma-4-31b-it:free",
        prompt_tokens=200,
        completion_tokens=80,
        actual_cost_usd=0.00042,
    )
    router_rogue = HybridLLMRouter(
        local_provider=None,
        cloud_provider=rogue_nonzero,
        zero_cost_only=True,
        organization_id="org-halt-test",
        task_id="task-halt-1",
        agent_id="agent-exec-ceo",
        cost_controller=cost_ctrl,
        health_monitor=ProviderHealthMonitor(),
    )
    with pytest.raises(LLMBudgetExceededError, match="CRITICAL_ZERO_COST_ALERT"):
        await router_rogue.generate(
            messages=[{"role": "user", "content": "Call that unexpectedly billed"}],
            explicit_complexity=TaskComplexityLevel.MEDIUM,
        )

    # 3. Subsequent cloud calls for that organization are blocked BEFORE calling the provider
    with pytest.raises(LLMBudgetExceededError, match="CRITICAL_ZERO_COST_ALERT"):
        await router.generate(
            messages=[{"role": "user", "content": "Subsequent call must be blocked"}],
            explicit_complexity=TaskComplexityLevel.MEDIUM,
        )
    # free_ok was NOT called a second time
    assert free_ok.generate_calls == 1


# ---------------------------------------------------------------------------
# 6. Rate-Limit Handling (HTTP 429, Retry-After, Bounded Backoff, Daily Quota)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_6_rate_limit_retry_after_bounded_backoff_and_daily_quota(monkeypatch):
    # 1. Verify OpenAIProvider parses Retry-After header on HTTP 429 and bounds retries
    resp_429 = MagicMock(spec=httpx.Response)
    resp_429.status_code = 429
    resp_429.headers = {"Retry-After": "0.05"}
    resp_429.text = "Rate limit exceeded"

    resp_200 = MagicMock(spec=httpx.Response)
    resp_200.status_code = 200
    resp_200.json.return_value = {
        "model": "google/gemma-4-31b-it:free",
        "choices": [{"message": {"role": "assistant", "content": "Recovered after 429"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15, "cost": 0.0},
    }

    provider = OpenAIProvider(
        api_key="sk-or-v1-ratelimittest",
        base_url="https://openrouter.ai/api/v1",
        model="google/gemma-4-31b-it:free",
        provider_name="openrouter",
        max_retries=1,
        retry_base_delay_seconds=0.05,
    )
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=[resp_429, resp_200]):
        recovered = await provider.generate(messages=[{"role": "user", "content": "Test 429 retry"}])
        assert recovered.content == "Recovered after 429"

    # Exhausting retries raises LLMRateLimitError with retry_after_seconds and records rate_limit_failures
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=[resp_429, resp_429]):
        cost_ctrl = CloudCostController()
        router = HybridLLMRouter(
            local_provider=None,
            cloud_provider=provider,
            zero_cost_only=True,
            organization_id="org-rl-test",
            task_id="task-rl-1",
            cost_controller=cost_ctrl,
            health_monitor=ProviderHealthMonitor(),
        )
        # Mark health monitor healthy so generate() is reached
        router.health_monitor.record_inference_success("openrouter", "google/gemma-4-31b-it:free", latency_ms=5.0)
        with pytest.raises(LLMRateLimitError) as exc_info:
            await router.generate(
                messages=[{"role": "user", "content": "Persistent 429"}],
                explicit_complexity=TaskComplexityLevel.MEDIUM,
            )
        assert exc_info.value.retry_after_seconds == 0.05
        org_summary = cost_ctrl.get_organization_summary("org-rl-test")["organization"]
        assert org_summary["rate_limit_failures"] == 1
        assert "RATE_LIMITED" in org_summary["rate_limit_status"]

    # 2. Daily organization request quota enforcement (never switches to paid model)
    monkeypatch.setattr(settings, "MAX_ORGANIZATION_DAILY_CLOUD_REQUESTS", 2)
    cost_ctrl_quota = CloudCostController()
    free_prov = MockLiveProvider("openrouter", "google/gemma-4-31b-it:free")
    router_quota = HybridLLMRouter(
        local_provider=None,
        cloud_provider=free_prov,
        zero_cost_only=True,
        organization_id="org-daily-req-quota",
        task_id="task-q",
        cost_controller=cost_ctrl_quota,
        health_monitor=ProviderHealthMonitor(),
    )
    await router_quota.generate(messages=[{"role": "user", "content": "Call 1"}], explicit_complexity=TaskComplexityLevel.MEDIUM)
    await router_quota.generate(messages=[{"role": "user", "content": "Call 2"}], explicit_complexity=TaskComplexityLevel.MEDIUM)
    with pytest.raises(LLMBudgetExceededError, match="daily cloud request budget exhausted"):
        await router_quota.generate(messages=[{"role": "user", "content": "Call 3"}], explicit_complexity=TaskComplexityLevel.MEDIUM)
    assert free_prov.generate_calls == 2
    assert cost_ctrl_quota.get_organization_summary("org-daily-req-quota")["organization"]["rate_limit_status"] == "DAILY_QUOTA_EXHAUSTED"


# ---------------------------------------------------------------------------
# 7. Multi-Tool & Multi-Turn Execution + 3D Office Integration (Sections 8 & 9)
# ---------------------------------------------------------------------------
class _GemmaFreeMultiTurnWorkflowProvider(LLMProvider):
    """
    Simulates google/gemma-4-31b-it:free across:
    - CEO workflow DAG decomposition
    - Multi-tool & multi-turn specialist execution (workspace_list + workspace_write -> verification_tool -> final report)
    """

    provider_name = "openrouter"
    model = "google/gemma-4-31b-it:free"
    is_live_provider = True

    def __init__(self) -> None:
        self.calls = 0

    async def check_health(self):
        from backend.app.agent_runtime.llm.base import LLMHealthCheckResult

        return LLMHealthCheckResult(
            healthy=True,
            provider=self.provider_name,
            model=self.model,
            base_url="https://openrouter.ai/api/v1",
            is_live_provider=True,
            latency_ms=8.0,
        )

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
    ) -> LLMResponse:
        self.calls += 1
        prompt_text = "\n".join(str(m.get("content") or "") for m in messages)
        tool_msgs = [m for m in messages if m.get("role") == "tool"]

        # 1. CEO MultiAgentPlanner workflow decomposition prompt
        if "subtasks" in prompt_text.lower() and not tools:
            plan_json = {
                "goal": "Prepare verified zero-cost market strategy report",
                "subtasks": [
                    {
                        "subtask_key": "write_market_report",
                        "title": "Synthesize & Write Market Strategy Report",
                        "description": "Write zero_cost_market_report.md to workspace_sandbox and verify it.",
                        "agent_type": "writer",
                        "dependencies": [],
                        "priority": "high",
                        "expected_output": "Verified market report file in workspace_sandbox",
                    },
                    {
                        "subtask_key": "review_report",
                        "title": "Verify & Consolidate Market Strategy Report",
                        "description": "Verify zero_cost_market_report.md and produce executive review.",
                        "agent_type": "reviewer",
                        "dependencies": ["write_market_report"],
                        "priority": "high",
                        "expected_output": "Quality verification verdict",
                    },
                ],
            }
            return LLMResponse(
                content=json.dumps(plan_json),
                tool_calls=[],
                usage=LLMUsage(
                    prompt_tokens=150,
                    completion_tokens=90,
                    total_tokens=240,
                    estimated_cost_usd=0.0,
                    actual_cost_usd=0.0,
                    is_estimated_cost=False,
                    is_free_model=True,
                    provider=self.provider_name,
                    model=self.model,
                ),
                provider=self.provider_name,
                model=self.model,
                is_live_provider=True,
            )

        # 2. Specialist Turn 1: invoke multiple tools (workspace_list + workspace_write)
        if tools and len(tool_msgs) == 0:
            allowed_names = {t.get("function", {}).get("name") for t in tools if isinstance(t, dict)}
            emitted: List[ToolCallRequest] = []
            if "workspace_list" in allowed_names:
                emitted.append(
                    ToolCallRequest(
                        tool_name="workspace_list",
                        arguments={"subpath": "", "max_depth": 1},
                        call_id=f"call_zc_{self.calls}_1",
                    )
                )
            if "workspace_write" in allowed_names:
                emitted.append(
                    ToolCallRequest(
                        tool_name="workspace_write",
                        arguments={
                            "filepath": "zero_cost_market_report.md",
                            "content": "# Zero-Cost Market Strategy Report\n\nVerified $0.00 OpenRouter Gemma 4 31B execution.\n",
                        },
                        call_id=f"call_zc_{self.calls}_2",
                    )
                )
            if emitted:
                return LLMResponse(
                    content=None,
                    tool_calls=emitted,
                    usage=LLMUsage(
                        prompt_tokens=180,
                        completion_tokens=60,
                        total_tokens=240,
                        estimated_cost_usd=0.0,
                        actual_cost_usd=0.0,
                        is_estimated_cost=False,
                        is_free_model=True,
                        provider=self.provider_name,
                        model=self.model,
                    ),
                    provider=self.provider_name,
                    model=self.model,
                    is_live_provider=True,
                )

        # 3. Specialist Turn 2: invoke verification_tool if available and not yet called
        called_tool_names = {m.get("name") for m in tool_msgs}
        if tools and "verification_tool" not in called_tool_names:
            allowed_names = {t.get("function", {}).get("name") for t in tools if isinstance(t, dict)}
            if "verification_tool" in allowed_names:
                return LLMResponse(
                    content=None,
                    tool_calls=[
                        ToolCallRequest(
                            tool_name="verification_tool",
                            arguments={"filepath": "zero_cost_market_report.md"},
                            call_id=f"call_zc_{self.calls}_verify",
                        )
                    ],
                    usage=LLMUsage(
                        prompt_tokens=210,
                        completion_tokens=40,
                        total_tokens=250,
                        estimated_cost_usd=0.0,
                        actual_cost_usd=0.0,
                        is_estimated_cost=False,
                        is_free_model=True,
                        provider=self.provider_name,
                        model=self.model,
                    ),
                    provider=self.provider_name,
                    model=self.model,
                    is_live_provider=True,
                )

        # 4. Final turn: return structured summary
        return LLMResponse(
            content="Completed specialist subtask and verified zero_cost_market_report.md artifact. VERDICT: APPROVED.",
            tool_calls=[],
            usage=LLMUsage(
                prompt_tokens=240,
                completion_tokens=50,
                total_tokens=290,
                estimated_cost_usd=0.0,
                actual_cost_usd=0.0,
                is_estimated_cost=False,
                is_free_model=True,
                provider=self.provider_name,
                model=self.model,
            ),
            provider=self.provider_name,
            model=self.model,
            is_live_provider=True,
        )


@pytest.mark.asyncio
async def test_7_multi_agent_workflow_and_3d_office_state_propagation(db_session, monkeypatch):
    """
    Validates Sections 8 & 9:
    - CEO enters PLANNING -> COMMUNICATING -> COMPLETED
    - Specialists navigate to workstations (MOVING), enter THINKING -> WORKING -> COMMUNICATING -> COMPLETED
    - Multi-tool & multi-turn execution runs through HybridLLMRouter with google/gemma-4-31b-it:free at $0.00 cost
    """
    org_id = "org-zc-3d-workflow"
    db_session.add(OrganizationModel(id=org_id, name="Zero Cost Org", slug="zero-cost-org", is_active=True))
    db_session.flush()

    agents_spec = [
        ("agent-exec-ceo", "Executive CEO", "CEO", "Executive"),
        ("agent-research-ai", "Research Specialist", "Researcher", "AI Research"),
        ("agent-mkt-growth", "Content Specialist", "Writer", "Marketing"),
        ("agent-eng-lead", "Review Specialist", "Reviewer", "Engineering"),
    ]
    for aid, name, role, dept in agents_spec:
        ag = db_session.query(AgentModel).filter(AgentModel.id == aid).first()
        if not ag:
            ag = AgentModel(
                id=aid,
                name=name,
                role=role,
                station="corridor_center",
                organization_id=org_id,
                status="idle",
                behavioral_state="IDLE",
                pos_x=0.0,
                pos_y=1.0,
                pos_z=3.0,
            )
            db_session.add(ag)
        else:
            ag.organization_id = org_id
            ag.status = "idle"
            ag.behavioral_state = "IDLE"
    db_session.flush()

    for aid, _name, _role, dept in agents_spec:
        workstation_service.allocate_workstation(
            db=db_session,
            agent_id=aid,
            department=dept,
            organization_id=org_id,
        )
        ag_obj = db_session.query(AgentModel).filter(AgentModel.id == aid).first()
        if ag_obj:
            ag_obj.pos_x = 0.0
            ag_obj.pos_y = 1.0
            ag_obj.pos_z = 0.0
    db_session.commit()

    cost_ctrl = CloudCostController()
    gemma_provider = _GemmaFreeMultiTurnWorkflowProvider()
    router = HybridLLMRouter(
        local_provider=None,
        cloud_provider=gemma_provider,
        allow_cloud_fallback=False,
        zero_cost_only=True,
        organization_id=org_id,
        cost_controller=cost_ctrl,
        health_monitor=ProviderHealthMonitor(),
    )

    monkeypatch.setattr(
        "backend.app.agent_runtime.orchestrator.multi_agent_orchestrator.get_llm_provider",
        lambda **kwargs: router,
    )

    wf_task = TaskModel(
        id="wf-zc-3d-1",
        organization_id=org_id,
        task_type="workflow",
        title="Autonomous Zero-Cost Product Launch Strategy",
        description="Analyze market, write zero_cost_market_report.md, verify artifact, and consolidate report.",
        assigned_agent_id="agent-exec-ceo",
        priority="high",
        status="queued",
    )
    db_session.add(wf_task)
    db_session.commit()

    sandbox_report = settings.SANDBOX_DIR / "zero_cost_market_report.md"
    try:
        orchestrator = MultiAgentOrchestrator()
        await orchestrator.execute_workflow(
            task_id=wf_task.id,
            token=CancellationToken(),
            db=db_session,
        )

        db_session.expire_all()
        final_wf = db_session.query(TaskModel).filter(TaskModel.id == wf_task.id).first()
        assert final_wf is not None
        assert final_wf.status == "completed"

        subtasks = db_session.query(TaskModel).filter(TaskModel.parent_task_id == wf_task.id).all()
        assert len(subtasks) == 2
        assert all(st.status == "completed" for st in subtasks)

        # Verify persisted 3D office behavioral state transitions & movement events
        all_task_ids = [wf_task.id] + [st.id for st in subtasks]
        events = (
            db_session.query(AgentEventModel)
            .filter(AgentEventModel.task_id.in_(all_task_ids))
            .order_by(AgentEventModel.sequence_id.asc())
            .all()
        )
        event_types = [e.event_type for e in events]
        assert "workflow.planned" in event_types
        assert "agent.movement_started" in event_types
        assert "agent.movement_completed" in event_types
        assert "tool.execution_started" in event_types
        assert "tool.execution_completed" in event_types
        assert "workflow.completed" in event_types

        state_events = [
            e.payload_json.get("target_state") or e.payload_json.get("new_state") or e.payload_json.get("behavioral_state")
            for e in events
            if e.event_type == "agent.behavioral_state_changed" and isinstance(e.payload_json, dict)
        ]
        for expected_state in ("PLANNING", "COMMUNICATING", "MOVING", "THINKING", "WORKING", "COMPLETED"):
            assert expected_state in state_events, f"Missing expected 3D behavioral state '{expected_state}' in {state_events}"

        # Verify zero-cost accounting
        org_cost = cost_ctrl.get_organization_summary(org_id)["organization"]
        assert org_cost["free_model_requests"] >= 4
        assert org_cost["actual_inference_cost_usd"] == 0.0
        assert org_cost["daily_cloud_cost_usd"] == 0.0
        assert org_cost["rejected_paid_model_requests"] == 0
    finally:
        if sandbox_report.exists():
            sandbox_report.unlink()


# ---------------------------------------------------------------------------
# 8. Safe Free-Only Fallback Chain Failover & Paid Model Rejection (Task 2)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_8_safe_free_only_fallback_chain_failover_and_paid_rejection():
    """
    Validates Task 2 Safe Model Failover:
    - Primary model (google/gemma-4-31b-it:free) encounters rate limit (HTTP 429).
    - Router verifies secondary model (nvidia/nemotron-3.5-super-vl:free) pricing ($0/$0),
      model ID (:free, not auto), and tool calling capability.
    - Router successfully executes inference via secondary model at $0.00 cost.
    - If a fallback model is paid (e.g. openai/gpt-4o-mini), it is strictly rejected and recorded.
    - If all free models fail, it reports failure without falling back to any paid model.
    """
    cost_ctrl = CloudCostController()
    health_mon = ProviderHealthMonitor()

    # Primary rate-limited provider
    primary_rate_limited = MockLiveProvider(
        "openrouter",
        "google/gemma-4-31b-it:free",
        fail_generate=LLMRateLimitError("Upstream shared pool 429 rate limit", retry_after_seconds=5.0),
    )
    # Secondary valid zero-cost provider
    secondary_ok = MockLiveProvider(
        "openrouter",
        "nvidia/nemotron-3.5-super-vl:free",
        prompt_tokens=80,
        completion_tokens=40,
        response_content='{"status": "ok", "source": "secondary_nemotron"}',
        actual_cost_usd=0.0,
    )

    router = HybridLLMRouter(
        local_provider=None,
        cloud_provider=primary_rate_limited,
        fallback_cloud_providers=[secondary_ok],
        allow_cloud_fallback=False,
        zero_cost_only=True,
        organization_id="org-fallback-test",
        task_id="task-fb-1",
        cost_controller=cost_ctrl,
        health_monitor=health_mon,
    )

    resp = await router.generate(
        messages=[{"role": "user", "content": "Analyze business metrics"}],
        explicit_complexity=TaskComplexityLevel.MEDIUM,
    )

    assert resp.content == '{"status": "ok", "source": "secondary_nemotron"}'
    assert resp.routing_metadata["fallback_triggered"] is True
    assert resp.routing_metadata["selected_model"] == "nvidia/nemotron-3.5-super-vl:free"
    assert resp.routing_metadata["actual_inference_cost_usd"] == 0.0
    assert resp.routing_metadata["is_free_model"] is True

    # Verify paid model in fallback chain is rejected
    paid_candidate = MockLiveProvider(
        "openrouter",
        "openai/gpt-4o-mini",
        prompt_tokens=100,
        completion_tokens=50,
        actual_cost_usd=0.0001,
    )
    router_with_paid = HybridLLMRouter(
        local_provider=None,
        cloud_provider=primary_rate_limited,
        fallback_cloud_providers=[paid_candidate],
        allow_cloud_fallback=False,
        zero_cost_only=True,
        organization_id="org-fallback-test",
        task_id="task-fb-2",
        cost_controller=cost_ctrl,
        health_monitor=health_mon,
    )

    with pytest.raises(LLMZeroCostPolicyError, match="zero-cost policy violation"):
        await router_with_paid.generate(
            messages=[{"role": "user", "content": "Must never route to paid fallback"}],
            explicit_complexity=TaskComplexityLevel.MEDIUM,
        )

    assert paid_candidate.generate_calls == 0
    org_sum = cost_ctrl.get_organization_summary("org-fallback-test")["organization"]
    assert org_sum["rejected_paid_model_requests"] >= 1
    assert org_sum["actual_inference_cost_usd"] == 0.0

