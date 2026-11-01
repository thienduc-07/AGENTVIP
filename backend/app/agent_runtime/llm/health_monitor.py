import asyncio
import time
from enum import Enum
from typing import Dict, Optional, Tuple
from pydantic import BaseModel

from backend.app.core.config import settings
from backend.app.agent_runtime.llm.base import (
    LLMAuthError,
    LLMProvider,
    redact_secrets,
)


class ProviderHealthState(str, Enum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    UNAVAILABLE = "UNAVAILABLE"
    AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR"
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    UNKNOWN = "UNKNOWN"


class ProviderHealthSnapshot(BaseModel):
    provider: str
    model: str
    state: ProviderHealthState = ProviderHealthState.UNKNOWN
    consecutive_failures: int = 0
    total_failures: int = 0
    total_successes: int = 0
    last_checked_at: Optional[float] = None
    last_latency_ms: Optional[float] = None
    last_error: Optional[str] = None


class ProviderHealthMonitor:
    """
    Stateful provider health monitor with TTL-cached lightweight health probes,
    failure counters, degraded/unavailable thresholds, and automatic recovery detection.
    Never issues paid chat completion inference calls for health checks and never exposes API keys.
    """

    def __init__(
        self,
        check_interval_seconds: Optional[float] = None,
        timeout_seconds: Optional[float] = None,
        failure_threshold: Optional[int] = None,
    ) -> None:
        self.check_interval_seconds = (
            float(settings.LLM_HEALTH_CHECK_INTERVAL_SECONDS)
            if check_interval_seconds is None
            else float(check_interval_seconds)
        )
        self.timeout_seconds = (
            float(settings.LLM_HEALTH_CHECK_TIMEOUT_SECONDS)
            if timeout_seconds is None
            else float(timeout_seconds)
        )
        self.failure_threshold = max(
            1,
            int(settings.LLM_HEALTH_FAILURE_THRESHOLD)
            if failure_threshold is None
            else int(failure_threshold),
        )
        self._snapshots: Dict[Tuple[str, str], ProviderHealthSnapshot] = {}

    @staticmethod
    def _key(provider_name: str, model: str) -> Tuple[str, str]:
        return ((provider_name or "").lower().strip(), (model or "").lower().strip())

    def get_snapshot(self, provider_name: str, model: str) -> ProviderHealthSnapshot:
        key = self._key(provider_name, model)
        if key not in self._snapshots:
            self._snapshots[key] = ProviderHealthSnapshot(
                provider=key[0],
                model=model,
                state=ProviderHealthState.UNKNOWN,
            )
        return self._snapshots[key]

    @staticmethod
    def _classify_error_state(
        err_msg: str,
        consecutive_failures: int,
        failure_threshold: int,
        from_health_endpoint: bool = False,
    ) -> ProviderHealthState:
        lower = (err_msg or "").lower()
        if any(
            tok in lower
            for tok in ("401", "403", "unauthorized", "authentication rejected", "invalid api key")
        ):
            return ProviderHealthState.AUTHENTICATION_ERROR
        if any(
            tok in lower
            for tok in (
                "model_unavailable",
                "model_not_found",
                "not available",
                "does not exist",
                "unknown model",
            )
        ):
            return ProviderHealthState.MODEL_UNAVAILABLE
        if from_health_endpoint or any(
            tok in lower
            for tok in (
                "failed to connect",
                "all connection attempts failed",
                "connection refused",
                "connecterror",
                "name or service not known",
            )
        ):
            if consecutive_failures >= failure_threshold or from_health_endpoint:
                return ProviderHealthState.UNAVAILABLE
        if consecutive_failures >= failure_threshold:
            return ProviderHealthState.UNAVAILABLE
        return ProviderHealthState.DEGRADED

    async def check_provider_health(
        self,
        provider: LLMProvider,
        *,
        force: bool = False,
    ) -> ProviderHealthSnapshot:
        snap = self.get_snapshot(provider.provider_name, provider.model)
        now = time.monotonic()

        if (
            not force
            and snap.last_checked_at is not None
            and snap.state != ProviderHealthState.UNKNOWN
            and (now - snap.last_checked_at) < self.check_interval_seconds
        ):
            return snap

        start_t = time.perf_counter()
        try:
            health_res = await asyncio.wait_for(
                provider.check_health(),
                timeout=max(0.5, self.timeout_seconds),
            )
            snap.last_checked_at = now
            snap.last_latency_ms = health_res.latency_ms or round(
                (time.perf_counter() - start_t) * 1000.0, 2
            )

            if health_res.healthy:
                snap.state = ProviderHealthState.HEALTHY
                snap.consecutive_failures = 0
                snap.total_successes += 1
                snap.last_error = None
            else:
                snap.consecutive_failures += 1
                snap.total_failures += 1
                safe_err = redact_secrets(health_res.error or "Health check returned unhealthy.")
                snap.last_error = safe_err
                snap.state = self._classify_error_state(
                    safe_err,
                    snap.consecutive_failures,
                    self.failure_threshold,
                    from_health_endpoint=True,
                )
        except Exception as e:
            snap.last_checked_at = now
            snap.last_latency_ms = round((time.perf_counter() - start_t) * 1000.0, 2)
            snap.consecutive_failures += 1
            snap.total_failures += 1
            safe_err = redact_secrets(str(e))
            snap.last_error = safe_err
            snap.state = self._classify_error_state(
                safe_err,
                snap.consecutive_failures,
                self.failure_threshold,
                from_health_endpoint=True,
            )

        return snap

    def record_inference_success(
        self,
        provider_name: str,
        model: str,
        latency_ms: Optional[float] = None,
    ) -> ProviderHealthSnapshot:
        snap = self.get_snapshot(provider_name, model)
        snap.state = ProviderHealthState.HEALTHY
        snap.consecutive_failures = 0
        snap.total_successes += 1
        snap.last_checked_at = time.monotonic()
        if latency_ms is not None:
            snap.last_latency_ms = round(float(latency_ms), 2)
        snap.last_error = None
        return snap

    def record_inference_failure(
        self,
        provider_name: str,
        model: str,
        error: Exception,
    ) -> ProviderHealthSnapshot:
        snap = self.get_snapshot(provider_name, model)
        snap.consecutive_failures += 1
        snap.total_failures += 1
        snap.last_checked_at = time.monotonic()
        safe_err = redact_secrets(str(error))
        snap.last_error = safe_err

        if isinstance(error, LLMAuthError):
            snap.state = ProviderHealthState.AUTHENTICATION_ERROR
        else:
            snap.state = self._classify_error_state(
                safe_err,
                snap.consecutive_failures,
                self.failure_threshold,
                from_health_endpoint=False,
            )
        return snap

    def set_state_override(
        self,
        provider_name: str,
        model: str,
        state: ProviderHealthState,
        error: Optional[str] = None,
    ) -> ProviderHealthSnapshot:
        snap = self.get_snapshot(provider_name, model)
        snap.state = state
        snap.last_checked_at = time.monotonic()
        snap.last_error = redact_secrets(error) if error else None
        return snap

    def list_snapshots(self) -> Dict[str, Dict[str, object]]:
        return {
            f"{p}:{m}": snap.model_dump()
            for (p, m), snap in self._snapshots.items()
        }

    def reset(self) -> None:
        self._snapshots.clear()


default_health_monitor = ProviderHealthMonitor()

