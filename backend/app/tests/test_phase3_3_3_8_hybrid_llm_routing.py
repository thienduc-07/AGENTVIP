from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest
from fastapi.testclient import TestClient

from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.executor import ExecutionLoop
from backend.app.agent_runtime.llm.base import (
    LLMAuthError,
    LLMBudgetExceededError,
    LLMConfigError,
    LLMHealthCheckResult,
    LLMProvider,
    LLMResponse,
    LLMResponseError,
    LLMUsage,
    ToolCallRequest,
)
from backend.app.agent_runtime.llm.capabilities import (
    ModelCapabilities,
    ModelCapabilityRegistry,
)
from backend.app.agent_runtime.llm.complexity import (
    TaskComplexityAnalyzer,
    TaskComplexityLevel,
)
from backend.app.agent_runtime.llm.cost_controller import CloudCostController
from backend.app.agent_runtime.llm.deterministic_provider import DeterministicProvider
from backend.app.agent_runtime.llm.diagnostics import (
    DiagnosticStatus,
    run_live_provider_diagnostics,
)
from backend.app.agent_runtime.llm.factory import get_llm_provider
from backend.app.agent_runtime.llm.health_monitor import (
    ProviderHealthMonitor,
    ProviderHealthState,
)
from backend.app.agent_runtime.llm.router import (
    HybridLLMRouter,
    reset_global_routing_decisions,
)
from backend.app.agent_runtime.policies.engine import PolicyEngine
from backend.app.agent_runtime.policies.permissions import AgentPolicy
from backend.app.agent_runtime.tools.base import ToolPermissionLevel
from backend.app.agent_runtime.tools.registry import default_tool_registry
from backend.app.agent_runtime.verifier import ResultVerifier
from backend.app.core.auth import create_access_token
from backend.app.core.config import settings
from backend.app.main import app


class MockLiveProvider(LLMProvider):
    """
    Configurable mock live provider for unit testing HybridLLMRouter routing,
    failover, cost accounting, and health transitions.
    """

    def __init__(
        self,
        provider_name: str,
        model: str,
        *,
        healthy: bool = True,
        health_error: Optional[str] = None,
        fail_generate: Optional[Exception] = None,
        response_content: str = "Completed task response.",
        tool_calls: Optional[List[ToolCallRequest]] = None,
        prompt_tokens: int = 120,
        completion_tokens: int = 40,
        estimated_cost_usd: float = 0.0,
        actual_cost_usd: Optional[float] = None,
        is_live_provider: bool = True,
    ) -> None:
        self.provider_name = provider_name
        self.model = model
        self.healthy = healthy
        self.health_error = health_error
        self.fail_generate = fail_generate
        self.response_content = response_content
        self.tool_calls = tool_calls or []
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.estimated_cost_usd = estimated_cost_usd
        self.actual_cost_usd = actual_cost_usd
        self.is_live_provider = is_live_provider
        self.generate_calls = 0
        self.health_calls = 0

    async def check_health(self) -> LLMHealthCheckResult:
        self.health_calls += 1
        return LLMHealthCheckResult(
            healthy=self.healthy,
            provider=self.provider_name,
            model=self.model,
            base_url=f"http://mock-{self.provider_name}.local",
            is_live_provider=self.is_live_provider,
            latency_ms=4.2,
            error=self.health_error if not self.healthy else None,
        )

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
    ) -> LLMResponse:
        self.generate_calls += 1
        if self.fail_generate is not None:
            raise self.fail_generate

        # If tool_calls are configured, emit them on turn 1 and completion on turn 2
        has_tool_history = any(m.get("role") == "tool" for m in messages)
        emitted_tools = [] if has_tool_history else list(self.tool_calls)

        return LLMResponse(
            content=None if emitted_tools else self.response_content,
            tool_calls=emitted_tools,
            usage=LLMUsage(
                prompt_tokens=self.prompt_tokens,
                completion_tokens=self.completion_tokens,
                total_tokens=self.prompt_tokens + self.completion_tokens,
                estimated_cost_usd=self.estimated_cost_usd,
                actual_cost_usd=self.actual_cost_usd,
                is_estimated_cost=(self.actual_cost_usd is None),
                provider=self.provider_name,
                model=self.model,
            ),
            provider=self.provider_name,
            model=self.model,
            is_live_provider=self.is_live_provider,
        )


