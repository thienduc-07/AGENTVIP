import json
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.app.agent_runtime.llm.base import (
    LLMBudgetExceededError,
    LLMResponseError,
    estimate_llm_cost_usd,
)
from backend.app.agent_runtime.llm.capabilities import (
    CapabilityRequirement,
    ModelCapabilityRegistry,
    default_capability_registry,
)
from backend.app.agent_runtime.llm.complexity import TaskComplexityLevel
from backend.app.agent_runtime.llm.cost_controller import CloudCostController
from backend.app.agent_runtime.llm.diagnostics import (
    DiagnosticStatus,
    run_live_provider_diagnostics,
)
from backend.app.agent_runtime.llm.factory import (
    create_hybrid_llm_router,
    get_llm_provider,
    inspect_provider_configuration,
)
from backend.app.agent_runtime.llm.health_monitor import ProviderHealthMonitor
from backend.app.agent_runtime.llm.openai_provider import OpenAIProvider
from backend.app.agent_runtime.llm.router import HybridLLMRouter
from backend.app.core.config import settings


def test_task1_openrouter_hybrid_configuration_and_model_resolution(monkeypatch):
    """
    Task 1: Verify OpenRouter configuration compatibility with:
    LLM_ROUTING_MODE=hybrid
    LLM_CLOUD_PROVIDER=openrouter
    LLM_ALLOW_CLOUD_FALLBACK=true
    including API key resolution, base URL, and LLM_CLOUD_MODEL selection.
    """
    monkeypatch.setattr(settings, "LLM_ROUTING_MODE", "hybrid")
    monkeypatch.setattr(settings, "LLM_CLOUD_PROVIDER", "openrouter")
    monkeypatch.setattr(settings, "LLM_ALLOW_CLOUD_FALLBACK", True)
    monkeypatch.setattr(settings, "LLM_ZERO_COST_POLICY", False)
    monkeypatch.setattr(settings, "LLM_CLOUD_MODEL", "openai/gpt-4o-mini")
    monkeypatch.setattr(settings, "LLM_API_KEY", None)
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "sk-or-v1-testkey1234567890")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("LLM_CLOUD_MODEL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)

    # 1. Inspect openrouter direct configuration
    or_cfg = inspect_provider_configuration("openrouter")
    assert or_cfg["provider"] == "openrouter"
    assert or_cfg["base_url"] == "https://openrouter.ai/api/v1"
    assert or_cfg["model"] == "openai/gpt-4o-mini"
    assert or_cfg["is_live_provider"] is True
    assert or_cfg["api_key_configured"] is True
    assert or_cfg["missing_configuration"] == []

    # 2. Verify LLM_CLOUD_MODEL override propagates to OpenRouter provider resolution
    monkeypatch.setattr(settings, "LLM_CLOUD_MODEL", "google/gemini-2.5-flash")
    assert inspect_provider_configuration("openrouter")["model"] == "google/gemini-2.5-flash"
    direct_provider = get_llm_provider("openrouter")
    assert isinstance(direct_provider, OpenAIProvider)
    assert direct_provider.provider_name == "openrouter"
    assert direct_provider.base_url == "https://openrouter.ai/api/v1"
    assert direct_provider.model == "google/gemini-2.5-flash"

    # 3. Verify get_llm_provider() in hybrid mode returns HybridLLMRouter wired with OpenRouter
    router = get_llm_provider(organization_id="org-phase-3339", task_id="task-3339")
    assert isinstance(router, HybridLLMRouter)
    assert router.allow_cloud_fallback is True
    assert router.cloud_provider is not None
    assert router.cloud_provider.provider_name == "openrouter"
    assert router.cloud_provider.model == "google/gemini-2.5-flash"


def test_task2_openrouter_model_capability_verification():
    """
    Task 2: Verify recommended OpenRouter models support text generation, tool calling,
    structured output, and sufficient context length, and confirm free/unregistered models
    are never assumed to support tool calling.
    """
    recommended_models = [
        "openai/gpt-4o-mini",
        "openai/gpt-4.1-mini",
        "openai/gpt-4.1-nano",
        "openai/gpt-4o",
        "google/gemini-2.5-flash",
        "google/gemini-2.5-flash-lite",
        "google/gemini-2.5-pro",
        "meta-llama/llama-3.3-70b-instruct",
        "meta-llama/llama-3.1-8b-instruct",
        "qwen/qwen-2.5-72b-instruct",
    ]
    req = CapabilityRequirement(
        require_text_generation=True,
        require_tool_calling=True,
        require_structured_output=True,
        require_long_context=True,
        min_context_tokens=32768,
    )
    for model_id in recommended_models:
        ok, missing = default_capability_registry.check_compatibility(
            "openrouter", model_id, req
        )
        assert ok is True, f"Model {model_id} failed capability check: {missing}"
        est_cost = estimate_llm_cost_usd(model_id, prompt_tokens=1000, completion_tokens=500)
        assert est_cost > 0.0

    # Unregistered ':free' models must NOT be assumed to support tool calling
    free_models = [
        "nvidia/nemotron-3.5-content-safety:free",
        "openai/gpt-4o-mini:free",
        "meta-llama/llama-3.2-1b-instruct:free",
    ]
    for free_id in free_models:
        cap = default_capability_registry.get_capabilities("openrouter", free_id)
        assert cap.tool_calling is False
        assert cap.structured_output is False
        ok, missing = default_capability_registry.check_compatibility(
            "openrouter", free_id, CapabilityRequirement(require_tool_calling=True)
        )
        assert ok is False
        assert "tool_calling" in missing

    # Dynamic OpenRouter catalog parser accurately reflects supported_parameters
    parsed_capable = ModelCapabilityRegistry.parse_openrouter_catalog_entry(
        {
            "id": "openai/gpt-4o-mini",
            "context_length": 128000,
            "supported_parameters": ["tools", "tool_choice", "response_format", "structured_outputs"],
            "architecture": {"input_modalities": ["text", "image"]},
        }
    )
    assert parsed_capable.tool_calling is True
    assert parsed_capable.structured_output is True
    assert parsed_capable.long_context is True
    assert parsed_capable.vision is True

    parsed_free_no_tools = ModelCapabilityRegistry.parse_openrouter_catalog_entry(
        {
            "id": "nvidia/nemotron-3.5-content-safety:free",
            "context_length": 32768,
            "supported_parameters": ["temperature", "max_tokens"],
            "architecture": {"input_modalities": ["text"]},
        }
    )
    assert parsed_free_no_tools.tool_calling is False
    assert parsed_free_no_tools.structured_output is False


@pytest.mark.asyncio
async def test_task3_and_task4_openrouter_missing_key_and_live_diagnostics(monkeypatch):
    """
    Task 3 & Task 4:
    - When OPENROUTER_API_KEY is missing, diagnostics reports CONFIGURATION_MISSING cleanly.
    - When OpenRouter responds to health, structured output, and tool-calling probes,
      diagnostics reports LIVE_PROVIDER_READY with token usage and cost estimation.
    """
    monkeypatch.setattr(settings, "LLM_API_KEY", None)
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", None)
    monkeypatch.setattr(settings, "LLM_CLOUD_MODEL", "openai/gpt-4o-mini")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    missing_rep = await run_live_provider_diagnostics(provider_name="openrouter")
    assert missing_rep.status == DiagnosticStatus.CONFIGURATION_MISSING
    assert missing_rep.selected_provider == "openrouter"
    assert missing_rep.configured_model == "openai/gpt-4o-mini"
    assert missing_rep.base_url == "https://openrouter.ai/api/v1"
    assert missing_rep.credentials_present is False
    assert "LLM_API_KEY (or OPENROUTER_API_KEY)" in missing_rep.missing_configuration

    # Simulate OpenRouter live endpoints with actual usage.cost
    secret_or_key = "sk-or-v1-liveprobe999999999"
    resp_models = MagicMock(spec=httpx.Response)
    resp_models.status_code = 200
    resp_models.json.return_value = {"data": [{"id": "openai/gpt-4o-mini"}]}

    resp_json_probe = MagicMock(spec=httpx.Response)
    resp_json_probe.status_code = 200
    resp_json_probe.json.return_value = {
        "model": "openai/gpt-4o-mini",
        "choices": [
            {
                "message": {"role": "assistant", "content": '{"status": "ok"}'},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 18,
            "completion_tokens": 6,
            "total_tokens": 24,
            "cost": 0.0000063,
        },
    }

    resp_tool_probe = MagicMock(spec=httpx.Response)
    resp_tool_probe.status_code = 200
    resp_tool_probe.json.return_value = {
        "model": "openai/gpt-4o-mini",
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_or_diag_1",
                            "type": "function",
                            "function": {
                                "name": "workspace_list",
                                "arguments": json.dumps({"subpath": ""}),
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {
            "prompt_tokens": 42,
            "completion_tokens": 14,
            "total_tokens": 56,
            "cost": 0.0000147,
        },
    }

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=resp_models), patch(
        "httpx.AsyncClient.post",
        new_callable=AsyncMock,
        side_effect=[resp_json_probe, resp_tool_probe],
    ):
        ready_rep = await run_live_provider_diagnostics(
            provider_name="openrouter",
            api_key=secret_or_key,
            model="openai/gpt-4o-mini",
        )
        assert ready_rep.status == DiagnosticStatus.LIVE_PROVIDER_READY
        assert ready_rep.selected_provider == "openrouter"
        assert ready_rep.configured_model == "openai/gpt-4o-mini"
        assert ready_rep.provider_connectivity is True
        assert ready_rep.live_inference_success is True
        assert ready_rep.structured_response_valid is True
        assert ready_rep.tool_calling_supported is True
        assert ready_rep.token_usage_available is True
        assert ready_rep.cost_estimation_available is True
        assert ready_rep.total_tokens == 80
        assert ready_rep.estimated_cost_usd == pytest.approx(0.000021, rel=1e-4)
        assert secret_or_key not in json.dumps(ready_rep.model_dump())


@pytest.mark.asyncio
async def test_task6_openrouter_cost_controls_request_caps_and_no_silent_paid_fallback(monkeypatch):
    """
    Task 6: Verify OpenRouter cloud cost controls:
    - Per-task cloud budget (MAX_TASK_CLOUD_COST_USD=0.10)
    - Organization daily budget (MAX_ORGANIZATION_DAILY_CLOUD_COST_USD=1.00)
    - Request cap (MAX_TASK_CLOUD_REQUESTS=2 in test)
    - No silent paid-model fallback when configured cloud model lacks required capability
    """
    monkeypatch.setattr(settings, "MAX_TASK_CLOUD_COST_USD", 0.10)
    monkeypatch.setattr(settings, "MAX_ORGANIZATION_DAILY_CLOUD_COST_USD", 1.00)
    monkeypatch.setattr(settings, "MAX_TASK_CLOUD_REQUESTS", 2)
    monkeypatch.setattr(settings, "LLM_ZERO_COST_POLICY", False)

    cost_ctrl = CloudCostController()
    health_mon = ProviderHealthMonitor()

    # 1. Verify request cap enforcement (MAX_TASK_CLOUD_REQUESTS=2)
    from backend.app.tests.test_phase3_3_3_8_hybrid_llm_routing import MockLiveProvider

    cloud_prov = MockLiveProvider(
        "openrouter",
        "openai/gpt-4o-mini",
        prompt_tokens=100,
        completion_tokens=50,
        actual_cost_usd=0.005,
    )
    router = HybridLLMRouter(
        local_provider=None,
        cloud_provider=cloud_prov,
        allow_cloud_fallback=True,
        organization_id="org-cost-3339",
        task_id="task-req-cap",
        agent_id="agent-exec-ceo",
        cost_controller=cost_ctrl,
        health_monitor=health_mon,
    )

    await router.generate(
        messages=[{"role": "user", "content": "Request 1"}],
        explicit_complexity=TaskComplexityLevel.HIGH,
    )
    await router.generate(
        messages=[{"role": "user", "content": "Request 2"}],
        explicit_complexity=TaskComplexityLevel.HIGH,
    )
    with pytest.raises(LLMBudgetExceededError, match="MAX_TASK_CLOUD_REQUESTS"):
        await router.generate(
            messages=[{"role": "user", "content": "Request 3 exceeds cap"}],
            explicit_complexity=TaskComplexityLevel.HIGH,
        )
    assert cloud_prov.generate_calls == 2

    # 2. Verify no silent paid-model fallback when configured ':free' model lacks tool_calling
    free_cloud_prov = MockLiveProvider(
        "openrouter",
        "nvidia/nemotron-3.5-content-safety:free",
        estimated_cost_usd=0.0,
    )
    router_free = HybridLLMRouter(
        local_provider=None,
        cloud_provider=free_cloud_prov,
        allow_cloud_fallback=True,
        organization_id="org-cost-3339",
        task_id="task-free-no-silent-fallback",
        agent_id="agent-exec-ceo",
        cost_controller=cost_ctrl,
        health_monitor=health_mon,
    )
    with pytest.raises(LLMResponseError, match="lacks required capabilities: tool_calling"):
        await router_free.generate(
            messages=[{"role": "user", "content": "Call workspace_list"}],
            tools=[{"type": "function", "function": {"name": "workspace_list"}}],
            explicit_complexity=TaskComplexityLevel.HIGH,
        )
    assert free_cloud_prov.generate_calls == 0
