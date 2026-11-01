import json
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.executor import ExecutionLoop
from backend.app.agent_runtime.llm.base import (
    LLMProvider,
    LLMResponse,
    LLMUsage,
    ToolCallRequest,
)
from backend.app.agent_runtime.llm.diagnostics import (
    DiagnosticStatus,
    run_live_provider_diagnostics,
)
from backend.app.agent_runtime.llm.factory import inspect_provider_configuration
from backend.app.agent_runtime.policies.engine import PolicyEngine
from backend.app.agent_runtime.policies.permissions import AgentPolicy
from backend.app.agent_runtime.tools.base import ToolPermissionLevel
from backend.app.agent_runtime.tools.registry import default_tool_registry
from backend.app.agent_runtime.verifier import ResultVerifier
from backend.app.core.config import settings


def test_provider_default_model_resolution_per_provider(monkeypatch):
    """Verify each provider resolves its appropriate default model when LLM_MODEL is not explicitly overridden."""
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("OLLAMA_MODEL", raising=False)
    monkeypatch.setattr(settings, "LLM_MODEL", "gpt-4o-mini")
    monkeypatch.setattr(settings, "OLLAMA_MODEL", None)

    assert inspect_provider_configuration("openai")["model"] == "gpt-4o-mini"
    assert inspect_provider_configuration("groq")["model"] == "llama-3.3-70b-versatile"
    assert inspect_provider_configuration("openrouter")["model"] in (
        "google/gemma-4-31b-it:free",
        "openai/gpt-4o-mini",
    )
    assert inspect_provider_configuration("gemini")["model"] == "gemini-2.0-flash"
    assert inspect_provider_configuration("ollama")["model"] == "llama3"