def _make_router(
    local_provider: Optional[LLMProvider],
    cloud_provider: Optional[LLMProvider],
    *,
    allow_cloud_fallback: bool = True,
    organization_id: str = "org-test-hybrid",
    task_id: str = "task-hybrid-1",
    agent_id: str = "agent-exec-ceo",
    cost_controller: Optional[CloudCostController] = None,
    health_monitor: Optional[ProviderHealthMonitor] = None,
    capability_registry: Optional[ModelCapabilityRegistry] = None,
) -> HybridLLMRouter:
    return HybridLLMRouter(
        local_provider=local_provider,
        cloud_provider=cloud_provider,
        allow_cloud_fallback=allow_cloud_fallback,
        organization_id=organization_id,
        task_id=task_id,
        agent_id=agent_id,
        cost_controller=cost_controller or CloudCostController(),
        health_monitor=health_monitor or ProviderHealthMonitor(check_interval_seconds=30.0),
        capability_registry=capability_registry or ModelCapabilityRegistry(),
    )


# ---------------------------------------------------------------------------
# 1. LOW task routes to Ollama
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_1_low_complexity_task_routes_to_ollama():
    local = MockLiveProvider("ollama", "qwen2.5:3b", response_content="Short summary complete.")
    cloud = MockLiveProvider("openrouter", "openai/gpt-4o-mini", estimated_cost_usd=0.002)
    router = _make_router(local, cloud)

    resp = await router.generate(
        messages=[{"role": "user", "content": "Provide a short summary of status check."}],
        tools=None,
    )
    assert resp.provider == "ollama"
    assert resp.model == "qwen2.5:3b"
    assert local.generate_calls == 1
    assert cloud.generate_calls == 0
    assert resp.routing_metadata["task_complexity"] == "LOW"
    assert resp.routing_metadata["fallback_triggered"] is False
    assert resp.routing_metadata["cost_usd"] == 0.0


# ---------------------------------------------------------------------------
# 2. MEDIUM task routes according to capabilities and health
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_2_medium_complexity_routes_by_capability_and_health():
    tools_schema = [{"type": "function", "function": {"name": "workspace_list"}}]

    # Case A: Local Ollama model (qwen2.5:3b) is healthy and supports tool_calling -> routes to Ollama
    local_ok = MockLiveProvider("ollama", "qwen2.5:3b")
    cloud_ok = MockLiveProvider("openrouter", "openai/gpt-4o-mini", estimated_cost_usd=0.001)
    router_a = _make_router(local_ok, cloud_ok)

    resp_a = await router_a.generate(
        messages=[{"role": "user", "content": "Perform standard analysis and write report for launch plan."}],
        tools=tools_schema,
    )
    assert resp_a.routing_metadata["task_complexity"] == "MEDIUM"
    assert resp_a.provider == "ollama"
    assert local_ok.generate_calls == 1
    assert cloud_ok.generate_calls == 0

    # Case B: Local Ollama is unhealthy -> MEDIUM task falls back to OpenRouter
    local_down = MockLiveProvider("ollama", "qwen2.5:3b", healthy=False, health_error="Connection refused")
    cloud_backup = MockLiveProvider("openrouter", "openai/gpt-4o-mini", estimated_cost_usd=0.001)
    router_b = _make_router(local_down, cloud_backup)

    resp_b = await router_b.generate(
        messages=[{"role": "user", "content": "Perform standard analysis and write report for launch plan."}],
        tools=tools_schema,
    )
    assert resp_b.routing_metadata["task_complexity"] == "MEDIUM"
    assert resp_b.provider == "openrouter"
    assert resp_b.routing_metadata["fallback_triggered"] is True
    assert local_down.generate_calls == 0
    assert cloud_backup.generate_calls == 1


