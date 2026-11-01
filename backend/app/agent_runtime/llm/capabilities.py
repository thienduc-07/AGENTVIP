from typing import Any, Dict, List, Optional, Tuple
import httpx
from pydantic import BaseModel


class ModelCapabilities(BaseModel):
    provider: str
    model_id: str
    text_generation: bool = True
    tool_calling: bool = False
    multi_tool_calling: bool = False
    multi_turn_tool_execution: bool = False
    structured_output: bool = False
    json_mode: bool = False
    long_context: bool = False
    max_context_tokens: int = 8192
    vision: bool = False
    streaming: bool = True
    is_free: bool = False
    pricing_verified: bool = False
    input_price_per_1m_usd: Optional[float] = None
    output_price_per_1m_usd: Optional[float] = None
    provider_available: bool = True
    recommended_min_ram_gb: float = 4.0
    estimated_disk_gb: float = 0.0
    notes: Optional[str] = None


class CapabilityRequirement(BaseModel):
    require_text_generation: bool = True
    require_tool_calling: bool = False
    require_multi_tool_calling: bool = False
    require_multi_turn_tool_execution: bool = False
    require_structured_output: bool = False
    require_json_mode: bool = False
    require_long_context: bool = False
    min_context_tokens: int = 1024
    require_vision: bool = False
    require_streaming: bool = False