@pytest.mark.asyncio
async def test_diagnostics_distinguishes_all_seven_states(monkeypatch):
    """
    Verify run_live_provider_diagnostics accurately distinguishes:
    - CONFIGURATION_MISSING
    - CONNECTION_FAILED
    - AUTHENTICATION_FAILED
    - MODEL_UNAVAILABLE
    - INFERENCE_FAILED
    - TOOL_CALLING_UNSUPPORTED
    - LIVE_PROVIDER_READY
    and never leaks API keys.
    """
    secret_key = "sk-proj-supersecretkeyvalue999999"

    # 1. CONFIGURATION_MISSING
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(settings, "LLM_API_KEY", None)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", None)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    rep_missing = await run_live_provider_diagnostics(provider_name="openai")
    assert rep_missing.status == DiagnosticStatus.CONFIGURATION_MISSING
    assert rep_missing.credentials_present is False

    # 2. CONNECTION_FAILED
    with patch(
        "httpx.AsyncClient.get",
        new_callable=AsyncMock,
        side_effect=httpx.ConnectError("Connection refused"),
    ):
        rep_conn = await run_live_provider_diagnostics(
            provider_name="openai",
            api_key=secret_key,
        )
        assert rep_conn.status == DiagnosticStatus.CONNECTION_FAILED
        assert rep_conn.credentials_present is True
        assert rep_conn.provider_connectivity is False
        assert secret_key not in (rep_conn.error_detail or "")

    # 3. AUTHENTICATION_FAILED
    resp_401 = MagicMock(spec=httpx.Response)
    resp_401.status_code = 401
    resp_401.text = f"Unauthorized key {secret_key}"
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=resp_401):
        rep_auth = await run_live_provider_diagnostics(
            provider_name="openai",
            api_key=secret_key,
        )
        assert rep_auth.status == DiagnosticStatus.AUTHENTICATION_FAILED
        assert rep_auth.provider_connectivity is True
        assert secret_key not in (rep_auth.error_detail or "")

    # 4. MODEL_UNAVAILABLE (Ollama /api/tags missing target model)
    resp_tags_empty = MagicMock(spec=httpx.Response)
    resp_tags_empty.status_code = 200
    resp_tags_empty.json.return_value = {"models": [{"name": "mistral:latest"}]}
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=resp_tags_empty):
        rep_model = await run_live_provider_diagnostics(
            provider_name="ollama",
            model="llama3.1",
        )
        assert rep_model.status == DiagnosticStatus.MODEL_UNAVAILABLE
        assert rep_model.provider_connectivity is True

    # 5. INFERENCE_FAILED (Health ok, but inference returns non-JSON garbage)
    resp_models_ok = MagicMock(spec=httpx.Response)
    resp_models_ok.status_code = 200
    resp_models_ok.json.return_value = {"data": [{"id": "gpt-4o-mini"}]}

    resp_bad_json = MagicMock(spec=httpx.Response)
    resp_bad_json.status_code = 200
    resp_bad_json.json.return_value = {
        "model": "gpt-4o-mini",
        "choices": [{"message": {"role": "assistant", "content": "plain text without braces"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=resp_models_ok), patch(
        "httpx.AsyncClient.post", new_callable=AsyncMock, return_value=resp_bad_json
    ):
        rep_inf_fail = await run_live_provider_diagnostics(
            provider_name="openai",
            api_key=secret_key,
            model="gpt-4o-mini",
        )
        assert rep_inf_fail.status == DiagnosticStatus.INFERENCE_FAILED
        assert rep_inf_fail.live_inference_success is True
        assert rep_inf_fail.structured_response_valid is False

    # 6. TOOL_CALLING_UNSUPPORTED (Structured inference ok, but tool call probe returns no tool_calls)
    resp_good_json = MagicMock(spec=httpx.Response)
    resp_good_json.status_code = 200
    resp_good_json.json.return_value = {
        "model": "gpt-4o-mini",
        "choices": [{"message": {"role": "assistant", "content": '{"status": "ok"}'}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 12, "completion_tokens": 6, "total_tokens": 18},
    }
    resp_no_tool = MagicMock(spec=httpx.Response)
    resp_no_tool.status_code = 200
    resp_no_tool.json.return_value = {
        "model": "gpt-4o-mini",
        "choices": [{"message": {"role": "assistant", "content": "I cannot call tools", "tool_calls": []}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 20, "completion_tokens": 8, "total_tokens": 28},
    }
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=resp_models_ok), patch(
        "httpx.AsyncClient.post",
        new_callable=AsyncMock,
        side_effect=[resp_good_json, resp_no_tool],
    ):
        rep_no_tool = await run_live_provider_diagnostics(
            provider_name="openai",
            api_key=secret_key,
            model="gpt-4o-mini",
        )
        assert rep_no_tool.status == DiagnosticStatus.TOOL_CALLING_UNSUPPORTED
        assert rep_no_tool.structured_response_valid is True
        assert rep_no_tool.tool_calling_supported is False

    # 7. LIVE_PROVIDER_READY (All checks pass)
    resp_with_tool = MagicMock(spec=httpx.Response)
    resp_with_tool.status_code = 200
    resp_with_tool.json.return_value = {
        "model": "gpt-4o-mini-2024-07-18",
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_diag_1",
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
        "usage": {"prompt_tokens": 25, "completion_tokens": 12, "total_tokens": 37},
    }
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=resp_models_ok), patch(
        "httpx.AsyncClient.post",
        new_callable=AsyncMock,
        side_effect=[resp_good_json, resp_with_tool],
    ):
        rep_ready = await run_live_provider_diagnostics(
            provider_name="openai",
            api_key=secret_key,
            model="gpt-4o-mini",
        )
        assert rep_ready.status == DiagnosticStatus.LIVE_PROVIDER_READY
        assert rep_ready.provider_connectivity is True
        assert rep_ready.live_inference_success is True
        assert rep_ready.structured_response_valid is True
        assert rep_ready.tool_calling_supported is True
        assert rep_ready.token_usage_available is True
        assert rep_ready.cost_estimation_available is True
        assert rep_ready.total_tokens == 55
        assert rep_ready.estimated_cost_usd > 0.0
        assert secret_key not in json.dumps(rep_ready.model_dump())


class _MultiTurnConversationInspectorProvider(LLMProvider):
    provider_name = "openai"
    model = "gpt-4o-mini"
    is_live_provider = True

    def __init__(self):
        self.recorded_messages: List[List[Dict[str, Any]]] = []
        self.turn = 0

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
    ) -> LLMResponse:
        self.turn += 1
        self.recorded_messages.append([dict(m) for m in messages])
        if self.turn == 1:
            return LLMResponse(
                content=None,
                tool_calls=[
                    ToolCallRequest(
                        tool_name="workspace_list",
                        arguments={"subpath": "", "max_depth": 1},
                        call_id="call_live_turn_1",
                    )
                ],
                usage=LLMUsage(prompt_tokens=100, completion_tokens=20, total_tokens=120, estimated_cost_usd=0.0001),
                provider="openai",
                model="gpt-4o-mini",
                is_live_provider=True,
            )
        return LLMResponse(
            content="Workspace inspection completed and verified.",
            tool_calls=[],
            usage=LLMUsage(prompt_tokens=180, completion_tokens=40, total_tokens=220, estimated_cost_usd=0.0002),
            provider="openai",
            model="gpt-4o-mini",
            is_live_provider=True,
        )


@pytest.mark.asyncio
async def test_execution_loop_emits_openai_compliant_assistant_and_tool_call_id_messages():
    """
    Verify ExecutionLoop appends the assistant tool_calls message and includes tool_call_id + name
    on role='tool' messages so multi-turn live OpenAI/Groq/Gemini/Ollama calls succeed.
    """
    loop = ExecutionLoop(
        tool_registry=default_tool_registry,
        policy_engine=PolicyEngine(),
        verifier=ResultVerifier(),
    )
    policy = AgentPolicy(
        agent_id="agent-exec-ceo",
        allowed_tools=["workspace_list"],
        max_permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
        max_iterations=5,
        max_tool_calls=5,
    )
    provider = _MultiTurnConversationInspectorProvider()
    result = await loop.run(
        task_id="task-multiturn-test",
        agent_id="agent-exec-ceo",
        user_prompt="Inspect the workspace files",
        llm_provider=provider,
        agent_policy=policy,
        cancellation_token=CancellationToken(),
    )

    assert result.status == "completed"
    assert len(provider.recorded_messages) == 2
    second_turn_msgs = provider.recorded_messages[1]
    assistant_msg = second_turn_msgs[-2]
    tool_msg = second_turn_msgs[-1]

    assert assistant_msg["role"] == "assistant"
    assert assistant_msg["tool_calls"][0]["id"] == "call_live_turn_1"
    assert assistant_msg["tool_calls"][0]["function"]["name"] == "workspace_list"

    assert tool_msg["role"] == "tool"
    assert tool_msg["tool_call_id"] == "call_live_turn_1"
    assert tool_msg["name"] == "workspace_list"
    assert result.total_tokens == 340
    assert result.estimated_cost_usd == 0.0003


def test_ollama_normalizes_openai_tool_call_arguments_to_dict():
    """Verify OllamaProvider._normalize_messages_for_ollama converts stringified JSON arguments to dicts."""
    from backend.app.agent_runtime.llm.ollama_provider import OllamaProvider

    raw_messages = [
        {"role": "user", "content": "Inspect workspace"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "workspace_list",
                        "arguments": '{"subpath": "docs", "max_depth": 2}',
                    },
                }
            ],
        },
    ]
    normalized = OllamaProvider._normalize_messages_for_ollama(raw_messages)
    assert normalized[1]["content"] == ""
    assert normalized[1]["tool_calls"][0]["function"]["arguments"] == {"subpath": "docs", "max_depth": 2}