# ---------------------------------------------------------------------------
# 3. HIGH task routes to OpenRouter
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_3_high_complexity_task_routes_to_openrouter():
    local = MockLiveProvider("ollama", "qwen2.5:3b")
    cloud = MockLiveProvider("openrouter", "openai/gpt-4o-mini", estimated_cost_usd=0.003)
    router = _make_router(local, cloud)
    router.bind_context(task_priority="critical", plan_steps_count=6)

    resp = await router.generate(
        messages=[
            {
                "role": "user",
                "content": (
                    "Execute multi-agent DAG orchestration, cross-department architecture decisions, "
                    "security audit, and comprehensive market analysis."
                ),
            }
        ],
        tools=[
            {"type": "function", "function": {"name": "workspace_list"}},
            {"type": "function", "function": {"name": "file_read"}},
            {"type": "function", "function": {"name": "workspace_write"}},
            {"type": "function", "function": {"name": "verification_tool"}},
            {"type": "function", "function": {"name": "calculator"}},
        ],
    )
    assert resp.routing_metadata["task_complexity"] == "HIGH"
    assert resp.provider == "openrouter"
    assert cloud.generate_calls == 1
    assert local.generate_calls == 0


# ---------------------------------------------------------------------------
# 4. Ollama unavailable with cloud fallback enabled
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_4_ollama_unavailable_with_cloud_fallback_enabled():
    local = MockLiveProvider(
        "ollama",
        "qwen2.5:3b",
        healthy=True,
        fail_generate=LLMResponseError("Ollama socket closed mid-request"),
    )
    cloud = MockLiveProvider("openrouter", "openai/gpt-4o-mini", estimated_cost_usd=0.0015)
    router = _make_router(local, cloud, allow_cloud_fallback=True)

    resp = await router.generate(
        messages=[{"role": "user", "content": "Short summary of daily operations."}],
    )
    assert resp.provider == "openrouter"
    assert local.generate_calls == 1
    assert cloud.generate_calls == 1
    assert resp.routing_metadata["fallback_triggered"] is True
    assert "Ollama socket closed" in (resp.routing_metadata["fallback_reason"] or "")


# ---------------------------------------------------------------------------
# 5. Ollama unavailable with cloud fallback disabled
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_5_ollama_unavailable_with_cloud_fallback_disabled():
    local = MockLiveProvider("ollama", "qwen2.5:3b", healthy=False, health_error="Ollama daemon offline")
    cloud = MockLiveProvider("openrouter", "openai/gpt-4o-mini", estimated_cost_usd=0.0015)
    router = _make_router(local, cloud, allow_cloud_fallback=False)

    with pytest.raises(LLMResponseError, match="Cloud fallback is disabled by policy"):
        await router.generate(
            messages=[{"role": "user", "content": "Short summary of daily operations."}],
        )
    assert local.generate_calls == 0
    assert cloud.generate_calls == 0


# ---------------------------------------------------------------------------
# 6. Per-task cloud budget exhausted
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_6_per_task_cloud_budget_exhausted(monkeypatch):
    monkeypatch.setattr(settings, "MAX_TASK_CLOUD_COST_USD", 0.01)
    monkeypatch.setattr(settings, "MAX_ORGANIZATION_DAILY_CLOUD_COST_USD", 5.0)
    cost_ctrl = CloudCostController()

    local = MockLiveProvider("ollama", "qwen2.5:3b", healthy=False, health_error="Offline")
    cloud = MockLiveProvider("openrouter", "openai/gpt-4o-mini", actual_cost_usd=0.012)
    router = _make_router(
        local,
        cloud,
        organization_id="org-budget-task",
        task_id="task-cap-1",
        cost_controller=cost_ctrl,
    )

    # First call succeeds and spends $0.012 (> $0.01 cap)
    await router.generate(messages=[{"role": "user", "content": "First cloud call"}])
    assert cloud.generate_calls == 1

    # Second call on the same task is rejected before hitting cloud provider
    with pytest.raises(LLMBudgetExceededError, match="cloud cost budget exhausted"):
        await router.generate(messages=[{"role": "user", "content": "Second cloud call"}])
    assert cloud.generate_calls == 1


