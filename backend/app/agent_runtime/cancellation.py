import asyncio
import logging

logger = logging.getLogger("grandline.runtime.cancellation")


class TaskCancelledException(Exception):
    """Raised when an active task execution is cancelled by user request."""
    pass


class TaskPausedException(Exception):
    """Raised when an active task execution is paused by operator request."""
    pass


class CancellationToken:
    def __init__(self):
        self._is_cancelled = False
        self._is_paused = False
        self._reason = ""

    def cancel(self, reason: str = "User requested cancellation") -> None:
        self._is_cancelled = True
        self._reason = reason
        logger.info(f"Cancellation requested: {reason}")

    def pause(self, reason: str = "Operator paused task execution") -> None:
        self._is_paused = True
        self._reason = reason
        logger.info(f"Pause requested: {reason}")

    @property
    def is_cancelled(self) -> bool:
        return self._is_cancelled

    @property
    def is_paused(self) -> bool:
        return self._is_paused

    @property
    def reason(self) -> str:
        return self._reason

    def check(self) -> None:
        if self._is_paused:
            raise TaskPausedException(f"Task paused: {self._reason}")
        if self._is_cancelled:
            raise TaskCancelledException(f"Task cancelled: {self._reason}")

