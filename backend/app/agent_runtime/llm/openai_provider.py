import asyncio
import json
import logging
import time
from typing import List, Dict, Any, Optional, Tuple
import httpx

from backend.app.agent_runtime.llm.base import (
    LLMResponse,
    LLMHealthCheckResult,
    ToolCallRequest,
    LLMUsage,
    LLMConfigError,
    LLMTimeoutError,
    LLMAuthError,
    LLMResponseError,
    LLMRateLimitError,
    redact_secrets,
    estimate_llm_cost_usd,
)
from backend.app.agent_runtime.llm.capabilities import default_capability_registry

logger = logging.getLogger("grandline.llm.openai")


def _extract_retry_after(
    response: httpx.Response,
    fallback_delay: float,
    max_delay: float = 10.0,
) -> Tuple[float, Optional[float]]:
    """
    Extracts Retry-After header from an HTTP 429 response if present and returns
    (bounded_sleep_seconds, raw_retry_after_seconds).
    Never sleeps indefinitely.
    """
    raw_header: Optional[str] = None
    headers = getattr(response, "headers", None)
    if headers and isinstance(headers, (dict, httpx.Headers)):
        raw_header = headers.get("Retry-After") or headers.get("retry-after")

    parsed_retry_after: Optional[float] = None
    if raw_header is not None:
        try:
            val = float(str(raw_header).strip())
            if val >= 0.0:
                parsed_retry_after = val
        except (ValueError, TypeError):
            parsed_retry_after = None

    effective = parsed_retry_after if parsed_retry_after is not None else fallback_delay
    bounded = max(0.05, min(float(effective), float(max_delay)))
    return bounded, parsed_retry_after