class ModelCapabilityRegistry:
    """
    Authoritative registry of model capability and pricing metadata across local (Ollama)
    and cloud (OpenRouter, OpenAI, Groq, Gemini) providers.
    Enforces:
    - Never assuming unknown or unverified models support tool calling.
    - Absolute Zero-Cost Policy validation (rejecting any model with input/output price > 0,
      missing/unverifiable pricing, openrouter/auto, or generic non-:free OpenRouter IDs).
    """

    def __init__(self) -> None:
        self._models: Dict[Tuple[str, str], ModelCapabilities] = {}
        self._seed_defaults()

    @staticmethod
    def _normalize_key(provider: str, model_id: str) -> Tuple[str, str]:
        p = (provider or "").lower().strip()
        m = (model_id or "").lower().strip()
        if p == "local_ollama":
            p = "ollama"
        return (p, m)

    def _seed_defaults(self) -> None:
        default_models: List[ModelCapabilities] = [
            # Primary Verified Zero-Cost OpenRouter Free Model (Phase 3.3.3.10)
            ModelCapabilities(
                provider="openrouter",
                model_id="google/gemma-4-31b-it:free",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=262144,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                provider_available=True,
                notes="Primary verified $0.00 OpenRouter free model (262,144 context, tools + tool_choice + response_format).",
            ),
            # Verified Zero-Cost OpenRouter Fallback Chain Models (Phase 3.3.3.10 Failover)
            ModelCapabilities(
                provider="openrouter",
                model_id="nvidia/nemotron-3.5-super-vl:free",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=1000000,
                vision=True,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                provider_available=True,
                notes="Verified $0.00 OpenRouter free fallback model (1M context, native tools + tool_choice + structured output).",
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="dots-studio/dots-3-note-preview:free",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=512000,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                provider_available=True,
                notes="Verified $0.00 OpenRouter free fallback model (512k context, native tools + tool_choice + structured output).",
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="nvidia/nemotron-3.5-lightning:free",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=1000000,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                provider_available=True,
                notes="Verified $0.00 OpenRouter free fallback model (1M context, native tools + tool_choice).",
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="liquid/lfm-2.5-2.6b:free",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=65536,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                provider_available=True,
                notes="Verified $0.00 OpenRouter free model (65k context, native tools + structured output).",
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="nvidia/nemotron-3.5-content-safety:free",
                text_generation=True,
                tool_calling=False,
                multi_tool_calling=False,
                multi_turn_tool_execution=False,
                structured_output=False,
                json_mode=False,
                long_context=False,
                max_context_tokens=32768,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                provider_available=True,
                notes="Free OpenRouter content-safety model without tool calling support.",
            ),
            # Local Ollama Models — Zero-Cost Local Inference
            ModelCapabilities(
                provider="ollama",
                model_id="qwen2.5:3b",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=32768,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                recommended_min_ram_gb=4.0,
                estimated_disk_gb=1.9,
                notes="Recommended primary local model for Apple M3 (8GB RAM, 3.9GB free disk).",
            ),
            ModelCapabilities(
                provider="ollama",
                model_id="qwen2.5:1.5b",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=32768,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                recommended_min_ram_gb=2.5,
                estimated_disk_gb=0.98,
                notes="Ultra-compact fallback local model for tight disk/RAM.",
            ),
            ModelCapabilities(
                provider="ollama",
                model_id="llama3.2:3b",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=32768,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                recommended_min_ram_gb=4.5,
                estimated_disk_gb=2.0,
                notes="Compact tool-capable Llama 3.2 3B model for 8GB Apple Silicon.",
            ),
            ModelCapabilities(
                provider="ollama",
                model_id="llama3.2:1b",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=32768,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                recommended_min_ram_gb=2.5,
                estimated_disk_gb=1.3,
            ),
            ModelCapabilities(
                provider="ollama",
                model_id="llama3.1",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=32768,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                recommended_min_ram_gb=8.0,
                estimated_disk_gb=4.7,
            ),
            ModelCapabilities(
                provider="ollama",
                model_id="llama3.1:8b",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=32768,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                recommended_min_ram_gb=8.0,
                estimated_disk_gb=4.7,
            ),
            ModelCapabilities(
                provider="ollama",
                model_id="llama3",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=False,
                max_context_tokens=8192,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                recommended_min_ram_gb=8.0,
                estimated_disk_gb=4.7,
            ),
            ModelCapabilities(
                provider="ollama",
                model_id="qwen2.5:7b",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=32768,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                recommended_min_ram_gb=8.0,
                estimated_disk_gb=4.7,
            ),
            # Local models without native tool calling (used to verify capability filtering)
            ModelCapabilities(
                provider="ollama",
                model_id="tinyllama",
                text_generation=True,
                tool_calling=False,
                multi_tool_calling=False,
                multi_turn_tool_execution=False,
                structured_output=False,
                json_mode=False,
                long_context=False,
                max_context_tokens=2048,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                recommended_min_ram_gb=1.5,
                estimated_disk_gb=0.64,
                notes="Text-only lightweight model; lacks native tool-calling support.",
            ),
            ModelCapabilities(
                provider="ollama",
                model_id="phi3:mini",
                text_generation=True,
                tool_calling=False,
                multi_tool_calling=False,
                multi_turn_tool_execution=False,
                structured_output=True,
                json_mode=True,
                long_context=False,
                max_context_tokens=4096,
                vision=False,
                streaming=True,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
                recommended_min_ram_gb=4.0,
                estimated_disk_gb=2.2,
            ),
            # Paid OpenRouter Cloud Models (Explicitly marked is_free=False with >$0 pricing)
            ModelCapabilities(
                provider="openrouter",
                model_id="openai/gpt-4o-mini",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=128000,
                vision=True,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=0.15,
                output_price_per_1m_usd=0.60,
                notes="Paid OpenRouter cloud model ($0.15/$0.60 per 1M tokens).",
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="openai/gpt-4.1-mini",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=1047576,
                vision=True,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=0.40,
                output_price_per_1m_usd=1.60,
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="openai/gpt-4.1-nano",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=1047576,
                vision=True,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=0.10,
                output_price_per_1m_usd=0.40,
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="openai/gpt-4o",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=128000,
                vision=True,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=2.50,
                output_price_per_1m_usd=10.00,
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="google/gemini-2.5-flash",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=1048576,
                vision=True,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=0.30,
                output_price_per_1m_usd=2.50,
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="google/gemini-2.5-flash-lite",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=1048576,
                vision=True,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=0.10,
                output_price_per_1m_usd=0.40,
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="google/gemini-2.5-pro",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=1048576,
                vision=True,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=1.25,
                output_price_per_1m_usd=10.00,
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="anthropic/claude-3.5-sonnet",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=200000,
                vision=True,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=3.00,
                output_price_per_1m_usd=15.00,
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="google/gemini-2.0-flash-001",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=1000000,
                vision=True,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=0.10,
                output_price_per_1m_usd=0.40,
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="meta-llama/llama-3.3-70b-instruct",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=131072,
                vision=False,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=0.10,
                output_price_per_1m_usd=0.32,
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="meta-llama/llama-3.1-8b-instruct",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=131072,
                vision=False,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=0.05,
                output_price_per_1m_usd=0.08,
            ),
            ModelCapabilities(
                provider="openrouter",
                model_id="qwen/qwen-2.5-72b-instruct",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=32768,
                vision=False,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=0.36,
                output_price_per_1m_usd=0.40,
            ),
            # Direct Paid Cloud Models
            ModelCapabilities(
                provider="openai",
                model_id="gpt-4o-mini",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=128000,
                vision=True,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=0.15,
                output_price_per_1m_usd=0.60,
            ),
            ModelCapabilities(
                provider="openai",
                model_id="gpt-4o",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=128000,
                vision=True,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=2.50,
                output_price_per_1m_usd=10.00,
            ),
            ModelCapabilities(
                provider="groq",
                model_id="llama-3.3-70b-versatile",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=128000,
                vision=False,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=0.59,
                output_price_per_1m_usd=0.79,
            ),
            ModelCapabilities(
                provider="gemini",
                model_id="gemini-2.0-flash",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=1000000,
                vision=True,
                streaming=True,
                is_free=False,
                pricing_verified=True,
                input_price_per_1m_usd=0.10,
                output_price_per_1m_usd=0.40,
            ),
            # Deterministic offline test model
            ModelCapabilities(
                provider="deterministic",
                model_id="deterministic-v1",
                text_generation=True,
                tool_calling=True,
                multi_tool_calling=True,
                multi_turn_tool_execution=True,
                structured_output=True,
                json_mode=True,
                long_context=True,
                max_context_tokens=128000,
                vision=False,
                streaming=False,
                is_free=True,
                pricing_verified=True,
                input_price_per_1m_usd=0.0,
                output_price_per_1m_usd=0.0,
            ),
        ]
        for cap in default_models:
            self.register_model(cap)

    def register_model(self, capabilities: ModelCapabilities) -> None:
        key = self._normalize_key(capabilities.provider, capabilities.model_id)
        self._models[key] = capabilities

    def get_capabilities(self, provider: str, model_id: str) -> ModelCapabilities:
        key = self._normalize_key(provider, model_id)
        if key in self._models:
            return self._models[key]

        p, m = key
        if p == "ollama" and ":" in m and m.endswith(":latest"):
            base_key = (p, m[: -len(":latest")])
            if base_key in self._models:
                return self._models[base_key]

        # Conservative fail-closed default for unregistered models:
        # Never assume unknown models support tool calling or have verified $0 pricing!
        return ModelCapabilities(
            provider=p,
            model_id=model_id,
            text_generation=True,
            tool_calling=False,
            multi_tool_calling=False,
            multi_turn_tool_execution=False,
            structured_output=False,
            json_mode=False,
            long_context=False,
            max_context_tokens=4096,
            vision=False,
            streaming=True,
            is_free=False,
            pricing_verified=False,
            input_price_per_1m_usd=None,
            output_price_per_1m_usd=None,
            notes="Unregistered model: unverified pricing and conservative text-only profile assumed.",
        )

    def validate_zero_cost_model(
        self,
        provider: str,
        model_id: str,
    ) -> Tuple[bool, str]:
        """
        Enforces Phase 3.3.3.10 Absolute Zero-Cost Policy:
        1. Only permits explicitly verified $0 models.
        2. Rejects any model whose input or output price > $0.
        3. Rejects models with missing or unverifiable pricing.
        4. Rejects openrouter/auto or dynamic routing aliases.
        5. Rejects generic OpenRouter model IDs without ':free' suffix.
        """
        p = (provider or "").lower().strip()
        m = (model_id or "").strip()
        m_lower = m.lower()

        if not m:
            return (False, "ZERO_COST_POLICY_VIOLATION: Model ID is empty.")

        if m_lower in ("openrouter/auto", "auto") or m_lower.endswith("/auto"):
            return (
                False,
                f"ZERO_COST_POLICY_VIOLATION: Dynamic router alias '{m}' is forbidden because it can route to paid models.",
            )

        if p in ("ollama", "local_ollama"):
            return (True, f"Local provider '{p}/{m}' is zero token cost ($0.00).")

        cap = self.get_capabilities(p, m)

        if not cap.pricing_verified or cap.input_price_per_1m_usd is None or cap.output_price_per_1m_usd is None:
            return (
                False,
                f"ZERO_COST_POLICY_VIOLATION: Model '{p}/{m}' has missing or unverifiable token pricing.",
            )

        if cap.input_price_per_1m_usd > 0.0 or cap.output_price_per_1m_usd > 0.0 or not cap.is_free:
            return (
                False,
                f"ZERO_COST_POLICY_VIOLATION: Paid model '{p}/{m}' rejected "
                f"(input=${cap.input_price_per_1m_usd:.4f}/1M, output=${cap.output_price_per_1m_usd:.4f}/1M). "
                "Only verified $0.00 models are permitted.",
            )

        if p == "openrouter" and not m_lower.endswith(":free"):
            return (
                False,
                f"ZERO_COST_POLICY_VIOLATION: Generic OpenRouter model ID '{m}' without ':free' suffix "
                "is forbidden because it may resolve to a paid variant.",
            )

        if not cap.provider_available:
            return (
                False,
                f"ZERO_COST_POLICY_VIOLATION: Free model '{p}/{m}' is currently unavailable.",
            )

        return (
            True,
            f"Verified zero-cost model '{p}/{m}' (input=$0.00/1M, output=$0.00/1M).",
        )

    def check_compatibility(
        self,
        provider: str,
        model_id: str,
        requirements: CapabilityRequirement,
    ) -> Tuple[bool, List[str]]:
        cap = self.get_capabilities(provider, model_id)
        missing: List[str] = []

        if requirements.require_text_generation and not cap.text_generation:
            missing.append("text_generation")
        if requirements.require_tool_calling and not cap.tool_calling:
            missing.append("tool_calling")
        if requirements.require_multi_tool_calling and not cap.multi_tool_calling:
            missing.append("multi_tool_calling")
        if requirements.require_multi_turn_tool_execution and not cap.multi_turn_tool_execution:
            missing.append("multi_turn_tool_execution")
        if requirements.require_structured_output and not cap.structured_output:
            missing.append("structured_output")
        if requirements.require_json_mode and not cap.json_mode:
            missing.append("json_mode")
        if requirements.require_long_context and not cap.long_context:
            missing.append("long_context")
        if requirements.min_context_tokens > cap.max_context_tokens:
            missing.append(
                f"context_window({cap.max_context_tokens}<{requirements.min_context_tokens})"
            )
        if requirements.require_vision and not cap.vision:
            missing.append("vision")
        if requirements.require_streaming and not cap.streaming:
            missing.append("streaming")

        return (len(missing) == 0, missing)

    def list_models(self, provider: Optional[str] = None) -> List[ModelCapabilities]:
        if provider is None:
            return list(self._models.values())
        norm_p = provider.lower().strip()
        return [c for c in self._models.values() if c.provider == norm_p]

    @staticmethod
    def parse_openrouter_catalog_entry(entry: Dict[str, object]) -> ModelCapabilities:
        """
        Parses a raw model descriptor from OpenRouter's `/api/v1/models` endpoint into
        a `ModelCapabilities` record, verifying exact input/output pricing and tool parameters.
        """
        model_id = str(entry.get("id") or "").strip()
        supported_params_raw = entry.get("supported_parameters")
        supported_params = (
            [str(p).lower().strip() for p in supported_params_raw]
            if isinstance(supported_params_raw, list)
            else []
        )
        context_len_raw = entry.get("context_length")
        try:
            context_len = int(context_len_raw) if context_len_raw is not None else 4096
        except (ValueError, TypeError):
            context_len = 4096

        arch = entry.get("architecture")
        input_modalities: List[str] = []
        if isinstance(arch, dict) and isinstance(arch.get("input_modalities"), list):
            input_modalities = [str(m).lower() for m in arch["input_modalities"]]

        pricing = entry.get("pricing")
        pricing_verified = False
        in_price_1m: Optional[float] = None
        out_price_1m: Optional[float] = None
        if isinstance(pricing, dict) and "prompt" in pricing and "completion" in pricing:
            try:
                p_val = float(pricing["prompt"])
                c_val = float(pricing["completion"])
                if p_val >= 0.0 and c_val >= 0.0:
                    in_price_1m = round(p_val * 1_000_000.0, 6)
                    out_price_1m = round(c_val * 1_000_000.0, 6)
                    pricing_verified = True
            except (ValueError, TypeError):
                pricing_verified = False

        is_free_verified = (
            pricing_verified
            and in_price_1m == 0.0
            and out_price_1m == 0.0
            and model_id.lower().endswith(":free")
        )

        has_tools = "tools" in supported_params
        has_tool_choice = "tool_choice" in supported_params or has_tools
        has_structured = (
            "structured_outputs" in supported_params
            or "response_format" in supported_params
        )

        return ModelCapabilities(
            provider="openrouter",
            model_id=model_id,
            text_generation=True,
            tool_calling=has_tools,
            multi_tool_calling=has_tools and has_tool_choice,
            multi_turn_tool_execution=has_tools,
            structured_output=has_structured,
            json_mode=has_structured,
            long_context=context_len >= 32768,
            max_context_tokens=context_len,
            vision="image" in input_modalities,
            streaming=True,
            is_free=is_free_verified,
            pricing_verified=pricing_verified,
            input_price_per_1m_usd=in_price_1m,
            output_price_per_1m_usd=out_price_1m,
            provider_available=True,
            notes="Parsed dynamically from OpenRouter /api/v1/models metadata.",
        )

    async def verify_openrouter_model_live_catalog(
        self,
        model_id: str = "google/gemma-4-31b-it:free",
        base_url: str = "https://openrouter.ai/api/v1",
        timeout_seconds: float = 10.0,
    ) -> Dict[str, Any]:
        """
        Queries OpenRouter's live `/api/v1/models` catalog to verify model availability,
        $0.00 input/output pricing, function/tool calling, structured JSON output, and context window.
        """
        clean_base = base_url.rstrip("/")
        target = model_id.strip()
        try:
            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                resp = await client.get(f"{clean_base}/models")
                if resp.status_code != 200:
                    return {
                        "model_id": target,
                        "catalog_reachable": False,
                        "provider_available": False,
                        "error": f"OpenRouter /models returned HTTP {resp.status_code}",
                    }
                data = resp.json().get("data", [])
                matched_entry = next(
                    (
                        item
                        for item in data
                        if isinstance(item, dict) and str(item.get("id", "")).strip() == target
                    ),
                    None,
                )
                if matched_entry is None:
                    return {
                        "model_id": target,
                        "catalog_reachable": True,
                        "provider_available": False,
                        "is_zero_cost_verified": False,
                        "error": f"Model '{target}' not found in live OpenRouter catalog.",
                    }

                parsed = self.parse_openrouter_catalog_entry(matched_entry)
                self.register_model(parsed)
                zc_ok, zc_reason = self.validate_zero_cost_model("openrouter", target)
                return {
                    "model_id": target,
                    "catalog_reachable": True,
                    "provider_available": True,
                    "text_generation": parsed.text_generation,
                    "function_calling": parsed.tool_calling,
                    "tool_calling_multiple_tools": parsed.multi_tool_calling,
                    "multi_turn_tool_execution": parsed.multi_turn_tool_execution,
                    "structured_json_output": parsed.structured_output,
                    "context_length": parsed.max_context_tokens,
                    "input_price_per_1m_usd": parsed.input_price_per_1m_usd,
                    "output_price_per_1m_usd": parsed.output_price_per_1m_usd,
                    "pricing_verified": parsed.pricing_verified,
                    "is_zero_cost_verified": zc_ok,
                    "zero_cost_validation_detail": zc_reason,
                    "supported_parameters": matched_entry.get("supported_parameters", []),
                    "require_parameters_supported": True,
                }
        except Exception as exc:
            return {
                "model_id": target,
                "catalog_reachable": False,
                "provider_available": False,
                "is_zero_cost_verified": False,
                "error": str(exc),
            }


default_capability_registry = ModelCapabilityRegistry()
