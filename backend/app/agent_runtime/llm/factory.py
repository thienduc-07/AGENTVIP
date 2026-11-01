import logging
import os
from typing import Optional, Dict, Any, List

from backend.app.core.config import settings
from backend.app.agent_runtime.llm.base import (
    LLMProvider,
    LLMConfigError,
    LLMHealthCheckResult,
)
from backend.app.agent_runtime.llm.openai_provider import OpenAIProvider
from backend.app.agent_runtime.llm.ollama_provider import OllamaProvider
from backend.app.agent_runtime.llm.deterministic_provider import DeterministicProvider
from backend.app.agent_runtime.llm.router import HybridLLMRouter

logger = logging.getLogger("grandline.llm.factory")

CLOUD_PROVIDER_DEFAULTS: Dict[str, Dict[str, str]] = {
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
        "env_key": "OPENAI_API_KEY",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "default_model": "llama-3.3-70b-versatile",
        "env_key": "GROQ_API_KEY",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "google/gemma-4-31b-it:free",
        "env_key": "OPENROUTER_API_KEY",
    },
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "default_model": "gemini-2.0-flash",
        "env_key": "GEMINI_API_KEY",
    },
}


def _resolve_cloud_api_key(provider_name: str, explicit_key: Optional[str] = None) -> Optional[str]:
    if explicit_key and str(explicit_key).strip():
        return str(explicit_key).strip()
    if settings.LLM_API_KEY and str(settings.LLM_API_KEY).strip():
        return str(settings.LLM_API_KEY).strip()
    if os.environ.get("LLM_API_KEY", "").strip():
        return os.environ["LLM_API_KEY"].strip()

    if provider_name == "openai":
        return (settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY") or "").strip() or None
    if provider_name == "groq":
        return (settings.GROQ_API_KEY or os.environ.get("GROQ_API_KEY") or "").strip() or None
    if provider_name == "openrouter":
        return (settings.OPENROUTER_API_KEY or os.environ.get("OPENROUTER_API_KEY") or "").strip() or None
    if provider_name == "gemini":
        return (
            settings.GEMINI_API_KEY
            or settings.GOOGLE_API_KEY
            or os.environ.get("GEMINI_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
            or ""
        ).strip() or None
    return None


def _resolve_provider_model(provider_name: str, explicit_model: Optional[str] = None) -> str:
    """
    Resolves the target model for a given provider.
    Avoids leaking the OpenAI default ('gpt-4o-mini') into non-OpenAI providers
    ('groq', 'openrouter', 'gemini', 'ollama') unless explicitly overridden.
    """
    if explicit_model and str(explicit_model).strip():
        return str(explicit_model).strip()

    name = provider_name.lower().strip()
    env_llm_model = os.environ.get("LLM_MODEL", "").strip()
    cfg_llm_model = (settings.LLM_MODEL or "").strip()

    if name in ("ollama", "local_ollama"):
        ollama_specific = (settings.OLLAMA_MODEL or os.environ.get("OLLAMA_MODEL") or "").strip()
        if ollama_specific:
            return ollama_specific
        if env_llm_model:
            return env_llm_model
        if cfg_llm_model and cfg_llm_model != "gpt-4o-mini":
            return cfg_llm_model
        return "llama3"

    if name in CLOUD_PROVIDER_DEFAULTS:
        default_model = CLOUD_PROVIDER_DEFAULTS[name]["default_model"]
        if name == "openai":
            return env_llm_model or cfg_llm_model or default_model
        if name == "openrouter":
            env_cloud_model = os.environ.get("LLM_CLOUD_MODEL", "").strip()
            cfg_cloud_model = (settings.LLM_CLOUD_MODEL or "").strip()
            if env_cloud_model:
                return env_cloud_model
            if env_llm_model:
                return env_llm_model
            if cfg_llm_model and cfg_llm_model != "gpt-4o-mini":
                return cfg_llm_model
            if cfg_cloud_model:
                return cfg_cloud_model
            return default_model
        if env_llm_model:
            return env_llm_model
        if cfg_llm_model and cfg_llm_model != "gpt-4o-mini":
            return cfg_llm_model
        return default_model

    return env_llm_model or cfg_llm_model or "deterministic-v1"


def inspect_provider_configuration(provider_name: Optional[str] = None) -> Dict[str, Any]:
    """
    Inspects current LLM provider configuration and returns structured diagnostic metadata
    including any missing credentials or environment variables, WITHOUT exposing secret values.
    """
    name = (provider_name or settings.LLM_PROVIDER or "deterministic").lower().strip()
    missing: List[str] = []

    if name in ("deterministic", "local", "mock", "test"):
        missing.append(
            "LLM_PROVIDER is set to 'deterministic' (offline test engine). "
            "Set LLM_PROVIDER to 'openai', 'groq', 'openrouter', 'gemini', or 'ollama' for live LLM execution."
        )
        return {
            "provider": "deterministic",
            "model": "deterministic-v1",
            "is_live_provider": False,
            "api_key_configured": False,
            "base_url": None,
            "missing_configuration": missing,
        }

    if name in CLOUD_PROVIDER_DEFAULTS:
        defaults = CLOUD_PROVIDER_DEFAULTS[name]
        key = _resolve_cloud_api_key(name)
        env_hint = defaults["env_key"]
        if not key:
            missing.append(f"LLM_API_KEY (or {env_hint})")
        return {
            "provider": name,
            "model": _resolve_provider_model(name),
            "is_live_provider": True,
            "api_key_configured": bool(key),
            "base_url": settings.LLM_BASE_URL or defaults["base_url"],
            "missing_configuration": missing,
        }

    if name in ("ollama", "local_ollama"):
        url = (
            settings.LLM_BASE_URL
            or settings.OLLAMA_BASE_URL
            or os.environ.get("OLLAMA_BASE_URL")
            or "http://localhost:11434"
        )
        model = _resolve_provider_model("ollama")
        return {
            "provider": "ollama",
            "model": model,
            "is_live_provider": True,
            "api_key_configured": True,
            "base_url": url,
            "missing_configuration": missing,
        }

    if name == "hybrid":
        local_url = (
            settings.LLM_LOCAL_BASE_URL
            or settings.OLLAMA_BASE_URL
            or os.environ.get("OLLAMA_BASE_URL")
            or "http://localhost:11434"
        )
        local_model = (
            settings.LLM_LOCAL_MODEL
            or settings.OLLAMA_MODEL
            or os.environ.get("OLLAMA_MODEL")
            or "qwen2.5:3b"
        )
        cloud_prov = (settings.LLM_CLOUD_PROVIDER or "openrouter").lower().strip()
        cloud_key = _resolve_cloud_api_key(cloud_prov)
        cloud_model = settings.LLM_CLOUD_MODEL or _resolve_provider_model(cloud_prov)
        if not cloud_key:
            missing.append(
                f"Cloud fallback key missing for '{cloud_prov}' (OPENROUTER_API_KEY or LLM_API_KEY)"
            )
        return {
            "provider": "hybrid",
            "model": f"local:{local_model}|cloud:{cloud_model}",
            "is_live_provider": True,
            "api_key_configured": bool(cloud_key),
            "base_url": local_url,
            "local_provider": settings.LLM_LOCAL_PROVIDER or "ollama",
            "local_model": local_model,
            "cloud_provider": cloud_prov,
            "cloud_model": cloud_model,
            "missing_configuration": missing,
        }

    missing.append(f"Unsupported LLM_PROVIDER='{name}'")
    return {
        "provider": name,
        "model": settings.LLM_MODEL,
        "is_live_provider": False,
        "api_key_configured": False,
        "base_url": settings.LLM_BASE_URL,
        "missing_configuration": missing,
    }


def create_hybrid_llm_router(
    *,
    local_provider: Optional[LLMProvider] = None,
    cloud_provider: Optional[LLMProvider] = None,
    allow_cloud_fallback: Optional[bool] = None,
    zero_cost_only: Optional[bool] = None,
    organization_id: str = "default-org",
    task_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    timeout_seconds: Optional[int] = None,
    max_retries: Optional[int] = None,
) -> HybridLLMRouter:
    timeout = timeout_seconds or settings.LLM_TIMEOUT_SECONDS
    retries = settings.LLM_MAX_RETRIES if max_retries is None else max_retries
    eff_zero_cost = (
        bool(settings.LLM_ZERO_COST_POLICY)
        if zero_cost_only is None
        else bool(zero_cost_only)
    )

    if local_provider is None:
        local_url = (
            settings.LLM_LOCAL_BASE_URL
            or settings.OLLAMA_BASE_URL
            or os.environ.get("OLLAMA_BASE_URL")
            or "http://localhost:11434"
        )
        local_model = (
            settings.LLM_LOCAL_MODEL
            or settings.OLLAMA_MODEL
            or os.environ.get("OLLAMA_MODEL")
            or "qwen2.5:3b"
        )
        local_provider = OllamaProvider(
            base_url=local_url,
            model=local_model,
            timeout_seconds=timeout,
            max_retries=retries,
            retry_base_delay_seconds=settings.LLM_RETRY_BASE_DELAY_SECONDS,
        )

    fallback_cloud_providers: List[LLMProvider] = []
    if cloud_provider is None:
        cloud_name = (settings.LLM_CLOUD_PROVIDER or "openrouter").lower().strip()
        defaults = CLOUD_PROVIDER_DEFAULTS.get(
            cloud_name, CLOUD_PROVIDER_DEFAULTS["openrouter"]
        )
        cloud_key = _resolve_cloud_api_key(cloud_name)
        if cloud_key:
            cloud_url = settings.LLM_BASE_URL or defaults["base_url"]
            cloud_model = settings.LLM_CLOUD_MODEL or _resolve_provider_model(cloud_name)
            cloud_provider = OpenAIProvider(
                api_key=cloud_key,
                base_url=cloud_url,
                model=cloud_model,
                timeout_seconds=timeout,
                provider_name=cloud_name,
                max_retries=retries,
                retry_base_delay_seconds=settings.LLM_RETRY_BASE_DELAY_SECONDS,
                max_concurrent_requests=getattr(settings, "LLM_MAX_CONCURRENT_REQUESTS", 2),
            )
            if eff_zero_cost:
                fb_models = [m for m in getattr(settings, "free_fallback_models_list", []) if m != cloud_model]
                for fbm in fb_models:
                    fallback_cloud_providers.append(
                        OpenAIProvider(
                            api_key=cloud_key,
                            base_url=cloud_url,
                            model=fbm,
                            timeout_seconds=timeout,
                            provider_name=cloud_name,
                            max_retries=retries,
                            retry_base_delay_seconds=settings.LLM_RETRY_BASE_DELAY_SECONDS,
                            max_concurrent_requests=getattr(settings, "LLM_MAX_CONCURRENT_REQUESTS", 2),
                        )
                    )

    return HybridLLMRouter(
        local_provider=local_provider,
        cloud_provider=cloud_provider,
        fallback_cloud_providers=fallback_cloud_providers,
        allow_cloud_fallback=allow_cloud_fallback,
        zero_cost_only=eff_zero_cost,
        organization_id=organization_id,
        task_id=task_id,
        agent_id=agent_id,
    )


def get_llm_provider(
    provider_name: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
    timeout_seconds: Optional[int] = None,
    require_live: bool = False,
    max_retries: Optional[int] = None,
    organization_id: str = "default-org",
    task_id: Optional[str] = None,
    agent_id: Optional[str] = None,
) -> LLMProvider:
    if provider_name is None and (settings.LLM_ROUTING_MODE or "").lower().strip() == "hybrid":
        cloud_prov = (settings.LLM_CLOUD_PROVIDER or "openrouter").lower().strip()
        has_cloud_key = bool(_resolve_cloud_api_key(cloud_prov, explicit_key=api_key))
        prov_setting = (settings.LLM_PROVIDER or "deterministic").lower().strip()
        if has_cloud_key or prov_setting not in ("deterministic", "local", "mock", "test"):
            name = "hybrid"
        else:
            name = prov_setting
    else:
        name = (provider_name or settings.LLM_PROVIDER).lower().strip()
    timeout = timeout_seconds or settings.LLM_TIMEOUT_SECONDS
    retries = settings.LLM_MAX_RETRIES if max_retries is None else max_retries

    if name == "hybrid":
        return create_hybrid_llm_router(
            organization_id=organization_id,
            task_id=task_id,
            agent_id=agent_id,
            timeout_seconds=timeout,
            max_retries=retries,
        )

    if name in ("deterministic", "local", "mock", "test"):
        if require_live:
            raise LLMConfigError(
                "DeterministicProvider cannot be used when require_live=True. "
                "Configure a live provider (LLM_PROVIDER='openai'|'groq'|'openrouter'|'gemini' with LLM_API_KEY, "
                "or LLM_PROVIDER='ollama' with a running Ollama server)."
            )
        return DeterministicProvider(model=model or "deterministic-v1")

    if name in CLOUD_PROVIDER_DEFAULTS:
        defaults = CLOUD_PROVIDER_DEFAULTS[name]
        key = _resolve_cloud_api_key(name, explicit_key=api_key)
        if not key:
            raise LLMConfigError(
                f"Provider '{name}' requires an API key, but LLM_API_KEY (or {defaults['env_key']}) is not configured. "
                f"Please set LLM_API_KEY in .env or switch LLM_PROVIDER to 'deterministic'."
            )
        resolved_url = base_url or settings.LLM_BASE_URL or defaults["base_url"]
        resolved_model = _resolve_provider_model(name, explicit_model=model)
        return OpenAIProvider(
            api_key=key,
            base_url=resolved_url,
            model=resolved_model,
            timeout_seconds=timeout,
            provider_name=name,
            max_retries=retries,
            retry_base_delay_seconds=settings.LLM_RETRY_BASE_DELAY_SECONDS,
        )

    if name in ("ollama", "local_ollama"):
        url = (
            base_url
            or settings.LLM_BASE_URL
            or settings.OLLAMA_BASE_URL
            or os.environ.get("OLLAMA_BASE_URL")
            or "http://localhost:11434"
        )
        resolved_model = _resolve_provider_model("ollama", explicit_model=model)
        return OllamaProvider(
            base_url=url,
            model=resolved_model,
            timeout_seconds=timeout,
            max_retries=retries,
            retry_base_delay_seconds=settings.LLM_RETRY_BASE_DELAY_SECONDS,
        )

    raise LLMConfigError(
        f"Unsupported LLM provider '{name}'. Supported providers: 'deterministic', 'openai', 'groq', 'openrouter', 'gemini', 'ollama'."
    )


async def check_llm_provider_health(
    provider_name: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
    require_live: bool = False,
) -> LLMHealthCheckResult:
    """
    Validates configuration and runs a live health check against the target LLM provider.
    Never treats DeterministicProvider as healthy when `require_live=True`.
    """
    cfg_info = inspect_provider_configuration(provider_name)
    try:
        provider = get_llm_provider(
            provider_name=provider_name,
            api_key=api_key,
            base_url=base_url,
            model=model,
            require_live=require_live,
            max_retries=0,
        )
        health = await provider.check_health()
        if require_live and not health.is_live_provider:
            return LLMHealthCheckResult(
                healthy=False,
                provider=health.provider,
                model=health.model,
                base_url=health.base_url,
                is_live_provider=False,
                error="DeterministicProvider is not a live LLM provider.",
                missing_configuration=cfg_info["missing_configuration"],
            )
        return health
    except LLMConfigError as cfg_err:
        return LLMHealthCheckResult(
            healthy=False,
            provider=cfg_info["provider"],
            model=cfg_info["model"],
            base_url=cfg_info["base_url"],
            is_live_provider=cfg_info["is_live_provider"],
            error=str(cfg_err),
            missing_configuration=cfg_info["missing_configuration"],
        )
