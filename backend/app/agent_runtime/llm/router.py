import asyncio
import logging
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.agent_runtime.llm.base import (
    LLMBudgetExceededError,
    LLMHealthCheckResult,
    LLMProvider,
    LLMRateLimitError,
    LLMResponse,
    LLMResponseError,
    LLMUnsupportedCapabilityError,
    LLMZeroCostPolicyError,
    redact_secrets,
)
from backend.app.agent_runtime.llm.capabilities import (
    CapabilityRequirement,
    ModelCapabilityRegistry,
    default_capability_registry,
)
from backend.app.agent_runtime.llm.complexity import (
    TaskComplexityAnalyzer,
    TaskComplexityAssessment,
    TaskComplexityLevel,
    default_complexity_analyzer,
)
from backend.app.agent_runtime.llm.cost_controller import (
    CloudCostController,
    default_cost_controller,
)
from backend.app.agent_runtime.llm.health_monitor import (
    ProviderHealthMonitor,
    ProviderHealthSnapshot,
    ProviderHealthState,
    default_health_monitor,
)

logger = logging.getLogger("grandline.llm.router")

_GLOBAL_DECISION_HISTORY: Deque["RoutingDecisionRecord"] = deque(maxlen=500)


class RoutingDecisionRecord(BaseModel):
    decision_id: str = Field(default_factory=lambda: f"route-{uuid.uuid4().hex[:12]}")
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    organization_id: str = "default-org"
    task_id: Optional[str] = None
    agent_id: Optional[str] = None
    selected_provider: Optional[str] = None
    selected_model: Optional[str] = None
    task_complexity: str = "LOW"
    complexity_score: int = 0
    routing_reason: str = ""
    fallback_triggered: bool = False
    fallback_reason: Optional[str] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0
    actual_inference_cost_usd: float = 0.0
    estimated_inference_cost_usd: float = 0.0
    is_estimated_cost: bool = False
    is_free_model: bool = False
    zero_cost_policy_enforced: bool = False
    rate_limit_status: str = "OK"
    execution_duration_ms: float = 0.0
    provider_status: str = "UNKNOWN"
    success: bool = False
    error_detail: Optional[str] = None


