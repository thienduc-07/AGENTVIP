import json
import re
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from backend.app.agent_runtime.llm.capabilities import CapabilityRequirement


class TaskComplexityLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class TaskComplexityAssessment(BaseModel):
    complexity: TaskComplexityLevel
    score: int
    estimated_context_tokens: int
    capability_requirements: CapabilityRequirement
    factors: List[str] = Field(default_factory=list)


class TaskComplexityAnalyzer:
    """
    Deterministic, explainable multi-factor task complexity analyzer.
    Classifies requests into LOW, MEDIUM, or HIGH complexity without making
    additional LLM calls, combining token volume, tool schema complexity,
    multi-turn depth, structural output requirements, and task/agent metadata.
    """

    HIGH_REASONING_PATTERNS = re.compile(
        r"\b(multi-agent|dag\b|orchestrat\w+|cross-department\w*|architecture\s+decision\w*|"
        r"system\s+design|security\s+audit|distributed\s+system\w*|refactor\w+|"
        r"complex\s+reason\w*|strategic\s+plan\w*|high-impact|financial\s+model\w*|"
        r"root-cause\s+analysis|comprehensive\s+market\s+analysis)\b",
        re.IGNORECASE,
    )

    MEDIUM_WORK_PATTERNS = re.compile(
        r"\b(research\s+synthesis|standard\s+analysis|market\s+analysis|content\s+generation|"
        r"execution\s+plan|launch\s+plan|summarize\s+report|compile\s+report|"
        r"write\s+report|analyze\s+workspace|inspect\s+and\s+verify)\b",
        re.IGNORECASE,
    )

    LOW_ROUTINE_PATTERNS = re.compile(
        r"\b(simple\s+classification|short\s+summary|basic\s+extraction|"
        r"routine\s+communication|format\s+text|status\s+check|ping|greeting|classify)\b",
        re.IGNORECASE,
    )

    STRUCTURED_JSON_PATTERNS = re.compile(
        r"\b(valid\s+json|json\s+format|json\s+schema|json\s+plan|structured\s+json)\b",
        re.IGNORECASE,
    )

    def analyze(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        *,
        task_priority: Optional[str] = None,
        agent_id: Optional[str] = None,
        plan_steps_count: int = 0,
        explicit_complexity: Optional[TaskComplexityLevel] = None,
    ) -> TaskComplexityAssessment:
        factors: List[str] = []
        score = 0

        # 1. Estimate token volume across messages and tool schemas
        full_text_parts: List[str] = []
        user_text_parts: List[str] = []
        tool_turns = 0
        for msg in messages or []:
            role = str(msg.get("role", ""))
            content = str(msg.get("content") or "")
            full_text_parts.append(content)
            if role == "user":
                user_text_parts.append(content)
            elif role == "tool":
                tool_turns += 1
            if "tool_calls" in msg and msg["tool_calls"]:
                full_text_parts.append(json.dumps(msg["tool_calls"]))

        combined_text = "\n".join(full_text_parts)
        user_text = "\n".join(user_text_parts)
        tools_list = tools or []
        tools_serialized = json.dumps(tools_list) if tools_list else ""

        # Approximate 4 characters per token + overhead per message
        estimated_tokens = max(
            16,
            (len(combined_text) + len(tools_serialized)) // 4 + (len(messages or []) * 8),
        )

        if estimated_tokens > 8000:
            score += 35
            factors.append(f"long_context_volume({estimated_tokens}_tokens:+35)")
        elif estimated_tokens > 2500:
            score += 25
            factors.append(f"large_context_volume({estimated_tokens}_tokens:+25)")
        elif estimated_tokens > 450:
            score += 12
            factors.append(f"moderate_context_volume({estimated_tokens}_tokens:+12)")
        else:
            score += 4
            factors.append(f"compact_context_volume({estimated_tokens}_tokens:+4)")

        # 2. Tool-calling & multi-turn execution factor
        num_tools = len(tools_list)
        requires_tools = num_tools > 0
        if num_tools >= 5:
            score += 22
            factors.append(f"broad_toolset({num_tools}_tools:+22)")
        elif num_tools >= 2:
            score += 15
            factors.append(f"moderate_toolset({num_tools}_tools:+15)")
        elif num_tools == 1:
            score += 10
            factors.append("single_tool_schema(+10)")

        if tool_turns >= 3:
            score += 18
            factors.append(f"deep_multi_turn_tool_history({tool_turns}_turns:+18)")
        elif tool_turns >= 1:
            score += 10
            factors.append(f"active_tool_history({tool_turns}_turns:+10)")

        # 3. Structural & reasoning depth factor
        high_matches = self.HIGH_REASONING_PATTERNS.findall(user_text)
        med_matches = self.MEDIUM_WORK_PATTERNS.findall(user_text)
        low_matches = self.LOW_ROUTINE_PATTERNS.findall(user_text)

        if high_matches:
            unique_high = sorted({m.lower() for m in high_matches})
            pts = min(45, 28 + 8 * len(unique_high))
            score += pts
            factors.append(f"high_complexity_domain({','.join(unique_high[:3])}:+{pts})")
        elif med_matches:
            unique_med = sorted({m.lower() for m in med_matches})
            pts = min(28, 16 + 5 * len(unique_med))
            score += pts
            factors.append(f"medium_analysis_domain({','.join(unique_med[:3])}:+{pts})")

        if low_matches and not high_matches and num_tools == 0:
            score = max(0, score - 10)
            factors.append("routine_low_complexity_signal(-10)")

        # Multi-step plan density
        inferred_steps = plan_steps_count or len(re.findall(r"(?m)^\s*\d+\.\s+", user_text))
        if inferred_steps >= 5:
            score += 20
            factors.append(f"multi_step_plan({inferred_steps}_steps:+20)")
        elif inferred_steps >= 2:
            score += 12
            factors.append(f"structured_plan({inferred_steps}_steps:+12)")

        # 4. Task priority and agent role metadata factor
        prio = (task_priority or "").lower().strip()
        if prio == "critical":
            score += 20
            factors.append("priority_critical(+20)")
        elif prio == "high":
            score += 12
            factors.append("priority_high(+12)")
        elif prio == "low" and not high_matches:
            score = max(0, score - 8)
            factors.append("priority_low(-8)")

        ag_id = (agent_id or "").lower().strip()
        if any(tok in ag_id for tok in ("ceo", "orchestrator", "architect")) and (high_matches or inferred_steps >= 4):
            score += 10
            factors.append(f"executive_agent_scope({ag_id}:+10)")

        score = max(0, min(100, score))

        if explicit_complexity is not None:
            level = explicit_complexity
            factors.append(f"explicit_override({level.value})")
        elif score >= 65:
            level = TaskComplexityLevel.HIGH
        elif score >= 30:
            level = TaskComplexityLevel.MEDIUM
        else:
            level = TaskComplexityLevel.LOW

        requires_json = bool(self.STRUCTURED_JSON_PATTERNS.search(combined_text))
        requires_long_ctx = estimated_tokens > 8192

        requirements = CapabilityRequirement(
            require_text_generation=True,
            require_tool_calling=requires_tools,
            require_structured_output=requires_json or requires_tools,
            require_json_mode=requires_json,
            require_long_context=requires_long_ctx,
            min_context_tokens=max(1024, estimated_tokens + 512),
        )

        return TaskComplexityAssessment(
            complexity=level,
            score=score,
            estimated_context_tokens=estimated_tokens,
            capability_requirements=requirements,
            factors=factors,
        )


default_complexity_analyzer = TaskComplexityAnalyzer()