# ---------------------------------------------------------------------------
# 7. Organization daily cloud budget exhausted
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_7_organization_cloud_budget_exhausted(monkeypatch):
    monkeypatch.setattr(settings, "MAX_TASK_CLOUD_COST_USD", 1.00)
    monkeypatch.setattr(settings, "MAX_ORGANIZATION_DAILY_CLOUD_COST_USD", 0.02)
    cost_ctrl = CloudCostController()

    local = MockLiveProvider("ollama", "qwen2.5:3b", healthy=False, health_error="Offline")
    cloud = MockLiveProvider("openrouter", "openai/gpt-4o-mini", actual_cost_usd=0.025)
    router_task1 = _make_router(
        local,
        cloud,
        organization_id="org-daily-cap",
        task_id="task-1",
        cost_controller=cost_ctrl,
    )
    await router_task1.generate(messages=[{"role": "user", "content": "Task 1 call"}])

    # New task in the same organization is blocked by organization daily budget
    router_task2 = _make_router(
        local,
        cloud,
        organization_id="org-daily-cap",
        task_id="task-2",
        cost_controller=cost_ctrl,
    )
    with pytest.raises(LLMBudgetExceededError, match="daily cloud budget exhausted"):
        await router_task2.generate(messages=[{"role": "user", "content": "Task 2 call"}])
    assert cloud.generate_calls == 1


# ---------------------------------------------------------------------------
# 8. OpenRouter unavailable
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_8_openrouter_unavailable_for_high_complexity_task():
    local = MockLiveProvider("ollama", "qwen2.5:3b")
    cloud = MockLiveProvider(
        "openrouter",
        "openai/gpt-4o-mini",
        healthy=False,
        health_error="HTTP 401 authentication rejected",
    )
    router = _make_router(local, cloud)

    with pytest.raises(LLMResponseError, match="AUTHENTICATION_ERROR"):
        await router.generate(
            messages=[{"role": "user", "content": "Complex architecture decision and multi-agent DAG"}],
            explicit_complexity=TaskComplexityLevel.HIGH,
        )
    assert cloud.generate_calls == 0


# ---------------------------------------------------------------------------
# 9. Model lacks required tool-calling capability
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_9_model_lacks_required_tool_calling_capability():
    # tinyllama is registered with tool_calling=False
    local_no_tools = MockLiveProvider("ollama", "tinyllama")
    cloud_capable = MockLiveProvider("openrouter", "openai/gpt-4o-mini", estimated_cost_usd=0.001)
    router = _make_router(local_no_tools, cloud_capable, allow_cloud_fallback=True)

    resp = await router.generate(
        messages=[{"role": "user", "content": "List workspace files."}],
        tools=[{"type": "function", "function": {"name": "workspace_list"}}],
    )
    # Router skips tinyllama due to missing tool_calling capability and routes to OpenRouter
    assert local_no_tools.generate_calls == 0
    assert cloud_capable.generate_calls == 1
    assert resp.provider == "openrouter"
    assert "lacks required capabilities: tool_calling" in (resp.routing_metadata["fallback_reason"] or "")


