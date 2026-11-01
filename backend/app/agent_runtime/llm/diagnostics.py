import argparse
import asyncio
import json
import re
import time
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from backend.app.agent_runtime.llm.base import (
    LLMAuthError,
    LLMConfigError,
    LLMError,
    LLMRateLimitError,
    LLMResponseError,
    LLMTimeoutError,
    estimate_llm_cost_usd,
    redact_secrets,
)
from backend.app.agent_runtime.llm.capabilities import default_capability_registry
from backend.app.core.config import settings
from backend.app.agent_runtime.llm.factory import (
    get_llm_provider,
    inspect_provider_configuration,
)


class DiagnosticStatus(str, Enum):
    CONFIGURATION_MISSING = "CONFIGURATION_MISSING"
    CONNECTION_FAILED = "CONNECTION_FAILED"
    AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED"
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    INFERENCE_FAILED = "INFERENCE_FAILED"
    TOOL_CALLING_UNSUPPORTED = "TOOL_CALLING_UNSUPPORTED"
    LIVE_PROVIDER_READY = "LIVE_PROVIDER_READY"


class LiveProviderDiagnosticReport(BaseModel):
    status: DiagnosticStatus
    selected_provider: str
    configured_model: str
    base_url: Optional[str] = None
    is_live_provider: bool = False
    is_zero_cost_verified: bool = False
    input_price_per_1m_usd: Optional[float] = None
    output_price_per_1m_usd: Optional[float] = None
    require_parameters_enabled: bool = False
    credentials_present: bool = False
    provider_connectivity: bool = False
    live_inference_success: bool = False
    structured_response_valid: bool = False
    tool_calling_supported: bool = False
    token_usage_available: bool = False
    cost_estimation_available: bool = False
    latency_ms: Optional[float] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
    actual_inference_cost_usd: float = 0.0
    missing_configuration: List[str] = Field(default_factory=list)
    error_detail: Optional[str] = None


def _extract_json_object(raw_text: Optional[str]) -> Optional[Dict[str, Any]]:
    if not raw_text:
        return None
    cleaned = raw_text.strip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return None


def _is_model_unavailable_error(err_msg: str) -> bool:
    lower = (err_msg or "").lower()
    indicators = (
        "model_unavailable",
        "model_not_found",
        "does not exist",
        "not available",
        "model not found",
        "unknown model",
        "http 404",
        "pull ",
    )
    return any(tok in lower for tok in indicators)


def _is_auth_error(err_msg: str) -> bool:
    lower = (err_msg or "").lower()
    indicators = (
        "401",
        "403",
        "unauthorized",
        "authentication rejected",
        "invalid api key",
        "invalid_api_key",
        "incorrect api key",
    )
    return any(tok in lower for tok in indicators)


