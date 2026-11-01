import re
from typing import Protocol, List, Dict, Any, Optional
from pydantic import BaseModel, Field


class LLMError(Exception):
    """Base exception for LLM provider errors."""
    pass


class LLMConfigError(LLMError):
    """Raised when an LLM provider is misconfigured or missing credentials."""
    pass


class LLMTimeoutError(LLMError):
    """Raised when an LLM provider request times out."""
    pass


class LLMAuthError(LLMError):
    """Raised when an LLM provider rejects authentication."""
    pass


class LLMResponseError(LLMError):
    """Raised when an LLM provider returns an invalid response."""
    pass


class LLMRateLimitError(LLMResponseError):
    """Raised when an LLM provider returns HTTP 429 rate-limit exceeded."""
    def __init__(self, message: str, retry_after_seconds: Optional[float] = None):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class LLMBudgetExceededError(LLMError):
    """Raised when a task exceeds its maximum token, cost, or duration budget."""
    pass


class LLMZeroCostPolicyError(LLMResponseError):
    """Raised when a model violates the Phase 3.3.3.10 Absolute Zero-Cost Policy."""
    pass


class LLMUnsupportedCapabilityError(LLMResponseError):
    """Raised when a model lacks required capabilities (e.g. tool calling, context window)."""
    pass


# Regex patterns for redacting API keys and bearer tokens from logs/errors
_SECRET_PATTERNS = [
    re.compile(r"(Bearer\s+)[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE),
    re.compile(r"\bsk-[A-Za-z0-9\-_]{8,}\b"),
    re.compile(r"\bgsk_[A-Za-z0-9\-_]{8,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z\-_]{12,}\b"),
    re.compile(r"((?:api[_-]?key|token|secret)\s*[:=]\s*['\"]?)[A-Za-z0-9\-._~+/]{8,}(['\"]?)", re.IGNORECASE),
]


def redact_secrets(text: Optional[str]) -> str:
    """
    Scrubs API keys, Bearer tokens, and secret credentials from strings
    before logging, persisting to database events, or returning error details.
    """
    if not text:
        return ""
    sanitized = str(text)
    sanitized = _SECRET_PATTERNS[0].sub(r"\1[REDACTED]", sanitized)
    sanitized = _SECRET_PATTERNS[1].sub("sk-[REDACTED]", sanitized)
    sanitized = _SECRET_PATTERNS[2].sub("gsk_[REDACTED]", sanitized)
    sanitized = _SECRET_PATTERNS[3].sub("AIza[REDACTED]", sanitized)
    sanitized = _SECRET_PATTERNS[4].sub(r"\1[REDACTED]\2", sanitized)
    return sanitized


# Per-1M token pricing table (USD) for supported cloud models
MODEL_PRICING_PER_1M_TOKENS: Dict[str, Dict[str, float]] = {
    "google/gemma-4-31b-it:free": {"prompt": 0.0, "completion": 0.0},
    "nvidia/nemotron-3.5-super-vl:free": {"prompt": 0.0, "completion": 0.0},
    "dots-studio/dots-3-note-preview:free": {"prompt": 0.0, "completion": 0.0},
    "nvidia/nemotron-3.5-lightning:free": {"prompt": 0.0, "completion": 0.0},
    "liquid/lfm-2.5-2.6b:free": {"prompt": 0.0, "completion": 0.0},
    "openai/gpt-4o-mini": {"prompt": 0.15, "completion": 0.60},
    "openai/gpt-4o": {"prompt": 2.50, "completion": 10.00},
    "openai/gpt-4.1-mini": {"prompt": 0.40, "completion": 1.60},
    "openai/gpt-4.1-nano": {"prompt": 0.10, "completion": 0.40},
    "openai/gpt-4.1": {"prompt": 2.00, "completion": 8.00},
    "google/gemini-2.5-flash": {"prompt": 0.30, "completion": 2.50},
    "google/gemini-2.5-flash-lite": {"prompt": 0.10, "completion": 0.40},
    "google/gemini-2.5-pro": {"prompt": 1.25, "completion": 10.00},
    "google/gemini-2.0-flash-001": {"prompt": 0.10, "completion": 0.40},
    "anthropic/claude-3.5-sonnet": {"prompt": 3.00, "completion": 15.00},
    "meta-llama/llama-3.3-70b-instruct": {"prompt": 0.10, "completion": 0.32},
    "meta-llama/llama-3.1-8b-instruct": {"prompt": 0.05, "completion": 0.08},
    "qwen/qwen-2.5-72b-instruct": {"prompt": 0.36, "completion": 0.40},
    "gpt-4o-mini": {"prompt": 0.15, "completion": 0.60},
    "gpt-4o": {"prompt": 2.50, "completion": 10.00},
    "gpt-4.1-mini": {"prompt": 0.40, "completion": 1.60},
    "gpt-4.1": {"prompt": 2.00, "completion": 8.00},
    "llama-3.3-70b-versatile": {"prompt": 0.59, "completion": 0.79},
    "llama-3.1-8b-instant": {"prompt": 0.05, "completion": 0.08},
    "gemini-2.0-flash": {"prompt": 0.10, "completion": 0.40},
    "gemini-1.5-flash": {"prompt": 0.075, "completion": 0.30},
    "gemini-1.5-pro": {"prompt": 1.25, "completion": 5.00},
}


def estimate_llm_cost_usd(
    model: Optional[str],
    prompt_tokens: int,
    completion_tokens: int,
    is_local: bool = False,
) -> float:
    """Computes estimated USD cost for an LLM call based on token counts and model pricing."""
    if is_local or (prompt_tokens <= 0 and completion_tokens <= 0):
        return 0.0
    model_key = (model or "gpt-4o-mini").lower().strip()
    if model_key.endswith(":free"):
        return 0.0
    pricing = MODEL_PRICING_PER_1M_TOKENS.get(model_key)
    if pricing is None:
        for known_prefix, rates in MODEL_PRICING_PER_1M_TOKENS.items():
            if known_prefix in model_key:
                pricing = rates
                break
    if pricing is None:
        pricing = {"prompt": 0.15, "completion": 0.60}

    cost = (max(0, prompt_tokens) / 1_000_000.0) * pricing["prompt"] + (
        max(0, completion_tokens) / 1_000_000.0
    ) * pricing["completion"]
    return round(cost, 8)


class ToolCallRequest(BaseModel):
    tool_name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)
    call_id: Optional[str] = None


class LLMUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
    actual_cost_usd: Optional[float] = None
    is_estimated_cost: bool = True
    is_free_model: bool = False
    provider: Optional[str] = None
    model: Optional[str] = None

    @property
    def actual_inference_cost_usd(self) -> float:
        if self.actual_cost_usd is not None:
            return round(max(0.0, float(self.actual_cost_usd)), 8)
        if self.is_free_model:
            return 0.0
        return round(max(0.0, float(self.estimated_cost_usd)), 8)


class LLMHealthCheckResult(BaseModel):
    healthy: bool
    provider: str
    model: str
    base_url: Optional[str] = None
    is_live_provider: bool
    latency_ms: Optional[float] = None
    error: Optional[str] = None
    missing_configuration: List[str] = Field(default_factory=list)


class LLMResponse(BaseModel):
    content: Optional[str] = None
    tool_calls: List[ToolCallRequest] = Field(default_factory=list)
    thought: Optional[str] = None
    finish_reason: Optional[str] = None
    usage: LLMUsage = Field(default_factory=LLMUsage)
    provider: Optional[str] = None
    model: Optional[str] = None
    is_live_provider: bool = False
    routing_metadata: Optional[Dict[str, Any]] = None

    @property
    def provider_name(self) -> Optional[str]:
        return self.provider or self.usage.provider

    @property
    def model_name(self) -> Optional[str]:
        return self.model or self.usage.model


class LLMProvider(Protocol):
    provider_name: str
    model: str
    is_live_provider: bool

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
    ) -> LLMResponse:
        """Generates a model completion with optional tool calls."""
        ...

    async def check_health(self) -> LLMHealthCheckResult:
        """Checks connectivity and readiness of the LLM provider."""
        ...