# ---------------------------------------------------------------------------
# 10. Both providers unavailable
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_10_both_providers_unavailable():
    local = MockLiveProvider("ollama", "qwen2.5:3b", healthy=False, health_error="Local connection refused")
    cloud = MockLiveProvider("openrouter", "openai/gpt-4o-mini", healthy=False, health_error="Cloud 503 outage")
    router = _make_router(local, cloud, allow_cloud_fallback=True)

    with pytest.raises(LLMResponseError) as exc_info:
        await router.generate(messages=[{"role": "user", "content": "Hello"}])

    err_str = str(exc_info.value)
    assert "ollama/qwen2.5:3b" in err_str
    assert "openrouter/openai/gpt-4o-mini" in err_str
    decisions = router.get_recent_decisions()
    assert len(decisions) == 1
    assert decisions[0]["success"] is False


# ---------------------------------------------------------------------------
# 11. No infinite fallback loop
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_11_no_infinite_fallback_loop():
    local = MockLiveProvider(
        "ollama",
        "qwen2.5:3b",
        fail_generate=LLMResponseError("Local inference crash"),
    )
    cloud = MockLiveProvider(
        "openrouter",
        "openai/gpt-4o-mini",
        fail_generate=LLMResponseError("Cloud inference crash"),
    )
    router = _make_router(local, cloud, allow_cloud_fallback=True)

    with pytest.raises(LLMResponseError):
        await router.generate(messages=[{"role": "user", "content": "Ping"}])

    # Each provider is tried at most once — never loops back and forth
    assert local.generate_calls == 1
    assert cloud.generate_calls == 1


# ---------------------------------------------------------------------------
# 12. No duplicate tool execution during failover in ExecutionLoop
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_12_no_duplicate_tool_execution_on_router_failover():
    local = MockLiveProvider(
        "ollama",
        "qwen2.5:3b",
        fail_generate=LLMResponseError("Local Ollama crashed before returning tool call"),
    )
    cloud = MockLiveProvider(
        "openrouter",
        "openai/gpt-4o-mini",
        tool_calls=[
            ToolCallRequest(
                tool_name="workspace_list",
                arguments={"subpath": "", "max_depth": 1},
                call_id="call_cloud_once",
            )
        ],
        response_content="Verified workspace listing.",
        estimated_cost_usd=0.0005,
    )
    router = _make_router(local, cloud, allow_cloud_fallback=True)

    loop = ExecutionLoop(
        tool_registry=default_tool_registry,
        policy_engine=PolicyEngine(),
        verifier=ResultVerifier(),
    )
    policy = AgentPolicy(
        agent_id="agent-exec-ceo",
        allowed_tools=["workspace_list"],
        max_permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
        max_iterations=4,
        max_tool_calls=4,
    )

    result = await loop.run(
        task_id="task-no-dup-tools",
        agent_id="agent-exec-ceo",
        user_prompt="Inspect workspace once",
        llm_provider=router,
        agent_policy=policy,
        cancellation_token=CancellationToken(),
    )
    assert result.status == "completed"
    # Tool was executed exactly once
    assert len(result.tool_results) == 1
    assert result.tool_results[0]["tool"] == "workspace_list"


