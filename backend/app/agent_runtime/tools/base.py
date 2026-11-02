import re
from enum import IntEnum, Enum
from typing import Protocol, Dict, Any, Optional, List, runtime_checkable
from pydantic import BaseModel, Field

class ToolPermissionLevel(IntEnum):
    LEVEL_0_READ_ONLY = 0       # Reading, listing, searching, data inspection, verification
    LEVEL_1_WORKSPACE_WRITE = 1  # Creating or editing sandbox files, writing artifacts
    LEVEL_2_COMMAND_EXEC = 2     # System commands, high-risk external side-effects (requires approval)

class ToolCategory(str, Enum):
    WORKSPACE = "workspace"
    ARTIFACT = "artifact"
    DATA = "data"
    WEB = "web"
    API = "api"
    MEMORY = "memory"

class SideEffectLevel(str, Enum):
    READ_ONLY = "read_only"
    REVERSIBLE_MUTATION = "reversible_mutation"
    HIGH_RISK = "high_risk"

class ToolExecutionSemantics(str, Enum):
    AT_MOST_ONCE = "at_most_once"
    AT_LEAST_ONCE = "at_least_once"
    EFFECTIVELY_ONCE = "effectively_once"
    UNKNOWN = "unknown"

class ToolExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    CANCELLED = "cancelled"
    AWAITING_APPROVAL = "awaiting_approval"
    DENIED = "denied"

class ToolResult(BaseModel):
    success: bool
    data: Optional[Dict[str, Any]] = None
    output: str = ""
    error: Optional[str] = None
    duration_ms: int = 0
    artifact_ids: List[str] = Field(default_factory=list)
    requires_approval: bool = False
    approval_id: Optional[str] = None
    approval_reason: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ToolMetadata(BaseModel):
    name: str
    display_name: str
    description: str
    version: str = "1.0.0"
    category: ToolCategory = ToolCategory.WORKSPACE
    permission_level: ToolPermissionLevel = ToolPermissionLevel.LEVEL_0_READ_ONLY
    side_effect_level: SideEffectLevel = SideEffectLevel.READ_ONLY
    execution_semantics: ToolExecutionSemantics = ToolExecutionSemantics.UNKNOWN
    requires_approval: bool = False
    is_enabled: bool = True
    is_healthy: bool = True
    rate_limit: int = 60
    timeout_seconds: int = 30
    max_output_size: int = 100000
    allowed_agent_types: List[str] = Field(default_factory=lambda: ["general"])
    input_schema: Dict[str, Any] = Field(default_factory=dict)
    output_schema: Dict[str, Any] = Field(default_factory=dict)

@runtime_checkable
class Tool(Protocol):
    name: str
    description: str
    input_schema: Dict[str, Any]
    permission_level: ToolPermissionLevel
    timeout_seconds: int

    # Optional metadata attributes (with defaults handled in registry)
    display_name: str
    category: ToolCategory
    side_effect_level: SideEffectLevel
    requires_approval: bool
    is_enabled: bool
    max_output_size: int

    async def execute(
        self,
        arguments: Dict[str, Any],
        context: Any,
    ) -> ToolResult:
        """Executes the tool with arguments and runtime context."""
        ...

# Secret sanitization patterns
SECRET_PATTERNS = [
    re.compile(r"sk-[a-zA-Z0-9]{32,}", re.IGNORECASE),
    re.compile(r"AIza[0-9A-Za-z-_]{35}", re.IGNORECASE),
    re.compile(r"Bearer\s+[a-zA-Z0-9\._\-]{20,}", re.IGNORECASE),
    re.compile(r"(api[_-]?key|secret|token|password)[\"'\s:=]+[\"']?([a-zA-Z0-9\-_]{16,})[\"']?", re.IGNORECASE),
]

def sanitize_for_audit(val: Any) -> Any:
    """Recursively redacts API keys, credentials, and secrets from dict/list/string."""
    if isinstance(val, str):
        cleaned = val
        for pat in SECRET_PATTERNS:
            cleaned = pat.sub("[REDACTED_SECRET]", cleaned)
        return cleaned
    elif isinstance(val, dict):
        sanitized = {}
        for k, v in val.items():
            if any(term in k.lower() for term in ("key", "secret", "token", "password", "credential", "auth")):
                sanitized[k] = "[REDACTED_CREDENTIAL]"
            else:
                sanitized[k] = sanitize_for_audit(v)
        return sanitized
    elif isinstance(val, list):
        return [sanitize_for_audit(item) for item in val]
    return val
