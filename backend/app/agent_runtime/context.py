from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, ConfigDict
from backend.app.core.config import settings
from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.llm.base import LLMBudgetExceededError


class TaskContext(BaseModel):
    task_id: str
    agent_id: str
    iteration: int = 0
    max_iterations: int = Field(default_factory=lambda: settings.MAX_EXECUTION_ITERATIONS)
    tool_call_count: int = 0
    max_tool_calls: int = Field(default_factory=lambda: settings.MAX_TOOL_CALLS)
    total_prompt_tokens: int = 0
    total_completion_tokens: int = 0
    total_tokens: int = 0
    max_tokens: int = Field(default_factory=lambda: settings.MAX_TASK_TOKENS)
    estimated_cost_usd: float = 0.0
    max_cost_usd: float = Field(default_factory=lambda: settings.MAX_TASK_COST_USD)
    max_execution_seconds: float = Field(default_factory=lambda: settings.MAX_TASK_EXECUTION_SECONDS)
    files_read: List[str] = Field(default_factory=list)
    artifacts_created: List[Dict[str, Any]] = Field(default_factory=list)
    tool_results: List[Dict[str, Any]] = Field(default_factory=list)
    verification_passed: bool = False

    model_config = ConfigDict(arbitrary_types_allowed=True)

    def increment_iteration(self) -> None:
        self.iteration += 1
        if self.iteration > self.max_iterations:
            raise RuntimeError(f"Task exceeded maximum iterations ({self.max_iterations}). Halting.")

    def record_tool_call(self) -> None:
        self.tool_call_count += 1
        if self.tool_call_count > self.max_tool_calls:
            raise RuntimeError(f"Task exceeded maximum tool calls ({self.max_tool_calls}). Halting.")

    def record_llm_usage(
        self,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        total_tokens: int = 0,
        cost_usd: float = 0.0,
    ) -> None:
        p = max(0, int(prompt_tokens or 0))
        c = max(0, int(completion_tokens or 0))
        t = max(0, int(total_tokens or (p + c)))
        self.total_prompt_tokens += p
        self.total_completion_tokens += c
        self.total_tokens += t
        self.estimated_cost_usd = round(self.estimated_cost_usd + max(0.0, float(cost_usd or 0.0)), 8)

        if self.max_tokens > 0 and self.total_tokens > self.max_tokens:
            raise LLMBudgetExceededError(
                f"Task '{self.task_id}' exceeded maximum token budget ({self.total_tokens} > {self.max_tokens})."
            )
        if self.max_cost_usd > 0 and self.estimated_cost_usd > self.max_cost_usd:
            raise LLMBudgetExceededError(
                f"Task '{self.task_id}' exceeded maximum cost budget (${self.estimated_cost_usd:.6f} > ${self.max_cost_usd:.6f})."
            )

    def check_execution_duration(self, elapsed_seconds: float) -> None:
        if self.max_execution_seconds > 0 and elapsed_seconds > self.max_execution_seconds:
            raise LLMBudgetExceededError(
                f"Task '{self.task_id}' exceeded maximum execution duration ({elapsed_seconds:.2f}s > {self.max_execution_seconds:.2f}s)."
            )