class OpenAIProvider:
    """
    OpenAI and OpenAI-compatible cloud provider (OpenAI, Groq, OpenRouter, Gemini OpenAI-compat).
    Supports:
    - Connection health checks
    - OpenRouter provider routing preferences (`provider.require_parameters = true`, `allow_fallbacks = false`)
    - HTTP 429 detection, Retry-After header parsing, and bounded exponential backoff
    - Async request queueing (bounded concurrency semaphore)
    - Timeout handling
    - Token usage & zero-cost / actual / estimated USD cost tracking
    - Secret redaction
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: str = "gpt-4o-mini",
        timeout_seconds: int = 60,
        provider_name: str = "openai",
        max_retries: int = 1,
        retry_base_delay_seconds: float = 0.25,
        max_retry_delay_seconds: float = 10.0,
        max_concurrent_requests: int = 2,
        require_parameters: bool = True,
    ):
        if not api_key or not str(api_key).strip():
            raise LLMConfigError(
                f"Provider '{provider_name}' requires an API key (LLM_API_KEY). None provided."
            )

        self.api_key = str(api_key).strip()
        self.provider_name = (provider_name or "openai").lower().strip()
        self.base_url = (base_url or "https://api.openai.com/v1").rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_retries = max(0, int(max_retries))
        self.retry_base_delay_seconds = max(0.05, float(retry_base_delay_seconds))
        self.max_retry_delay_seconds = max(0.1, float(max_retry_delay_seconds))
        self.max_concurrent_requests = max(1, int(max_concurrent_requests))
        self.require_parameters = bool(require_parameters)
        self.is_live_provider = True
        self._request_semaphore: Optional[asyncio.Semaphore] = None
        self._semaphore_loop: Optional[Any] = None

    def _get_semaphore(self) -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()
        if self._request_semaphore is None or self._semaphore_loop is not loop:
            self._request_semaphore = asyncio.Semaphore(self.max_concurrent_requests)
            self._semaphore_loop = loop
        return self._request_semaphore

    async def check_health(self) -> LLMHealthCheckResult:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        start_t = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=min(10.0, float(self.timeout_seconds))) as client:
                response = await client.get(f"{self.base_url}/models", headers=headers)
                latency_ms = round((time.perf_counter() - start_t) * 1000.0, 2)

                if response.status_code in (401, 403):
                    return LLMHealthCheckResult(
                        healthy=False,
                        provider=self.provider_name,
                        model=self.model,
                        base_url=self.base_url,
                        is_live_provider=True,
                        latency_ms=latency_ms,
                        error="Authentication rejected by provider (HTTP 401/403).",
                    )
                if response.status_code != 200:
                    return LLMHealthCheckResult(
                        healthy=False,
                        provider=self.provider_name,
                        model=self.model,
                        base_url=self.base_url,
                        is_live_provider=True,
                        latency_ms=latency_ms,
                        error=redact_secrets(
                            f"Provider returned HTTP {response.status_code}: {response.text[:300]}"
                        ),
                    )
                try:
                    payload_json = response.json()
                except Exception:
                    payload_json = {}
                if isinstance(payload_json, dict) and isinstance(payload_json.get("data"), list) and payload_json["data"]:
                    model_ids = [
                        str(item.get("id", "")).strip()
                        for item in payload_json["data"]
                        if isinstance(item, dict) and item.get("id")
                    ]
                    if model_ids:
                        target = self.model.strip()
                        matched = any(
                            mid == target
                            or mid.endswith(f"/{target}")
                            or mid.startswith(f"{target}-")
                            for mid in model_ids
                        )
                        if not matched:
                            return LLMHealthCheckResult(
                                healthy=False,
                                provider=self.provider_name,
                                model=self.model,
                                base_url=self.base_url,
                                is_live_provider=True,
                                latency_ms=latency_ms,
                                error=f"MODEL_UNAVAILABLE: Model '{self.model}' is not available on provider '{self.provider_name}'.",
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
                error=redact_secrets(str(e)),
            )

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
    ) -> LLMResponse:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools

        if self.provider_name == "openrouter" and self.require_parameters:
            payload["provider"] = {
                "require_parameters": True,
            }

        async with self._get_semaphore():
            attempt = 0
            while True:
                try:
                    async with httpx.AsyncClient(timeout=float(self.timeout_seconds)) as client:
                        response = await client.post(
                            f"{self.base_url}/chat/completions",
                            headers=headers,
                            json=payload,
                        )

                        if response.status_code in (401, 403):
                            raise LLMAuthError(
                                "Invalid or unauthorized API key provided to LLM provider."
                            )

                        if response.status_code == 429:
                            exp_backoff = self.retry_base_delay_seconds * (2 ** attempt)
                            sleep_sec, raw_retry_after = _extract_retry_after(
                                response,
                                fallback_delay=exp_backoff,
                                max_delay=self.max_retry_delay_seconds,
                            )
                            if attempt < self.max_retries:
                                attempt += 1
                                await asyncio.sleep(sleep_sec)
                                continue
                            retry_hint = (
                                f" (Retry-After: {raw_retry_after}s)"
                                if raw_retry_after is not None
                                else ""
                            )
                            raise LLMRateLimitError(
                                f"LLM Provider rate limit exceeded{retry_hint}. Please try again later.",
                                retry_after_seconds=raw_retry_after,
                            )

                        if response.status_code in (502, 503, 504) and attempt < self.max_retries:
                            attempt += 1
                            delay = min(
                                self.retry_base_delay_seconds * (2 ** (attempt - 1)),
                                self.max_retry_delay_seconds,
                            )
                            await asyncio.sleep(delay)
                            continue

                        if response.status_code != 200:
                            safe_body = redact_secrets(response.text[:500])
                            raise LLMResponseError(
                                f"LLM Provider returned error HTTP {response.status_code}: {safe_body}"
                            )

                        data = response.json()
                        resolved_model = data.get("model") or self.model
                        choice = data.get("choices", [{}])[0]
                        message = choice.get("message", {})
                        finish_reason = choice.get("finish_reason")

                        cap = default_capability_registry.get_capabilities(
                            self.provider_name, resolved_model
                        )
                        is_free_model = bool(
                            cap.is_free or str(self.model).lower().endswith(":free")
                        )

                        usage_raw = data.get("usage", {}) or {}
                        prompt_tokens = int(usage_raw.get("prompt_tokens", 0) or 0)
                        completion_tokens = int(usage_raw.get("completion_tokens", 0) or 0)
                        total_tokens = int(
                            usage_raw.get("total_tokens", prompt_tokens + completion_tokens) or 0
                        )
                        reported_cost_raw = usage_raw.get("cost", usage_raw.get("total_cost"))
                        if reported_cost_raw is not None:
                            actual_cost_usd: Optional[float] = round(
                                max(0.0, float(reported_cost_raw)), 8
                            )
                            cost_usd = actual_cost_usd
                            is_estimated = False
                        elif is_free_model:
                            actual_cost_usd = 0.0
                            cost_usd = 0.0
                            is_estimated = False
                        else:
                            actual_cost_usd = None
                            cost_usd = estimate_llm_cost_usd(
                                model=resolved_model,
                                prompt_tokens=prompt_tokens,
                                completion_tokens=completion_tokens,
                                is_local=False,
                            )
                            is_estimated = True

                        usage = LLMUsage(
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                            total_tokens=total_tokens,
                            estimated_cost_usd=cost_usd,
                            actual_cost_usd=actual_cost_usd,
                            is_estimated_cost=is_estimated,
                            is_free_model=is_free_model,
                            provider=self.provider_name,
                            model=resolved_model,
                        )

                        tool_calls: List[ToolCallRequest] = []
                        for tc in message.get("tool_calls", []) or []:
                            fn = tc.get("function", {})
                            call_id = tc.get("id")
                            args_str = fn.get("arguments", "{}")
                            try:
                                args = (
                                    json.loads(args_str)
                                    if isinstance(args_str, str)
                                    else (args_str or {})
                                )
                            except Exception:
                                args = {}
                            tool_calls.append(
                                ToolCallRequest(
                                    tool_name=fn.get("name", ""),
                                    arguments=args if isinstance(args, dict) else {},
                                    call_id=call_id,
                                )
                            )

                        content = message.get("content")
                        return LLMResponse(
                            content=content,
                            tool_calls=tool_calls,
                            thought=f"{self.provider_name} reasoning completed ({resolved_model})",
                            finish_reason=finish_reason,
                            usage=usage,
                            provider=self.provider_name,
                            model=resolved_model,
                            is_live_provider=True,
                        )

                except httpx.TimeoutException as e:
                    logger.error(f"LLM request timed out after {self.timeout_seconds}s")
                    raise LLMTimeoutError(
                        f"LLM request timed out after {self.timeout_seconds} seconds"
                    ) from e
                except (LLMAuthError, LLMRateLimitError, LLMResponseError, LLMConfigError):
                    raise
                except Exception as e:
                    safe_err = redact_secrets(str(e))
                    logger.error(f"Unexpected error in OpenAI provider: {safe_err}")
                    raise LLMResponseError(
                        f"Failed to communicate with LLM provider: {safe_err}"
                    ) from e
