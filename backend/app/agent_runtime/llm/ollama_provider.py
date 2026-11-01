import asyncio
import json
import logging
import time
from typing import List, Dict, Any, Optional
import httpx

from backend.app.agent_runtime.llm.base import (
    LLMProvider,
    LLMResponse,
    LLMHealthCheckResult,
    ToolCallRequest,
    LLMUsage,
    LLMTimeoutError,
    LLMResponseError,
    LLMRateLimitError,
    redact_secrets,
)

logger = logging.getLogger("grandline.llm.ollama")


class OllamaProvider:
    """
    Local Ollama LLM Provider (`/api/chat` and `/api/tags`).
    Supports connection health checks, model verification, tool calling,
    timeout handling, bounded retries, and token usage reporting.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        model: str = "llama3",
        timeout_seconds: int = 60,
        max_retries: int = 1,
        retry_base_delay_seconds: float = 0.25,
    ):
        self.provider_name = "ollama"
        self.base_url = (base_url or "http://localhost:11434").rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_retries = max(0, int(max_retries))
        self.retry_base_delay_seconds = max(0.05, float(retry_base_delay_seconds))
        self.is_live_provider = True

    async def check_health(self) -> LLMHealthCheckResult:
        start_t = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=min(5.0, float(self.timeout_seconds))) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                latency_ms = round((time.perf_counter() - start_t) * 1000.0, 2)
                if response.status_code != 200:
                    return LLMHealthCheckResult(
                        healthy=False,
                        provider=self.provider_name,
                        model=self.model,
                        base_url=self.base_url,
                        is_live_provider=True,
                        latency_ms=latency_ms,
                        error=f"Ollama returned HTTP {response.status_code}",
                    )
                try:
                    data = response.json()
                except Exception:
                    data = {}
                if isinstance(data, dict) and "models" in data and isinstance(data["models"], list):
                    available_names = [
                        str(m.get("name", "")).strip()
                        for m in data["models"]
                        if isinstance(m, dict) and m.get("name")
                    ]
                    target = self.model.strip()
                    matched = any(
                        name == target
                        or name == f"{target}:latest"
                        or name.split(":")[0] == target.split(":")[0]
                        for name in available_names
                    )
                    if not matched:
                        return LLMHealthCheckResult(
                            healthy=False,
                            provider=self.provider_name,
                            model=self.model,
                            base_url=self.base_url,
                            is_live_provider=True,
                            latency_ms=latency_ms,
                            error=(
                                f"MODEL_UNAVAILABLE: Model '{self.model}' is not available in Ollama at {self.base_url}. "
                                f"Available models: {available_names or 'none'}. Run 'ollama pull {self.model}'."
                            ),
                        )
                return LLMHealthCheckResult(
                    healthy=True,
                    provider=self.provider_name,
                    model=self.model,
                    base_url=self.base_url,
                    is_live_provider=True,
                    latency_ms=latency_ms,
                )
        except Exception as e:
            latency_ms = round((time.perf_counter() - start_t) * 1000.0, 2)
            return LLMHealthCheckResult(
                healthy=False,
                provider=self.provider_name,
                model=self.model,
                base_url=self.base_url,
                is_live_provider=True,
                latency_ms=latency_ms,
                error=redact_secrets(f"Failed to connect to Ollama at {self.base_url}: {e}"),
            )

    @staticmethod
    def _normalize_messages_for_ollama(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        for msg in messages:
            cloned = dict(msg)
            if cloned.get("content") is None:
                cloned["content"] = ""
            if "tool_calls" in cloned and isinstance(cloned["tool_calls"], list):
                norm_tcs = []
                for tc in cloned["tool_calls"]:
                    tc_copy = dict(tc)
                    fn = dict(tc_copy.get("function", {}) or {})
                    raw_args = fn.get("arguments", {})
                    if isinstance(raw_args, str):
                        try:
                            fn["arguments"] = json.loads(raw_args)
                        except Exception:
                            fn["arguments"] = {}
                    tc_copy["function"] = fn
                    norm_tcs.append(tc_copy)
                cloned["tool_calls"] = norm_tcs
            normalized.append(cloned)
        return normalized

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
    ) -> LLMResponse:
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": self._normalize_messages_for_ollama(messages),
            "stream": False,
            "options": {
                "temperature": temperature,
            },
        }
        if tools:
            payload["tools"] = tools

        attempt = 0
        while True:
            try:
                async with httpx.AsyncClient(timeout=float(self.timeout_seconds)) as client:
                    response = await client.post(
                        f"{self.base_url}/api/chat",
                        json=payload,
                    )

                    if response.status_code == 429:
                        if attempt < self.max_retries:
                            attempt += 1
                            await asyncio.sleep(self.retry_base_delay_seconds * (2 ** (attempt - 1)))
                            continue
                        raise LLMRateLimitError("Ollama rate limit exceeded (HTTP 429).")

                    if response.status_code in (502, 503, 504) and attempt < self.max_retries:
                        attempt += 1
                        await asyncio.sleep(self.retry_base_delay_seconds * (2 ** (attempt - 1)))
                        continue

                    if response.status_code != 200:
                        raise LLMResponseError(
                            f"Ollama returned HTTP {response.status_code}: {redact_secrets(response.text[:500])}"
                        )

                    data = response.json()
                    resolved_model = data.get("model") or self.model
                    msg = data.get("message", {}) or {}
                    content = msg.get("content", "")

                    tool_calls: List[ToolCallRequest] = []
                    for idx, tc in enumerate(msg.get("tool_calls", []) or []):
                        fn = tc.get("function", {}) or {}
                        raw_args = fn.get("arguments", {})
                        if isinstance(raw_args, str):
                            try:
                                parsed_args = json.loads(raw_args)
                            except Exception:
                                parsed_args = {}
                        elif isinstance(raw_args, dict):
                            parsed_args = raw_args
                        else:
                            parsed_args = {}

                        tool_calls.append(
                            ToolCallRequest(
                                tool_name=str(fn.get("name", "")),
                                arguments=parsed_args,
                                call_id=tc.get("id") or f"ollama_call_{idx + 1}",
                            )
                        )

                    prompt_eval_count = int(data.get("prompt_eval_count", 0) or 0)
                    eval_count = int(data.get("eval_count", 0) or 0)
                    usage = LLMUsage(
                        prompt_tokens=prompt_eval_count,
                        completion_tokens=eval_count,
                        total_tokens=prompt_eval_count + eval_count,
                        estimated_cost_usd=0.0,
                        provider=self.provider_name,
                        model=resolved_model,
                    )

                    return LLMResponse(
                        content=content,
                        tool_calls=tool_calls,
                        thought=f"Ollama response ({resolved_model})",
                        finish_reason=data.get("done_reason") or "stop",
                        usage=usage,
                        provider=self.provider_name,
                        model=resolved_model,
                        is_live_provider=True,
                    )

            except httpx.TimeoutException as e:
                raise LLMTimeoutError(
                    f"Ollama request timed out after {self.timeout_seconds}s"
                ) from e
            except (LLMRateLimitError, LLMResponseError):
                raise
            except Exception as e:
                raise LLMResponseError(
                    f"Failed to communicate with Ollama: {redact_secrets(str(e))}"
                ) from e