# ---------------------------------------------------------------------------
# 13. Correct cost attribution (actual vs estimated vs local zero)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_13_correct_cost_attribution_actual_vs_estimated():
    cost_ctrl = CloudCostController()
    local = MockLiveProvider("ollama", "qwen2.5:3b", prompt_tokens=200, completion_tokens=50)
    cloud_est = MockLiveProvider(
        "openrouter",
        "openai/gpt-4o-mini",
        prompt_tokens=1000,
        completion_tokens=500,
        estimated_cost_usd=0.00045,
        actual_cost_usd=None,
    )
    cloud_actual = MockLiveProvider(
        "openrouter",
        "openai/gpt-4o-mini",
        prompt_tokens=1000,
        completion_tokens=500,
        estimated_cost_usd=0.00045,
        actual_cost_usd=0.00062,
    )

    # 1. Local call -> $0.00 cost, is_estimated_cost=False
    r_local = _make_router(local, cloud_est, organization_id="org-cost", task_id="t-1", agent_id="ag-1", cost_controller=cost_ctrl)
    resp1 = await r_local.generate(messages=[{"role": "user", "content": "Simple status check"}])
    assert resp1.routing_metadata["cost_usd"] == 0.0
    assert resp1.routing_metadata["is_estimated_cost"] is False

    # 2. Cloud call with estimated cost -> is_estimated_cost=True
    r_est = _make_router(None, cloud_est, organization_id="org-cost", task_id="t-1", agent_id="ag-1", cost_controller=cost_ctrl)
    resp2 = await r_est.generate(
        messages=[{"role": "user", "content": "High complexity architecture decision"}],
        explicit_complexity=TaskComplexityLevel.HIGH,
    )
    assert resp2.routing_metadata["cost_usd"] == 0.00045
    assert resp2.routing_metadata["is_estimated_cost"] is True

    # 3. Cloud call with provider-reported actual cost -> is_estimated_cost=False
    r_act = _make_router(None, cloud_actual, organization_id="org-cost", task_id="t-1", agent_id="ag-1", cost_controller=cost_ctrl)
    resp3 = await r_act.generate(
        messages=[{"role": "user", "content": "High complexity architecture decision"}],
        explicit_complexity=TaskComplexityLevel.HIGH,
    )
    assert resp3.routing_metadata["cost_usd"] == 0.00062
    assert resp3.routing_metadata["is_estimated_cost"] is False

    summary = cost_ctrl.get_organization_summary("org-cost")
    task_ledger = summary["tasks"]["t-1"]
    assert task_ledger["local_requests"] == 1
    assert task_ledger["cloud_requests"] == 2
    assert task_ledger["estimated_cloud_cost_usd"] == 0.00045
    assert task_ledger["actual_cloud_cost_usd"] == 0.00062
    assert task_ledger["cloud_cost_usd"] == 0.00107
    assert summary["agents"]["ag-1"]["total_tokens"] == 3250


# ---------------------------------------------------------------------------
# 14. Tenant isolation across budgets, routing history, and diagnostics API
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_14_tenant_isolation_in_budgets_and_diagnostics(monkeypatch):
    reset_global_routing_decisions()
    monkeypatch.setattr(settings, "MAX_ORGANIZATION_DAILY_CLOUD_COST_USD", 0.05)
    cost_ctrl = CloudCostController()

    cloud_org_a = MockLiveProvider("openrouter", "openai/gpt-4o-mini", actual_cost_usd=0.06)
    cloud_org_b = MockLiveProvider("openrouter", "openai/gpt-4o-mini", actual_cost_usd=0.01)

    router_a = _make_router(
        None,
        cloud_org_a,
        organization_id="org-tenant-alpha",
        task_id="task-a",
        cost_controller=cost_ctrl,
    )
    router_b = _make_router(
        None,
        cloud_org_b,
        organization_id="org-tenant-beta",
        task_id="task-b",
        cost_controller=cost_ctrl,
    )

    # Org Alpha exhausts its daily budget ($0.06 > $0.05)
    await router_a.generate(
        messages=[{"role": "user", "content": "Alpha high complexity"}],
        explicit_complexity=TaskComplexityLevel.HIGH,
    )
    with pytest.raises(LLMBudgetExceededError):
        await router_a.generate(
            messages=[{"role": "user", "content": "Alpha blocked call"}],
            explicit_complexity=TaskComplexityLevel.HIGH,
        )

    # Org Beta is completely unaffected and executes cleanly
    resp_b = await router_b.generate(
        messages=[{"role": "user", "content": "Beta high complexity"}],
        explicit_complexity=TaskComplexityLevel.HIGH,
    )
    assert resp_b.provider == "openrouter"

    # Verify tenant-isolated decisions & API endpoint
    alpha_decisions = router_a.get_recent_decisions(organization_id="org-tenant-alpha")
    beta_decisions = router_b.get_recent_decisions(organization_id="org-tenant-beta")
    assert all(d["organization_id"] == "org-tenant-alpha" for d in alpha_decisions)
    assert all(d["organization_id"] == "org-tenant-beta" for d in beta_decisions)

    from backend.app.core.auth import UserContext, get_current_tenant_org, get_current_user

    app.dependency_overrides[get_current_tenant_org] = lambda: "org-tenant-beta"
    app.dependency_overrides[get_current_user] = lambda: UserContext(
        user_id="admin-beta",
        email="admin@beta.org",
        is_superadmin=False,
        org_roles={"org-tenant-beta": "ORGANIZATION_ADMIN"},
    )
    try:
        client = TestClient(app)
        api_resp = client.get("/api/v1/health/llm-routing")
        assert api_resp.status_code == 200
        body = api_resp.json()
        assert body["organization_id"] == "org-tenant-beta"
        assert all(
            d["organization_id"] == "org-tenant-beta"
            for d in body["recent_routing_decisions"]
        )
    finally:
        app.dependency_overrides.pop(get_current_tenant_org, None)
        app.dependency_overrides.pop(get_current_user, None)


