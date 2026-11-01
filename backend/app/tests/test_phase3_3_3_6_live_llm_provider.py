import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.context import TaskContext
from backend.app.agent_runtime.executor import ExecutionLoop
from backend.app.agent_runtime.llm.base import (
    LLMBudgetExceededError,
    LLMConfigError,
    LLMError,
    LLMProvider,
    LLMRateLimitError,
    LLMResponse,
    LLMTimeoutError,
    LLMUsage,
    ToolCallRequest,
    estimate_llm_cost_usd,
    redact_secrets,
)
from backend.app.agent_runtime.llm.deterministic_provider import DeterministicProvider
from backend.app.agent_runtime.llm.factory import (
    check_llm_provider_health,
    get_llm_provider,
    inspect_provider_configuration,
)
from backend.app.agent_runtime.llm.ollama_provider import OllamaProvider
from backend.app.agent_runtime.llm.openai_provider import OpenAIProvider
from backend.app.agent_runtime.policies.engine import PolicyEngine
from backend.app.agent_runtime.policies.permissions import AgentPolicy
from backend.app.agent_runtime.tools.base import ToolPermissionLevel
from backend.app.agent_runtime.tools.registry import default_tool_registry
from backend.app.agent_runtime.verifier import ResultVerifier
from backend.app.core.config import settings


def test_env_example_documents_all_provider_and_budget_settings():
    """Verify .env.example documents all required LLM provider and cost/security settings without secrets."""
    env_example_path = Path(__file__).resolve().parents[3] / ".env.example"
    assert env_example_path.exists(), ".env.example must exist at repository root"
    content = env_example_path.read_text(encoding="utf-8")

    required_keys = [
        "LLM_PROVIDER=",
        "LLM_MODEL=",
        "LLM_API_KEY=",
        "LLM_BASE_URL=",
        "LLM_TIMEOUT_SECONDS=",
        "LLM_MAX_RETRIES=",
        "OPENAI_API_KEY=",
        "GROQ_API_KEY=",
        "OPENROUTER_API_KEY=",
        "GEMINI_API_KEY=",
        "OLLAMA_BASE_URL=",
        "OLLAMA_MODEL=",
        "MAX_TASK_TOKENS=",
        "MAX_TASK_COST_USD=",
        "MAX_TASK_EXECUTION_SECONDS=",
    ]
    for key in required_keys:
        assert key in content, f"Missing {key} in .env.example"

    # Ensure no real API keys are hardcoded in .env.example
    assert "sk-" not in content
    assert "gsk_" not in content
    assert "AIza" not in content


def test_secret_redaction_scrubs_api_keys_and_bearer_tokens():
    """Verify redact_secrets strips OpenAI, Groq, Gemini, Bearer, and query/header keys."""
    raw = (
        "Error calling https://api.openai.com with Authorization: Bearer sk-proj-1234567890abcdefghij "
        "and gsk_9876543210abcdefghijk and AIzaSyD1234567890abcdefghijk and api_key=secret_token_value_12345"
    )
    scrubbed = redact_secrets(raw)
    assert "sk-proj-1234567890abcdefghij" not in scrubbed
    assert "gsk_9876543210abcdefghijk" not in scrubbed
    assert "AIzaSyD1234567890abcdefghijk" not in scrubbed
    assert "secret_token_value_12345" not in scrubbed
    assert "[REDACTED" in scrubbed


def test_deterministic_provider_never_counts_as_live_provider(monkeypatch):
    """Verify DeterministicProvider is explicitly flagged as non-live and rejected when require_live=True."""
    det = DeterministicProvider()
    assert det.is_live_provider is False

    monkeypatch.setattr(settings, "LLM_PROVIDER", "deterministic")
    with pytest.raises(LLMConfigError, match="DeterministicProvider cannot be used when require_live=True"):
        get_llm_provider(require_live=True)


@pytest.mark.asyncio
async def test_deterministic_provider_health_check_fails_when_require_live(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "deterministic")
    health = await check_llm_provider_health(require_live=True)
    assert health.healthy is False
    assert health.is_live_provider is False
    assert "DeterministicProvider cannot be used when require_live=True" in (health.error or "")