async def run_live_provider_diagnostics(
    provider_name: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
    timeout_seconds: Optional[int] = None,
    allow_free_fallback: bool = True,
) -> LiveProviderDiagnosticReport:
    """
    Executes a comprehensive multi-stage diagnostic on the configured LLM provider:
    1. Configuration & credential presence check (never exposing secret values).
    2. Provider connectivity, authentication, and model availability health check.
    3. Live inference & structured JSON response validity probe.
    4. Native tool-calling capability probe.
    5. Token usage & USD cost estimation verification.
    """
    cfg = inspect_provider_configuration(provider_name)
    resolved_provider = str(cfg.get("provider") or "deterministic")
    resolved_model = str(model or cfg.get("model") or "unknown")
    resolved_base_url = base_url or cfg.get("base_url")
    is_live = bool(cfg.get("is_live_provider", False))
    creds_present = bool(api_key or cfg.get("api_key_configured", False))
    missing_cfg = list(cfg.get("missing_configuration") or [])

    cap = default_capability_registry.get_capabilities(resolved_provider, resolved_model)
    zc_ok, _ = default_capability_registry.validate_zero_cost_model(resolved_provider, resolved_model)
    req_params = resolved_provider == "openrouter"

    if not is_live or not creds_present:
        try:
            get_llm_provider(
                provider_name=provider_name,
                api_key=api_key,
                base_url=base_url,
                model=model,
                timeout_seconds=timeout_seconds,
                require_live=True,
                max_retries=0,
            )
        except LLMConfigError as cfg_err:
            return LiveProviderDiagnosticReport(
                status=DiagnosticStatus.CONFIGURATION_MISSING,
                selected_provider=resolved_provider,
                configured_model=resolved_model,
                base_url=resolved_base_url,
                is_live_provider=is_live,
                is_zero_cost_verified=zc_ok,
                input_price_per_1m_usd=cap.input_price_per_1m_usd,
                output_price_per_1m_usd=cap.output_price_per_1m_usd,
                require_parameters_enabled=req_params,
                credentials_present=False,
                missing_configuration=missing_cfg,
                error_detail=redact_secrets(str(cfg_err)),
            )

    try:
        provider = get_llm_provider(
            provider_name=provider_name,
            api_key=api_key,
            base_url=base_url,
            model=model,
            timeout_seconds=timeout_seconds,
            require_live=True,
            max_retries=settings.LLM_MAX_RETRIES,
        )
    except LLMConfigError as cfg_err:
        return LiveProviderDiagnosticReport(
            status=DiagnosticStatus.CONFIGURATION_MISSING,
            selected_provider=resolved_provider,
            configured_model=resolved_model,
            base_url=resolved_base_url,
            is_live_provider=is_live,
            is_zero_cost_verified=zc_ok,
            input_price_per_1m_usd=cap.input_price_per_1m_usd,
            output_price_per_1m_usd=cap.output_price_per_1m_usd,
            require_parameters_enabled=req_params,
            credentials_present=False,
            missing_configuration=missing_cfg,
            error_detail=redact_secrets(str(cfg_err)),
        )

    start_time = time.perf_counter()

    # Stage 1: Health Check (Connectivity, Auth, Model Availability)
    health = await provider.check_health()
    if not health.healthy:
        err_text = redact_secrets(health.error or "Provider health check failed.")
        if _is_auth_error(err_text):
            return LiveProviderDiagnosticReport(
                status=DiagnosticStatus.AUTHENTICATION_FAILED,
                selected_provider=provider.provider_name,
                configured_model=provider.model,
                base_url=health.base_url,
                is_live_provider=True,
                is_zero_cost_verified=zc_ok,
                input_price_per_1m_usd=cap.input_price_per_1m_usd,
                output_price_per_1m_usd=cap.output_price_per_1m_usd,
                require_parameters_enabled=req_params,
                credentials_present=True,
                provider_connectivity=True,
                latency_ms=health.latency_ms,
                error_detail=err_text,
            )
        if _is_model_unavailable_error(err_text):
            return LiveProviderDiagnosticReport(
                status=DiagnosticStatus.MODEL_UNAVAILABLE,
                selected_provider=provider.provider_name,
                configured_model=provider.model,
                base_url=health.base_url,
                is_live_provider=True,
                is_zero_cost_verified=zc_ok,
                input_price_per_1m_usd=cap.input_price_per_1m_usd,
                output_price_per_1m_usd=cap.output_price_per_1m_usd,
                require_parameters_enabled=req_params,
                credentials_present=True,
                provider_connectivity=True,
                latency_ms=health.latency_ms,
                error_detail=err_text,
            )
        return LiveProviderDiagnosticReport(
            status=DiagnosticStatus.CONNECTION_FAILED,
            selected_provider=provider.provider_name,
            configured_model=provider.model,
            base_url=health.base_url,
            is_live_provider=True,
            is_zero_cost_verified=zc_ok,
            input_price_per_1m_usd=cap.input_price_per_1m_usd,
            output_price_per_1m_usd=cap.output_price_per_1m_usd,
            require_parameters_enabled=req_params,
            credentials_present=True,
            provider_connectivity=False,
            latency_ms=health.latency_ms,
            error_detail=err_text,
        )

    # Stage 2: Live Inference & Structured Response Probe
    probe_messages = [
        {
            "role": "system",
            "content": 'You are a diagnostic probe. Respond ONLY with a valid JSON object: {"status": "ok"}',
        },
        {
            "role": "user",
            "content": 'Return {"status": "ok"} as JSON.',
        },
    ]
    try:
        inf_response = await provider.generate(
            messages=probe_messages,
            tools=None,
            temperature=0.0,
        )
    except LLMAuthError as auth_err:
        return LiveProviderDiagnosticReport(
            status=DiagnosticStatus.AUTHENTICATION_FAILED,
            selected_provider=provider.provider_name,
            configured_model=provider.model,
            base_url=health.base_url,
            is_live_provider=True,
            is_zero_cost_verified=zc_ok,
            input_price_per_1m_usd=cap.input_price_per_1m_usd,
            output_price_per_1m_usd=cap.output_price_per_1m_usd,
            require_parameters_enabled=req_params,
            credentials_present=True,
            provider_connectivity=True,
            latency_ms=round((time.perf_counter() - start_time) * 1000.0, 2),
            error_detail=redact_secrets(str(auth_err)),
        )
    except (LLMResponseError, LLMTimeoutError, LLMRateLimitError, LLMError, Exception) as inf_err:
        err_text = redact_secrets(str(inf_err))
        if model is None and allow_free_fallback and zc_ok and resolved_provider == "openrouter":
            for fb_m in getattr(settings, "free_fallback_models_list", []):
                if fb_m == resolved_model:
                    continue
                fb_zc, _ = default_capability_registry.validate_zero_cost_model(resolved_provider, fb_m)
                fb_cap = default_capability_registry.get_capabilities(resolved_provider, fb_m)
                if not fb_zc or not fb_cap.tool_calling:
                    continue
                fb_rep = await run_live_provider_diagnostics(
                    provider_name=provider_name,
                    api_key=api_key,
                    base_url=base_url,
                    model=fb_m,
                    timeout_seconds=timeout_seconds,
                    allow_free_fallback=False,
                )
                if fb_rep.status == DiagnosticStatus.LIVE_PROVIDER_READY:
                    return fb_rep

        diag_status = (
            DiagnosticStatus.MODEL_UNAVAILABLE
            if _is_model_unavailable_error(err_text)
            else DiagnosticStatus.INFERENCE_FAILED
        )
        return LiveProviderDiagnosticReport(
            status=diag_status,
            selected_provider=provider.provider_name,
            configured_model=provider.model,
            base_url=health.base_url,
            is_live_provider=True,
            is_zero_cost_verified=zc_ok,
            input_price_per_1m_usd=cap.input_price_per_1m_usd,
            output_price_per_1m_usd=cap.output_price_per_1m_usd,
            require_parameters_enabled=req_params,
            credentials_present=True,
            provider_connectivity=True,
            live_inference_success=False,
            latency_ms=round((time.perf_counter() - start_time) * 1000.0, 2),
            error_detail=err_text,
        )

    parsed_struct = _extract_json_object(inf_response.content)
    structured_valid = isinstance(parsed_struct, dict) and len(parsed_struct) > 0
    if not structured_valid:
        return LiveProviderDiagnosticReport(
            status=DiagnosticStatus.INFERENCE_FAILED,
            selected_provider=provider.provider_name,
            configured_model=inf_response.model_name or provider.model,
            base_url=health.base_url,
            is_live_provider=True,
            is_zero_cost_verified=zc_ok,
            input_price_per_1m_usd=cap.input_price_per_1m_usd,
            output_price_per_1m_usd=cap.output_price_per_1m_usd,
            require_parameters_enabled=req_params,
            credentials_present=True,
            provider_connectivity=True,
            live_inference_success=True,
            structured_response_valid=False,
            latency_ms=round((time.perf_counter() - start_time) * 1000.0, 2),
            error_detail="Inference returned non-JSON or empty structured response.",
        )

    # Stage 3: Tool Calling Capability Probe
    probe_tools = [
        {
            "type": "function",
            "function": {
                "name": "workspace_list",
                "description": "List files in the workspace directory",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "subpath": {"type": "string", "description": "Relative directory path"}
                    },
                    "required": [],
                },
            },
        }
    ]
    tool_probe_messages = [
        {
            "role": "system",
            "content": "You must invoke the workspace_list tool when asked to inspect the workspace.",
        },
        {
            "role": "user",
            "content": "Call workspace_list with subpath '' now.",
        },
    ]

    try:
        tool_response = await provider.generate(
            messages=tool_probe_messages,
            tools=probe_tools,
            temperature=0.0,
        )
    except Exception as tool_err:
        return LiveProviderDiagnosticReport(
            status=DiagnosticStatus.TOOL_CALLING_UNSUPPORTED,
            selected_provider=provider.provider_name,
            configured_model=inf_response.model_name or provider.model,
            base_url=health.base_url,
            is_live_provider=True,
            credentials_present=True,
            provider_connectivity=True,
            live_inference_success=True,
            structured_response_valid=True,
            tool_calling_supported=False,
            latency_ms=round((time.perf_counter() - start_time) * 1000.0, 2),
            error_detail=redact_secrets(f"Tool calling probe failed: {tool_err}"),
        )

    has_valid_tool_call = bool(
        tool_response.tool_calls
        and any(tc.tool_name == "workspace_list" for tc in tool_response.tool_calls)
    )
    if not has_valid_tool_call:
        return LiveProviderDiagnosticReport(
            status=DiagnosticStatus.TOOL_CALLING_UNSUPPORTED,
            selected_provider=provider.provider_name,
            configured_model=tool_response.model_name or provider.model,
            base_url=health.base_url,
            is_live_provider=True,
            credentials_present=True,
            provider_connectivity=True,
            live_inference_success=True,
            structured_response_valid=True,
            tool_calling_supported=False,
            latency_ms=round((time.perf_counter() - start_time) * 1000.0, 2),
            error_detail="Model did not emit a structured tool call when probed.",
        )

    prompt_tokens = inf_response.usage.prompt_tokens + tool_response.usage.prompt_tokens
    completion_tokens = inf_response.usage.completion_tokens + tool_response.usage.completion_tokens
    total_tokens = inf_response.usage.total_tokens + tool_response.usage.total_tokens
    total_cost = round(
        inf_response.usage.estimated_cost_usd + tool_response.usage.estimated_cost_usd, 8
    )

    token_usage_ok = total_tokens > 0 or prompt_tokens > 0 or completion_tokens > 0
    cost_est_ok = (
        total_cost > 0.0
        or zc_ok
        or provider.provider_name == "ollama"
        or estimate_llm_cost_usd(provider.model, max(1, prompt_tokens), max(1, completion_tokens)) > 0.0
    )

    return LiveProviderDiagnosticReport(
        status=DiagnosticStatus.LIVE_PROVIDER_READY,
        selected_provider=provider.provider_name,
        configured_model=tool_response.model_name or inf_response.model_name or provider.model,
        base_url=health.base_url,
        is_live_provider=True,
        is_zero_cost_verified=zc_ok,
        input_price_per_1m_usd=cap.input_price_per_1m_usd,
        output_price_per_1m_usd=cap.output_price_per_1m_usd,
        require_parameters_enabled=req_params,
        credentials_present=True,
        provider_connectivity=True,
        live_inference_success=True,
        structured_response_valid=True,
        tool_calling_supported=True,
        token_usage_available=token_usage_ok,
        cost_estimation_available=cost_est_ok,
        latency_ms=round((time.perf_counter() - start_time) * 1000.0, 2),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        estimated_cost_usd=total_cost,
        actual_inference_cost_usd=0.0 if zc_ok else total_cost,
    )


async def _cli_main() -> int:
    parser = argparse.ArgumentParser(
        description="PROVIPAGENT Live LLM Provider Diagnostic Command (Phase 3.3.3.7)"
    )
    parser.add_argument(
        "--provider",
        type=str,
        default=None,
        help="Provider to diagnose (openai, groq, openrouter, gemini, ollama, deterministic).",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Optional specific model to test.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run diagnostics across all supported providers.",
    )
    args = parser.parse_args()

    if args.all:
        providers = ["deterministic", "openai", "groq", "openrouter", "gemini", "ollama"]
        results = {}
        for p in providers:
            rep = await run_live_provider_diagnostics(provider_name=p, allow_free_fallback=True)
            results[p] = rep.model_dump()
        print(json.dumps({"active_provider_diagnostics": results}, indent=2))
        return 0

    report = await run_live_provider_diagnostics(
        provider_name=args.provider,
        model=args.model,
        allow_free_fallback=True,
    )
    print(json.dumps(report.model_dump(), indent=2))
    return 0 if report.status == DiagnosticStatus.LIVE_PROVIDER_READY else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_cli_main()))