class HybridLLMRouter:
    """
    Production Hybrid LLM Intelligence, Dynamic Provider Router & Zero-Cost Policy Gate.
    Coordinates:
    - TaskComplexityAnalyzer (LOW / MEDIUM / HIGH deterministic scoring)
    - ModelCapabilityRegistry (tool calling, structured output, context window, and $0 zero-cost checks)
    - CloudCostController (tenant-isolated org/task cloud USD, request quotas, and nonzero-cost circuit breaker)
    - ProviderHealthMonitor (cached TTL health state & failure counters)
    - Controlled fail-closed routing between Local (Ollama) and Cloud (OpenRouter Free / Paid)
    """

    def __init__(
        self,
        local_provider: Optional[LLMProvider] = None,
        cloud_provider: Optional[LLMProvider] = None,
        *,
        complexity_analyzer: Optional[TaskComplexityAnalyzer] = None,
        capability_registry: Optional[ModelCapabilityRegistry] = None,
        cost_controller: Optional[CloudCostController] = None,
        health_monitor: Optional[ProviderHealthMonitor] = None,
        allow_cloud_fallback: Optional[bool] = None,
        zero_cost_only: Optional[bool] = None,
        organization_id: str = "default-org",
        task_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        task_priority: Optional[str] = None,
        plan_steps_count: int = 0,
        max_decision_history: int = 500,
        fallback_cloud_providers: Optional[List[LLMProvider]] = None,
    ) -> None:
        self.local_provider = local_provider
        self.cloud_provider = cloud_provider
        self.complexity_analyzer = complexity_analyzer or default_complexity_analyzer
        self.capability_registry = capability_registry or default_capability_registry
        self.cost_controller = cost_controller or default_cost_controller
        self.health_monitor = health_monitor or default_health_monitor
        self.allow_cloud_fallback = (
            bool(settings.LLM_ALLOW_CLOUD_FALLBACK)
            if allow_cloud_fallback is None
            else bool(allow_cloud_fallback)
        )
        if zero_cost_only is not None:
            self.zero_cost_only = bool(zero_cost_only)
        elif cloud_provider is not None and str(getattr(cloud_provider, "model", "")).lower().endswith(":free"):
            self.zero_cost_only = True
        else:
            self.zero_cost_only = False

        self.fallback_cloud_providers: List[LLMProvider] = list(fallback_cloud_providers or [])
        if (
            not self.fallback_cloud_providers
            and self.zero_cost_only
            and cloud_provider is not None
            and getattr(cloud_provider, "is_live_provider", False)
            and getattr(cloud_provider, "api_key", None)
        ):
            from backend.app.agent_runtime.llm.openai_provider import OpenAIProvider

            cloud_m = str(getattr(cloud_provider, "model", "")).strip()
            fb_models = [m for m in getattr(settings, "free_fallback_models_list", []) if m != cloud_m]
            for fbm in fb_models:
                self.fallback_cloud_providers.append(
                    OpenAIProvider(
                        api_key=getattr(cloud_provider, "api_key"),
                        base_url=getattr(cloud_provider, "base_url"),
                        model=fbm,
                        timeout_seconds=getattr(cloud_provider, "timeout_seconds", 60),
                        provider_name=getattr(cloud_provider, "provider_name", "openrouter"),
                        max_retries=getattr(cloud_provider, "max_retries", 2),
                        retry_base_delay_seconds=getattr(cloud_provider, "retry_base_delay_seconds", 0.5),
                        max_concurrent_requests=getattr(cloud_provider, "max_concurrent_requests", 2),
                    )
                )

        self.organization_id = (organization_id or "default-org").strip()
        self.task_id = task_id
        self.agent_id = agent_id
        self.task_priority = task_priority
        self.plan_steps_count = plan_steps_count

        self.provider_name = "hybrid"
        self.model = "hybrid-router"
        self.is_live_provider = True
        self._decision_history: Deque[RoutingDecisionRecord] = deque(
            maxlen=max(50, int(max_decision_history))
        )
        self._request_queue_sem: Optional[asyncio.Semaphore] = None
        self._queue_sem_loop: Optional[Any] = None

    def _get_queue_sem(self) -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()
        if self._request_queue_sem is None or self._queue_sem_loop is not loop:
            self._request_queue_sem = asyncio.Semaphore(
                max(1, int(getattr(settings, "LLM_MAX_CONCURRENT_REQUESTS", 2)))
            )
            self._queue_sem_loop = loop
        return self._request_queue_sem

    def bind_context(
        self,
        *,
        organization_id: Optional[str] = None,
        task_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        task_priority: Optional[str] = None,
        plan_steps_count: Optional[int] = None,
    ) -> "HybridLLMRouter":
        if organization_id is not None:
            self.organization_id = organization_id.strip() or "default-org"
        if task_id is not None:
            self.task_id = task_id
        if agent_id is not None:
            self.agent_id = agent_id
        if task_priority is not None:
            self.task_priority = task_priority
        if plan_steps_count is not None:
            self.plan_steps_count = plan_steps_count
        return self

    @staticmethod
    def _is_cloud_provider(provider: LLMProvider) -> bool:
        name = (getattr(provider, "provider_name", "") or "").lower().strip()
        return name not in ("ollama", "local_ollama", "deterministic", "local", "mock")

    def _is_verified_zero_cost_candidate(self, candidate: Optional[LLMProvider]) -> bool:
        if candidate is None:
            return False
        ok, _ = self.capability_registry.validate_zero_cost_model(
            candidate.provider_name, candidate.model
        )
        return ok

    def _verify_zero_cost_fallback_candidate(
        self,
        candidate: Optional[LLMProvider],
        requirements: CapabilityRequirement,
    ) -> Tuple[bool, str]:
        """
        Enforces Phase 3.3.3.10 Safe Free-Only Fallback Chain Verification:
        1. Verify model ID (must end in :free, not openrouter/auto or generic paid).
        2. Verify input price is strictly zero ($0.00).
        3. Verify output price is strictly zero ($0.00).
        4. Verify tool calling and capability support.
        5. Verify model availability.
        """
        if candidate is None:
            return False, "Fallback candidate is None"

        m = str(getattr(candidate, "model", "")).strip()
        m_lower = m.lower()
        p = str(getattr(candidate, "provider_name", "openrouter")).lower().strip()

        # Check 1: Model ID verification
        if not m or m_lower in ("openrouter/auto", "auto") or m_lower.endswith("/auto"):
            return False, f"ZERO_COST_POLICY_VIOLATION: Fallback model '{m}' is an auto router alias."
        if p == "openrouter" and not m_lower.endswith(":free"):
            return False, f"ZERO_COST_POLICY_VIOLATION: Fallback model '{m}' lacks required ':free' suffix."

        # Check 2 & 3: Input price is zero & output price is zero
        zc_ok, zc_reason = self.capability_registry.validate_zero_cost_model(p, m)
        if not zc_ok:
            return False, zc_reason

        cap = self.capability_registry.get_capabilities(p, m)
        if cap.input_price_per_1m_usd != 0.0 or cap.output_price_per_1m_usd != 0.0 or not cap.is_free:
            return (
                False,
                f"ZERO_COST_POLICY_VIOLATION: Model '{p}/{m}' is paid (input=${cap.input_price_per_1m_usd}, output=${cap.output_price_per_1m_usd}).",
            )

        # Check 4: Tool calling support
        if requirements.require_tool_calling and not cap.tool_calling:
            return False, f"UNSUPPORTED_CAPABILITY: Fallback model '{p}/{m}' lacks tool_calling."
        compat, missing = self.capability_registry.check_compatibility(p, m, requirements)
        if not compat:
            return False, f"UNSUPPORTED_CAPABILITY: Fallback model '{p}/{m}' lacks capabilities: {', '.join(missing)}."

        # Check 5: Model availability
        if not cap.provider_available:
            return False, f"MODEL_UNAVAILABLE: Fallback model '{p}/{m}' is marked unavailable."

        return True, f"Verified zero-cost fallback model '{p}/{m}' ($0/$0, tool_calling=True)."

    async def check_health(self) -> LLMHealthCheckResult:
        local_snap: Optional[ProviderHealthSnapshot] = None
        cloud_snap: Optional[ProviderHealthSnapshot] = None

        if self.local_provider is not None:
            local_snap = await self.health_monitor.check_provider_health(self.local_provider)
        if self.cloud_provider is not None:
            cloud_snap = await self.health_monitor.check_provider_health(self.cloud_provider)

        local_ok = local_snap is not None and local_snap.state in (
            ProviderHealthState.HEALTHY,
            ProviderHealthState.DEGRADED,
        )
        cloud_ok = cloud_snap is not None and cloud_snap.state in (
            ProviderHealthState.HEALTHY,
            ProviderHealthState.DEGRADED,
        )

        if not cloud_ok and self.zero_cost_only and self.fallback_cloud_providers:
            for fb in self.fallback_cloud_providers:
                if self._is_verified_zero_cost_candidate(fb):
                    snap = await self.health_monitor.check_provider_health(fb)
                    if snap.state in (ProviderHealthState.HEALTHY, ProviderHealthState.DEGRADED):
                        cloud_ok = True
                        cloud_snap = snap
                        break

        if local_ok or cloud_ok:
            active_p = (
                self.local_provider.provider_name
                if local_ok and self.local_provider
                else (cloud_snap.provider if cloud_snap else "openrouter")
            )
            active_m = (
                self.local_provider.model
                if local_ok and self.local_provider
                else (cloud_snap.model if cloud_snap else "hybrid-router")
            )
            return LLMHealthCheckResult(
                healthy=True,
                provider=active_p,
                model=active_m,
                is_live_provider=True,
            )

        errors = []
        if local_snap and local_snap.last_error:
            errors.append(f"local({local_snap.provider}): {local_snap.last_error}")
        elif self.local_provider is None:
            errors.append("local: not configured")
        if cloud_snap and cloud_snap.last_error:
            errors.append(f"cloud({cloud_snap.provider}): {cloud_snap.last_error}")
        elif self.cloud_provider is None:
            errors.append("cloud: not configured")

        return LLMHealthCheckResult(
            healthy=False,
            provider="hybrid",
            model="hybrid-router",
            is_live_provider=True,
            error=redact_secrets("; ".join(errors) or "All hybrid providers are unavailable."),
        )

    async def _evaluate_candidate(
        self,
        candidate: Optional[LLMProvider],
        *,
        candidate_tier: str,
        requirements: CapabilityRequirement,
        estimated_prompt_tokens: int,
        organization_id: str,
        task_id: Optional[str],
        agent_id: Optional[str],
    ) -> Tuple[bool, str, ProviderHealthState]:
        """
        Validates whether a candidate provider (local or cloud) can execute the current request:
        1. Provider instance is present and is a live provider (never DeterministicProvider when live required).
        2. If zero_cost_only is True: enforces Absolute Zero-Cost Policy (rejects paid, unverified, or auto models).
        3. Model Capability Registry confirms model satisfies task requirements (e.g. tool_calling).
        4. If cloud tier: CloudCostController confirms org/task cloud budgets, daily request quota, and alerts.
        5. ProviderHealthMonitor confirms provider is HEALTHY or DEGRADED.
        """
        if candidate is None:
            return (
                False,
                f"{candidate_tier}_provider_unconfigured",
                ProviderHealthState.UNAVAILABLE,
            )

        if not getattr(candidate, "is_live_provider", False):
            return (
                False,
                f"{candidate_tier}_provider_not_live({candidate.provider_name})",
                ProviderHealthState.UNAVAILABLE,
            )

        # Enforce Absolute Zero-Cost Policy when active
        if self.zero_cost_only:
            zc_ok, zc_reason = self.capability_registry.validate_zero_cost_model(
                provider=candidate.provider_name,
                model_id=candidate.model,
            )
            if not zc_ok:
                self.cost_controller.record_rejected_paid_request(
                    organization_id=organization_id,
                    task_id=task_id,
                    agent_id=agent_id,
                    model=f"{candidate.provider_name}/{candidate.model}",
                    reason=zc_reason,
                )
                return (
                    False,
                    zc_reason,
                    ProviderHealthState.MODEL_UNAVAILABLE,
                )

        if candidate_tier.startswith("cloud_fallback") and self.zero_cost_only:
            v_ok, v_reason = self._verify_zero_cost_fallback_candidate(candidate, requirements)
            if not v_ok:
                return (
                    False,
                    f"FALLBACK_VERIFICATION_FAILED: {v_reason}",
                    ProviderHealthState.MODEL_UNAVAILABLE,
                )

        # Check Model Capability Registry
        compatible, missing_caps = self.capability_registry.check_compatibility(
            provider=candidate.provider_name,
            model_id=candidate.model,
            requirements=requirements,
        )
        if not compatible:
            return (
                False,
                f"UNSUPPORTED_CAPABILITY: {candidate.provider_name}/{candidate.model} lacks required capabilities: {', '.join(missing_caps)}",
                ProviderHealthState.MODEL_UNAVAILABLE,
            )

        # If cloud provider, check cloud cost & request budgets BEFORE health/inference
        is_cloud = self._is_cloud_provider(candidate)
        if is_cloud:
            budget_ok, budget_reason = self.cost_controller.check_cloud_budget(
                organization_id=organization_id,
                task_id=task_id,
                estimated_prompt_tokens=estimated_prompt_tokens,
                model=candidate.model,
            )
            if not budget_ok:
                return (
                    False,
                    f"cloud_budget_rejected: {budget_reason}",
                    ProviderHealthState.UNAVAILABLE,
                )

        # Check Provider Health Monitor
        snap = await self.health_monitor.check_provider_health(candidate)
        if snap.state not in (ProviderHealthState.HEALTHY, ProviderHealthState.DEGRADED):
            return (
                False,
                f"{candidate.provider_name}/{candidate.model} health is {snap.state.value}"
                + (f" ({snap.last_error})" if snap.last_error else ""),
                snap.state,
            )

        return (True, f"{candidate.provider_name}/{candidate.model} ready", snap.state)

    def _emit_routing_event(
        self,
        db: Optional[Session],
        event_type: str,
        record: RoutingDecisionRecord,
    ) -> None:
        if db is None:
            return
        try:
            from backend.app.services.event_service import event_service
            event_service.create_event(
                db=db,
                event_type=event_type,
                agent_id=record.agent_id,
                task_id=record.task_id,
                organization_id=record.organization_id,
                payload=record.model_dump(),
                commit=True,
            )
        except Exception as ev_err:
            logger.debug(f"Routing event '{event_type}' persistence skipped: {ev_err}")

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
        organization_id: Optional[str] = None,
        task_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        task_priority: Optional[str] = None,
        plan_steps_count: Optional[int] = None,
        explicit_complexity: Optional[TaskComplexityLevel] = None,
        allow_cloud_fallback: Optional[bool] = None,
        db: Optional[Session] = None,
    ) -> LLMResponse:
        start_perf = time.perf_counter()
        eff_org = (organization_id or self.organization_id or "default-org").strip()
        eff_task = task_id if task_id is not None else self.task_id
        eff_agent = agent_id if agent_id is not None else self.agent_id
        eff_prio = task_priority if task_priority is not None else self.task_priority
        eff_steps = plan_steps_count if plan_steps_count is not None else self.plan_steps_count
        eff_allow_fallback = (
            self.allow_cloud_fallback
            if allow_cloud_fallback is None
            else bool(allow_cloud_fallback)
        )

        # 1. Classify task complexity & capability requirements
        assessment: TaskComplexityAssessment = self.complexity_analyzer.analyze(
            messages=messages,
            tools=tools,
            task_priority=eff_prio,
            agent_id=eff_agent,
            plan_steps_count=eff_steps,
            explicit_complexity=explicit_complexity,
        )

        # 2. Build ordered candidate plan
        if self.zero_cost_only:
            # Phase 3.3.3.10 Zero-Cost Routing Rules:
            # - LOW complexity: use an available local provider if configured; otherwise use the verified free cloud model.
            # - MEDIUM complexity: use the verified free cloud model.
            # - HIGH complexity: use the verified free cloud model only if it passes capability validation.
            if assessment.complexity == TaskComplexityLevel.HIGH:
                candidate_plan: List[Tuple[str, Optional[LLMProvider], str]] = [
                    (
                        "cloud",
                        self.cloud_provider,
                        f"HIGH complexity (score={assessment.score}) routes to verified free cloud model if capability-validated",
                    ),
                ]
            elif assessment.complexity == TaskComplexityLevel.MEDIUM:
                if self.cloud_provider is not None:
                    candidate_plan = [
                        (
                            "cloud",
                            self.cloud_provider,
                            f"MEDIUM complexity (score={assessment.score}) routes to verified free cloud model",
                        ),
                    ]
                else:
                    candidate_plan = [
                        (
                            "local",
                            self.local_provider,
                            f"MEDIUM complexity (score={assessment.score}) routes to local provider",
                        ),
                    ]
            else:
                if self.local_provider is not None:
                    candidate_plan = [
                        (
                            "local",
                            self.local_provider,
                            f"LOW complexity (score={assessment.score}) routes to local provider if available",
                        ),
                        (
                            "cloud",
                            self.cloud_provider,
                            f"LOW complexity routes to verified free cloud model when local provider unavailable",
                        ),
                    ]
                else:
                    candidate_plan = [
                        (
                            "cloud",
                            self.cloud_provider,
                            f"LOW complexity (score={assessment.score}) routes to verified free cloud model (no local provider configured)",
                        ),
                    ]

            # Append safe zero-cost fallback chain candidates (Phase 3.3.3.10 Failover)
            if self.fallback_cloud_providers:
                for fb_idx, fb_cand in enumerate(self.fallback_cloud_providers):
                    candidate_plan.append((
                        f"cloud_fallback_{fb_idx + 1}",
                        fb_cand,
                        f"Zero-cost fallback #{fb_idx + 1} to verified free model '{fb_cand.model}'",
                    ))
        else:
            # Standard Hybrid Routing (Phase 3.3.3.8)
            if assessment.complexity == TaskComplexityLevel.HIGH:
                candidate_plan = [
                    (
                        "cloud",
                        self.cloud_provider,
                        f"HIGH complexity (score={assessment.score}) routes to cloud provider",
                    ),
                ]
            elif assessment.complexity == TaskComplexityLevel.MEDIUM:
                candidate_plan = [
                    (
                        "local",
                        self.local_provider,
                        f"MEDIUM complexity (score={assessment.score}) prefers capable healthy local provider",
                    ),
                    (
                        "cloud",
                        self.cloud_provider,
                        f"MEDIUM complexity cloud fallback from local provider",
                    ),
                ]
            else:
                candidate_plan = [
                    (
                        "local",
                        self.local_provider,
                        f"LOW complexity (score={assessment.score}) routes to local Ollama provider",
                    ),
                    (
                        "cloud",
                        self.cloud_provider,
                        f"LOW complexity cloud fallback from local provider",
                    ),
                ]

        attempted_tiers: List[str] = []
        rejection_reasons: List[str] = []
        budget_rejection_detected = False
        zero_cost_violation_detected = False
        unsupported_capability_detected = False
        rate_limit_error_detected: Optional[LLMRateLimitError] = None
        fallback_triggered = False
        fallback_reason: Optional[str] = None
        last_health_state = ProviderHealthState.UNKNOWN

        async with self._get_queue_sem():
            for idx, (tier, candidate, base_reason) in enumerate(candidate_plan):
                if tier in attempted_tiers:
                    continue

                # Enforce paid cloud fallback policy gate when moving from local primary to cloud
                if idx > 0 and (tier == "cloud" or tier.startswith("cloud_fallback")):
                    fallback_triggered = True
                    fallback_reason = "; ".join(rejection_reasons) or "Local provider unavailable"
                    # Paid cloud fallback is strictly blocked when eff_allow_fallback is False.
                    # In zero_cost_only mode, LOW complexity is permitted to use a verified $0 free cloud model
                    # when local is unavailable, but NEVER a paid cloud model.
                    is_verified_free_cloud = self.zero_cost_only and self._is_verified_zero_cost_candidate(candidate)
                    if not eff_allow_fallback and not is_verified_free_cloud:
                        if self.zero_cost_only and candidate is not None:
                            self.cost_controller.record_rejected_paid_request(
                                organization_id=eff_org,
                                task_id=eff_task,
                                agent_id=eff_agent,
                                model=f"{candidate.provider_name}/{candidate.model}",
                                reason="Paid cloud fallback disabled by zero-cost policy",
                            )
                            zero_cost_violation_detected = True
                        deny_msg = (
                            f"Cloud fallback is disabled by policy (LLM_ALLOW_CLOUD_FALLBACK=false). "
                            f"Primary failure: {fallback_reason}"
                        )
                        rejection_reasons.append(deny_msg)
                        break

                eligible, eval_reason, health_state = await self._evaluate_candidate(
                    candidate,
                    candidate_tier=tier,
                    requirements=assessment.capability_requirements,
                    estimated_prompt_tokens=assessment.estimated_context_tokens,
                    organization_id=eff_org,
                    task_id=eff_task,
                    agent_id=eff_agent,
                )
                last_health_state = health_state

                if not eligible or candidate is None:
                    rejection_reasons.append(eval_reason)
                    if "cloud_budget_rejected:" in eval_reason:
                        budget_rejection_detected = True
                    if "ZERO_COST_POLICY_VIOLATION:" in eval_reason:
                        zero_cost_violation_detected = True
                    if "UNSUPPORTED_CAPABILITY:" in eval_reason:
                        unsupported_capability_detected = True
                    continue

                attempted_tiers.append(tier)
                call_start = time.perf_counter()
                try:
                    response = await candidate.generate(
                        messages=messages,
                        tools=tools,
                        temperature=temperature,
                    )
                    call_latency_ms = round((time.perf_counter() - call_start) * 1000.0, 2)
                    total_duration_ms = round((time.perf_counter() - start_perf) * 1000.0, 2)

                    snap = self.health_monitor.record_inference_success(
                        candidate.provider_name,
                        candidate.model,
                        latency_ms=call_latency_ms,
                    )

                    is_cloud = self._is_cloud_provider(candidate)
                    cost_summary = self.cost_controller.record_usage(
                        usage=response.usage,
                        is_cloud=is_cloud,
                        organization_id=eff_org,
                        task_id=eff_task,
                        agent_id=eff_agent,
                        enforce_zero_cost=self.zero_cost_only,
                    )

                    self.provider_name = candidate.provider_name
                    self.model = response.model_name or candidate.model
                    self.is_live_provider = bool(response.is_live_provider)

                    org_summary = self.cost_controller.get_organization_summary(eff_org)
                    rl_status = org_summary.get("organization", {}).get("rate_limit_status", "OK")

                    decision = RoutingDecisionRecord(
                        organization_id=eff_org,
                        task_id=eff_task,
                        agent_id=eff_agent,
                        selected_provider=candidate.provider_name,
                        selected_model=response.model_name or candidate.model,
                        task_complexity=assessment.complexity.value,
                        complexity_score=assessment.score,
                        routing_reason=base_reason,
                        fallback_triggered=fallback_triggered,
                        fallback_reason=redact_secrets(fallback_reason) if fallback_reason else None,
                        prompt_tokens=response.usage.prompt_tokens,
                        completion_tokens=response.usage.completion_tokens,
                        total_tokens=response.usage.total_tokens,
                        cost_usd=cost_summary["cost_usd"],
                        actual_inference_cost_usd=cost_summary["actual_inference_cost_usd"],
                        estimated_inference_cost_usd=cost_summary["estimated_inference_cost_usd"],
                        is_estimated_cost=cost_summary["is_estimated_cost"],
                        is_free_model=cost_summary["is_free_model"],
                        zero_cost_policy_enforced=self.zero_cost_only,
                        rate_limit_status=rl_status,
                        execution_duration_ms=total_duration_ms,
                        provider_status=snap.state.value,
                        success=True,
                    )
                    self._decision_history.append(decision)
                    _GLOBAL_DECISION_HISTORY.append(decision)

                    response.routing_metadata = decision.model_dump()
                    self._emit_routing_event(
                        db,
                        "llm.failover_succeeded" if fallback_triggered else "llm.routing_decision",
                        decision,
                    )
                    return response

                except LLMBudgetExceededError as budget_exc:
                    # Nonzero cost alert or budget violation must abort immediately without fallback
                    budget_rejection_detected = True
                    rejection_reasons.append(redact_secrets(str(budget_exc)))
                    break
                except Exception as exec_err:
                    safe_exec_err = redact_secrets(str(exec_err))
                    if isinstance(exec_err, LLMRateLimitError):
                        rate_limit_error_detected = exec_err
                        self.cost_controller.record_rate_limit_failure(
                            organization_id=eff_org,
                            task_id=eff_task,
                            agent_id=eff_agent,
                            model=candidate.model,
                            retry_after_seconds=getattr(exec_err, "retry_after_seconds", None),
                        )
                    snap = self.health_monitor.record_inference_failure(
                        candidate.provider_name,
                        candidate.model,
                        exec_err,
                    )
                    last_health_state = snap.state
                    rejection_reasons.append(
                        f"{candidate.provider_name}/{candidate.model} inference failed: {safe_exec_err}"
                    )
                    continue

        # All candidates failed or were rejected
        total_duration_ms = round((time.perf_counter() - start_perf) * 1000.0, 2)
        combined_error = redact_secrets(
            "; ".join(rejection_reasons) or "No eligible LLM provider available."
        )
        org_summary = self.cost_controller.get_organization_summary(eff_org)
        rl_status = org_summary.get("organization", {}).get("rate_limit_status", "OK")

        failed_decision = RoutingDecisionRecord(
            organization_id=eff_org,
            task_id=eff_task,
            agent_id=eff_agent,
            selected_provider=None,
            selected_model=None,
            task_complexity=assessment.complexity.value,
            complexity_score=assessment.score,
            routing_reason=f"Failed routing for {assessment.complexity.value} task",
            fallback_triggered=fallback_triggered,
            fallback_reason=redact_secrets(fallback_reason) if fallback_reason else None,
            zero_cost_policy_enforced=self.zero_cost_only,
            rate_limit_status=rl_status,
            execution_duration_ms=total_duration_ms,
            provider_status=last_health_state.value,
            success=False,
            error_detail=combined_error,
        )
        self._decision_history.append(failed_decision)
        _GLOBAL_DECISION_HISTORY.append(failed_decision)
        self._emit_routing_event(db, "llm.routing_failed", failed_decision)

        if budget_rejection_detected:
            raise LLMBudgetExceededError(f"Hybrid router rejected execution: {combined_error}")
        if zero_cost_violation_detected:
            raise LLMZeroCostPolicyError(f"Hybrid router zero-cost policy violation: {combined_error}")
        if unsupported_capability_detected:
            raise LLMUnsupportedCapabilityError(f"Hybrid router unsupported capability: {combined_error}")
        if rate_limit_error_detected is not None:
            raise LLMRateLimitError(
                f"Hybrid router rate limit exceeded: {combined_error}",
                retry_after_seconds=getattr(rate_limit_error_detected, "retry_after_seconds", None),
            )
        raise LLMResponseError(f"Hybrid router failed to execute LLM request: {combined_error}")

    def get_recent_decisions(
        self,
        *,
        organization_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        records = list(self._decision_history)
        if organization_id is not None:
            org_filter = organization_id.strip()
            records = [r for r in records if r.organization_id == org_filter]
        return [r.model_dump() for r in records[-max(1, int(limit)) :]]

    def get_observability_diagnostics(
        self,
        *,
        organization_id: str = "default-org",
    ) -> Dict[str, Any]:
        """
        Returns secret-redacted, tenant-isolated administrative diagnostics for the Hybrid Router.
        """
        return {
            "routing_mode": settings.LLM_ROUTING_MODE,
            "allow_cloud_fallback": self.allow_cloud_fallback,
            "zero_cost_only": self.zero_cost_only,
            "local_provider": {
                "provider": getattr(self.local_provider, "provider_name", None),
                "model": getattr(self.local_provider, "model", None),
                "configured": self.local_provider is not None,
            },
            "cloud_provider": {
                "provider": getattr(self.cloud_provider, "provider_name", None),
                "model": getattr(self.cloud_provider, "model", None),
                "configured": self.cloud_provider is not None,
            },
            "health_snapshots": self.health_monitor.list_snapshots(),
            "budget_and_cost": self.cost_controller.get_organization_summary(organization_id),
            "recent_routing_decisions": self.get_recent_decisions(
                organization_id=organization_id,
                limit=25,
            ),
        }


def get_global_routing_decisions(
    organization_id: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    records = list(_GLOBAL_DECISION_HISTORY)
    if organization_id is not None:
        org_filter = organization_id.strip()
        records = [r for r in records if r.organization_id == org_filter]
    return [r.model_dump() for r in records[-max(1, int(limit)) :]]


def reset_global_routing_decisions() -> None:
    _GLOBAL_DECISION_HISTORY.clear()