def test_provider_factory_supports_cloud_and_ollama_providers(monkeypatch):
    """Verify provider factory resolves openai, groq, openrouter, gemini, and ollama from environment settings."""
    # OpenAI
    p_openai = get_llm_provider(provider_name="openai", api_key="test-key-openai", model="gpt-4o-mini")
    assert isinstance(p_openai, OpenAIProvider)
    assert p_openai.provider_name == "openai"
    assert p_openai.model == "gpt-4o-mini"
    assert p_openai.is_live_provider is True

    # Groq
    p_groq = get_llm_provider(provider_name="groq", api_key="test-key-groq")
    assert isinstance(p_groq, OpenAIProvider)
    assert p_groq.provider_name == "groq"
    assert "groq.com" in p_groq.base_url

    # OpenRouter
    p_or = get_llm_provider(provider_name="openrouter", api_key="test-key-or")
    assert isinstance(p_or, OpenAIProvider)
    assert p_or.provider_name == "openrouter"
    assert "openrouter.ai" in p_or.base_url

    # Gemini (OpenAI-compatible endpoint)
    p_gemini = get_llm_provider(provider_name="gemini", api_key="test-key-gemini")
    assert isinstance(p_gemini, OpenAIProvider)
    assert p_gemini.provider_name == "gemini"
    assert "generativelanguage.googleapis.com" in p_gemini.base_url

    # Ollama
    p_ollama = get_llm_provider(provider_name="ollama", base_url="http://localhost:11434", model="llama3.1")
    assert isinstance(p_ollama, OllamaProvider)
    assert p_ollama.provider_name == "ollama"
    assert p_ollama.model == "llama3.1"
    assert p_ollama.is_live_provider is True


@pytest.mark.asyncio
async def test_openai_provider_inference_tool_calling_token_and_cost_tracking():
    """Verify OpenAIProvider parses tool calls, tracks tokens and cost, and identifies model."""
    provider = OpenAIProvider(
        api_key="test-key-1234567890",
        base_url="https://api.openai.com/v1",
        model="gpt-4o-mini",
        timeout_seconds=10,
        max_retries=1,
        provider_name="openai",
    )

    mock_json = {
        "id": "chatcmpl-live-test",
        "model": "gpt-4o-mini-2024-07-18",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_abc123",
                            "type": "function",
                            "function": {
                                "name": "workspace.write_file",
                                "arguments": json.dumps({"filename": "report.md", "content": "# Market Analysis"}),
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {
            "prompt_tokens": 1200,
            "completion_tokens": 350,
            "total_tokens": 1550,
        },
    }

    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.json.return_value = mock_json

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
        result = await provider.generate(
            messages=[{"role": "user", "content": "Write market report"}],
            tools=[{"type": "function", "function": {"name": "workspace.write_file"}}],
        )

    assert result.is_live_provider is True
    assert result.provider_name == "openai"
    assert result.model_name == "gpt-4o-mini-2024-07-18"
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].tool_name == "workspace.write_file"
    assert result.tool_calls[0].arguments["filename"] == "report.md"
    assert result.usage.prompt_tokens == 1200
    assert result.usage.completion_tokens == 350
    assert result.usage.total_tokens == 1550
    assert result.usage.estimated_cost_usd > 0.0


@pytest.mark.asyncio
async def test_openai_provider_rate_limit_retry_and_error_redaction():
    """Verify OpenAIProvider retries on HTTP 429 and raises LLMRateLimitError with redacted secrets on exhaustion."""
    provider = OpenAIProvider(
        api_key="sk-proj-supersecretkeyvalue123456",
        base_url="https://api.openai.com/v1",
        model="gpt-4o-mini",
        timeout_seconds=5,
        max_retries=1,
        retry_base_delay_seconds=0.01,
        provider_name="openai",
    )

    resp_429 = MagicMock(spec=httpx.Response)
    resp_429.status_code = 429
    resp_429.headers = {"Retry-After": "0.01"}
    resp_429.text = "Rate limit exceeded for key sk-proj-supersecretkeyvalue123456"

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=resp_429) as mock_post:
        with pytest.raises(LLMRateLimitError) as exc_info:
            await provider.generate(messages=[{"role": "user", "content": "Hello"}])
        assert mock_post.call_count == 2  # initial + 1 retry
        assert "sk-proj-supersecretkeyvalue123456" not in str(exc_info.value)

    # Also verify HTTP 400 error body redacts embedded API keys
    resp_400 = MagicMock(spec=httpx.Response)
    resp_400.status_code = 400
    resp_400.text = "Invalid request for key sk-proj-supersecretkeyvalue123456"
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=resp_400):
        with pytest.raises(LLMError) as exc_400:
            await provider.generate(messages=[{"role": "user", "content": "Hello"}])
        assert "sk-proj-supersecretkeyvalue123456" not in str(exc_400.value)
        assert "sk-[REDACTED]" in str(exc_400.value)


@pytest.mark.asyncio
async def test_openai_provider_timeout_handling():
    """Verify OpenAIProvider raises LLMTimeoutError after bounded retries on timeout."""
    provider = OpenAIProvider(
        api_key="test-key",
        base_url="https://api.openai.com/v1",
        model="gpt-4o-mini",
        timeout_seconds=1,
        max_retries=1,
        retry_base_delay_seconds=0.01,
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=httpx.TimeoutException("Timed out")):
        with pytest.raises(LLMTimeoutError, match="timed out"):
            await provider.generate(messages=[{"role": "user", "content": "Hello"}])