class _InfiniteToolLoopMockProvider(LLMProvider):
    provider_name = "openai"
    model = "gpt-4o-mini"
    is_live_provider = True

    def __init__(self, cost_per_call: float = 0.0001):
        self.cost_per_call = cost_per_call
        self.calls = 0

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
    ) -> LLMResponse:
        self.calls += 1
        return LLMResponse(
            content=None,
            tool_calls=[
                ToolCallRequest(
                    tool_name="workspace_list",
                    arguments={"subpath": ""},
                    call_id=f"call_loop_{self.calls}",
                )
            ],
            usage=LLMUsage(
                prompt_tokens=100,
                completion_tokens=25,
                total_tokens=125,
                estimated_cost_usd=self.cost_per_call,
            ),
            provider="openai",
            model="gpt-4o-mini",
            is_live_provider=True,
        )


@pytest.mark.asyncio
async def test_cost_duration_and_infinite_loop_guards(monkeypatch):
    """
    Task 4 Audit: Verify per-task USD cost budget, maximum execution duration,
    and bounded max_iterations prevent infinite agent loops or runaway spend.
    """
    loop = ExecutionLoop(
        tool_registry=default_tool_registry,
        policy_engine=PolicyEngine(),
        verifier=ResultVerifier(),
    )
    policy = AgentPolicy(
        agent_id="agent-exec-ceo",
        allowed_tools=["workspace_list"],
        max_permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
        max_iterations=3,
        max_tool_calls=10,
    )

    # 1. Per-task USD cost budget enforcement
    monkeypatch.setattr(settings, "MAX_TASK_COST_USD", 0.01)
    expensive_provider = _InfiniteToolLoopMockProvider(cost_per_call=0.025)
    res_cost = await loop.run(
        task_id="task-cost-cap",
        agent_id="agent-exec-ceo",
        user_prompt="Summarize launch plan",
        llm_provider=expensive_provider,
        agent_policy=policy,
        cancellation_token=CancellationToken(),
    )
    assert res_cost.status == "failed"
    assert "exceeded maximum cost budget" in (res_cost.error_message or "")
    assert expensive_provider.calls == 1

    # 2. Infinite loop halted at max_iterations=3
    monkeypatch.setattr(settings, "MAX_TASK_COST_USD", 1.0)
    looping_provider = _InfiniteToolLoopMockProvider(cost_per_call=0.0001)
    res_iter = await loop.run(
        task_id="task-iter-cap",
        agent_id="agent-exec-ceo",
        user_prompt="Summarize launch plan",
        llm_provider=looping_provider,
        agent_policy=policy,
        cancellation_token=CancellationToken(),
    )
    assert res_iter.status == "failed"
    assert "exceeded maximum iterations (3)" in (res_iter.error_message or "")
    assert looping_provider.calls == 3

    # 3. Maximum execution duration budget enforcement
    monkeypatch.setattr(settings, "MAX_TASK_EXECUTION_SECONDS", 0.00001)
    res_dur = await loop.run(
        task_id="task-duration-cap",
        agent_id="agent-exec-ceo",
        user_prompt="Summarize launch plan",
        llm_provider=_InfiniteToolLoopMockProvider(cost_per_call=0.0001),
        agent_policy=policy,
        cancellation_token=CancellationToken(),
    )
    assert res_dur.status == "failed"
    assert "exceeded maximum execution duration" in (res_dur.error_message or "")