# ---------------------------------------------------------------------------
# 15. Secret redaction in router, health monitor, and decisions
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_15_secret_redaction_in_router_and_health_monitor():
    leaked_secret = "sk-proj-supersecretkey9876543210"
    local = MockLiveProvider(
        "ollama",
        "qwen2.5:3b",
        healthy=False,
        health_error=f"Failed with Bearer {leaked_secret}",
    )
    cloud = MockLiveProvider(
        "openrouter",
        "openai/gpt-4o-mini",
        fail_generate=LLMAuthError(f"Invalid key {leaked_secret}"),
    )
    health_mon = ProviderHealthMonitor()
    router = _make_router(local, cloud, health_monitor=health_mon)

    with pytest.raises(LLMResponseError) as exc_info:
        await router.generate(messages=[{"role": "user", "content": "Test secret redaction"}])

    assert leaked_secret not in str(exc_info.value)
    decisions = router.get_recent_decisions()
    assert leaked_secret not in str(decisions)
    assert leaked_secret not in str(health_mon.list_snapshots())


# ---------------------------------------------------------------------------
# 16. DeterministicProvider cannot pass live-provider verification or hybrid routing
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_16_deterministic_provider_rejected_by_hybrid_router_and_live_diagnostics(monkeypatch):
    det = DeterministicProvider()
    assert det.is_live_provider is False

    # Passing DeterministicProvider into HybridLLMRouter is rejected because is_live_provider=False
    router = _make_router(det, None, allow_cloud_fallback=False)
    with pytest.raises(LLMResponseError, match="local_provider_not_live"):
        await router.generate(messages=[{"role": "user", "content": "Attempt deterministic bypass"}])

    monkeypatch.setattr(settings, "LLM_PROVIDER", "deterministic")
    diag = await run_live_provider_diagnostics(provider_name="deterministic")
    assert diag.status == DiagnosticStatus.CONFIGURATION_MISSING
    assert diag.is_live_provider is False


def test_env_example_contains_phase_3_3_3_8_hybrid_settings():
    env_example = (Path(__file__).resolve().parents[3] / ".env.example").read_text(encoding="utf-8")
    required = [
        "LLM_ROUTING_MODE=hybrid",
        "LLM_LOCAL_PROVIDER=ollama",
        "LLM_LOCAL_BASE_URL=http://localhost:11434",
        "LLM_LOCAL_MODEL=",
        "LLM_CLOUD_PROVIDER=openrouter",
        "LLM_CLOUD_MODEL=",
        "OPENROUTER_API_KEY=",
        "LLM_ALLOW_CLOUD_FALLBACK=true",
        "MAX_TASK_CLOUD_COST_USD=0.10",
        "MAX_ORGANIZATION_DAILY_CLOUD_COST_USD=1.00",
        "MAX_TASK_CLOUD_REQUESTS=10",
    ]
    for item in required:
        assert item in env_example, f"Missing '{item}' in .env.example"