@pytest.mark.asyncio
async def test_ollama_provider_tool_calling_and_health_check():
    """Verify OllamaProvider supports native tool calling, token usage tracking, and health checks."""
    provider = OllamaProvider(
        base_url="http://localhost:11434",
        model="llama3.1",
        timeout_seconds=5,
        max_retries=0,
    )

    # 1. Health check when model is present
    tags_response = MagicMock(spec=httpx.Response)
    tags_response.status_code = 200
    tags_response.json.return_value = {"models": [{"name": "llama3.1:latest"}]}

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=tags_response):
        health = await provider.check_health()
        assert health.healthy is True
        assert health.is_live_provider is True
        assert health.provider == "ollama"

    # 2. Inference with native tool call
    chat_response = MagicMock(spec=httpx.Response)
    chat_response.status_code = 200
    chat_response.json.return_value = {
        "model": "llama3.1:latest",
        "message": {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "ollama_call_1",
                    "function": {
                        "name": "data.Inspect",
                        "arguments": {"dataset": "market_metrics"},
                    },
                }
            ],
        },
        "done_reason": "stop",
        "prompt_eval_count": 410,
        "eval_count": 90,
    }

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=chat_response):
        resp = await provider.generate(
            messages=[{"role": "user", "content": "Inspect market metrics"}],
            tools=[{"type": "function", "function": {"name": "data.Inspect"}}],
        )

    assert resp.is_live_provider is True
    assert resp.provider_name == "ollama"
    assert resp.model_name == "llama3.1:latest"
    assert len(resp.tool_calls) == 1
    assert resp.tool_calls[0].tool_name == "data.Inspect"
    assert resp.tool_calls[0].arguments == {"dataset": "market_metrics"}
    assert resp.usage.prompt_tokens == 410
    assert resp.usage.completion_tokens == 90
    assert resp.usage.total_tokens == 500


class _BudgetExceedingMockProvider(LLMProvider):
    provider_name = "openai"
    model = "gpt-4o"
    is_live_provider = True

    def __init__(self, tokens_per_call: int = 50000, cost_per_call: float = 0.05):
        self.tokens_per_call = tokens_per_call
        self.cost_per_call = cost_per_call
        self.calls = 0

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
        max_tokens: Optional[int] = None,
    ) -> LLMResponse:
        self.calls += 1
        return LLMResponse(
            content="Completed analysis.",
            tool_calls=[],
            usage=LLMUsage(
                prompt_tokens=self.tokens_per_call // 2,
                completion_tokens=self.tokens_per_call // 2,
                total_tokens=self.tokens_per_call,
                estimated_cost_usd=self.cost_per_call,
            ),
            provider="openai",
            model="gpt-4o",
            is_live_provider=True,
        )


@pytest.mark.asyncio
async def test_execution_loop_enforces_token_and_cost_budgets(monkeypatch):
    """Verify ExecutionLoop halts immediately when MAX_TASK_TOKENS or MAX_TASK_COST_USD is exceeded."""
    monkeypatch.setattr(settings, "MAX_TASK_TOKENS", 10000)
    monkeypatch.setattr(settings, "MAX_TASK_COST_USD", 0.50)

    loop = ExecutionLoop(
        tool_registry=default_tool_registry,
        policy_engine=PolicyEngine(),
        verifier=ResultVerifier(),
    )
    policy = AgentPolicy(
        agent_id="agent-exec-ceo",
        allowed_tools=["system_info"],
        max_permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
        max_iterations=5,
        max_tool_calls=5,
    )

    provider = _BudgetExceedingMockProvider(tokens_per_call=25000, cost_per_call=0.05)
    result = await loop.run(
        task_id="task-budget-test-1",
        agent_id="agent-exec-ceo",
        user_prompt="Run market analysis",
        llm_provider=provider,
        agent_policy=policy,
        cancellation_token=CancellationToken(),
    )

    assert result.status == "failed"
    assert "exceeded maximum token budget" in (result.error_message or "")
    assert result.total_tokens == 25000
    assert provider.calls == 1


def test_inspect_provider_configuration_reports_missing_credentials_accurately(monkeypatch):
    """Verify inspect_provider_configuration reports missing credentials without inventing any."""
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(settings, "LLM_API_KEY", None)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", None)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    diag = inspect_provider_configuration()
    assert diag["provider"] == "openai"
    assert diag["is_live_provider"] is True
    assert diag["api_key_configured"] is False
    assert any("LLM_API_KEY" in item and "OPENAI_API_KEY" in item for item in diag["missing_configuration"])
