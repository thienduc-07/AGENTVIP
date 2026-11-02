import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple, Type
from backend.app.core.errors import (
    ValidationError,
    NotFoundError,
    ConflictError,
    ForbiddenError,
)
from backend.app.agent_runtime.llm.base import (
    LLMZeroCostPolicyError,
    LLMUnsupportedCapabilityError,
    LLMBudgetExceededError,
)
from backend.app.agent_runtime.lifecycle.task_lifecycle import DeliverableNotVerifiedError
from backend.app.models.task import TaskModel

logger = logging.getLogger("grandline.runtime.retry")

# Explicit classification of non-retryable error types
NON_RETRYABLE_EXCEPTIONS: Tuple[Type[Exception], ...] = (
    ValidationError,
    NotFoundError,
    ConflictError,
    ForbiddenError,
    LLMZeroCostPolicyError,
    LLMUnsupportedCapabilityError,
    DeliverableNotVerifiedError,
)


class RetryDecision:
    def __init__(
        self,
        should_retry: bool,
        reason: str,
        backoff_seconds: float = 0.0,
        next_retry_count: int = 0,
    ):
        self.should_retry = should_retry
        self.reason = reason
        self.backoff_seconds = backoff_seconds
        self.next_retry_count = next_retry_count


class RetryManager:
    """
    Governs task retry policies, distinguishing retryable transient faults from
    deterministic failure errors, enforcing exponential backoff and recording audit history.
    """

    @staticmethod
    def calculate_backoff(retry_count: int, base_seconds: float = 0.5, max_seconds: float = 30.0) -> float:
        """Computes exponential backoff delay with upper ceiling."""
        delay = base_seconds * (2 ** max(0, retry_count))
        return min(max_seconds, round(delay, 2))

    @classmethod
    def evaluate_retry(
        cls,
        task: TaskModel,
        error: Optional[Exception] = None,
        error_message: Optional[str] = None,
        base_backoff_seconds: float = 0.5,
    ) -> RetryDecision:
        """
        Evaluates whether a failed task is eligible for retry under corporate policy.
        """
        err_str = str(error or error_message or "Unknown execution error")

        # 1. Check if error is explicitly non-retryable
        if error is not None:
            if isinstance(error, NON_RETRYABLE_EXCEPTIONS):
                return RetryDecision(
                    should_retry=False,
                    reason=f"Non-retryable fault: {type(error).__name__} ({err_str[:150]})",
                    next_retry_count=task.retry_count,
                )

        # 2. Check string keywords indicating policy or budget rejections
        non_retryable_keywords = [
            "zero-cost policy violation",
            "unsupported capability",
            "cannot transition to completed without deliverable verification",
            "claim claimed output file does not physically exist",
            "cross-tenant",
            "unauthorized",
        ]
        if any(kw in err_str.lower() for kw in non_retryable_keywords):
            return RetryDecision(
                should_retry=False,
                reason=f"Non-retryable policy or validation error: {err_str[:150]}",
                next_retry_count=task.retry_count,
            )

        # 3. Check bounded retry limit
        current_retries = int(task.retry_count or 0)
        max_retries = int(task.max_retries or 2)
        if current_retries >= max_retries:
            return RetryDecision(
                should_retry=False,
                reason=f"Exhausted maximum retry budget ({current_retries}/{max_retries}).",
                next_retry_count=current_retries,
            )

        # 4. Eligible for retry with exponential backoff
        next_count = current_retries + 1
        backoff = cls.calculate_backoff(current_retries, base_seconds=base_backoff_seconds)
        return RetryDecision(
            should_retry=True,
            reason=f"Transient failure eligible for retry attempt {next_count}/{max_retries} (backoff={backoff}s).",
            backoff_seconds=backoff,
            next_retry_count=next_count,
        )

    @classmethod
    def record_retry_attempt(
        cls,
        task: TaskModel,
        decision: RetryDecision,
        error_detail: Optional[str] = None,
    ) -> None:
        """Appends retry telemetry to task output JSON."""
        task.retry_count = decision.next_retry_count
        out_dict = task.output_data_json or {}
        history = list(out_dict.get("retry_history", []))
        history.append({
            "attempt": decision.next_retry_count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "reason": decision.reason,
            "backoff_seconds": decision.backoff_seconds,
            "error_detail": (error_detail or "")[:300],
        })
        out_dict["retry_history"] = history
        task.output_data_json = out_dict


retry_manager = RetryManager()