class _PermissionAndApprovalProbeProvider(LLMProvider):
    provider_name = "openai"
    model = "gpt-4o-mini"
    is_live_provider = True

    def __init__(self, target_tool: str, arguments: Dict[str, Any]):
        self.target_tool = target_tool
        self.arguments = arguments
        self.calls = 0
        self.recorded_messages: List[List[Dict[str, Any]]] = []

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
    ) -> LLMResponse:
        self.calls += 1
        self.recorded_messages.append([dict(m) for m in messages])
        if self.calls == 1:
            return LLMResponse(
                content=None,
                tool_calls=[
                    ToolCallRequest(
                        tool_name=self.target_tool,
                        arguments=self.arguments,
                        call_id="call_perm_1",
                    )
                ],
                usage=LLMUsage(prompt_tokens=80, completion_tokens=20, total_tokens=100, estimated_cost_usd=0.0001),
                provider="openai",
                model="gpt-4o-mini",
                is_live_provider=True,
            )
        return LLMResponse(
            content="Acknowledged policy decision.",
            tool_calls=[],
            usage=LLMUsage(prompt_tokens=120, completion_tokens=20, total_tokens=140, estimated_cost_usd=0.0001),
            provider="openai",
            model="gpt-4o-mini",
            is_live_provider=True,
        )


@pytest.mark.asyncio
async def test_tool_permission_and_approval_policy_enforcement():
    """
    Task 4 Audit: Verify PolicyEngine denies unauthorized tool calls and enforces
    waiting_approval when approval is required.
    """
    loop = ExecutionLoop(
        tool_registry=default_tool_registry,
        policy_engine=PolicyEngine(),
        verifier=ResultVerifier(),
    )

    # 1. Read-only policy denies workspace_write
    read_only_policy = AgentPolicy(
        agent_id="agent-exec-ceo",
        allowed_tools=["workspace_list"],
        max_permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
        allow_sandbox_write=False,
        max_iterations=4,
        max_tool_calls=4,
    )
    perm_provider = _PermissionAndApprovalProbeProvider(
        target_tool="workspace_write",
        arguments={"filepath": "unauthorized.md", "content": "blocked"},
    )
    await loop.run(
        task_id="task-perm-deny",
        agent_id="agent-exec-ceo",
        user_prompt="Attempt unauthorized write",
        llm_provider=perm_provider,
        agent_policy=read_only_policy,
        cancellation_token=CancellationToken(),
    )
    assert len(perm_provider.recorded_messages) >= 2
    tool_feedback = perm_provider.recorded_messages[1][-1]
    assert tool_feedback["role"] == "tool"
    assert "Policy denied tool call" in tool_feedback["content"]

    # 2. Approval required policy transitions to waiting_approval
    sandbox_file = settings.SANDBOX_DIR / "existing_launch_plan.md"
    sandbox_file.write_text("# Existing Launch Plan\n", encoding="utf-8")
    try:
        approval_policy = AgentPolicy(
            agent_id="agent-exec-ceo",
            allowed_tools=["workspace_write"],
            max_permission_level=ToolPermissionLevel.LEVEL_1_WORKSPACE_WRITE,
            allow_sandbox_write=True,
            require_approval_for_overwrite=True,
            max_iterations=4,
            max_tool_calls=4,
        )
        appr_provider = _PermissionAndApprovalProbeProvider(
            target_tool="workspace_write",
            arguments={"filepath": "existing_launch_plan.md", "content": "# Updated Plan"},
        )
        res_appr = await loop.run(
            task_id="task-approval-check",
            agent_id="agent-exec-ceo",
            user_prompt="Overwrite existing launch plan",
            llm_provider=appr_provider,
            agent_policy=approval_policy,
            cancellation_token=CancellationToken(),
        )
        assert res_appr.status == "waiting_approval"
        assert res_appr.requires_approval is True
        assert res_appr.approval_details is not None
        assert res_appr.approval_details["tool_name"] == "workspace_write"
    finally:
        if sandbox_file.exists():
            sandbox_file.unlink()


