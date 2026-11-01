from typing import List
from pydantic import BaseModel, Field
from backend.app.agent_runtime.tools.base import ToolPermissionLevel
from backend.app.agent_runtime.policies.permissions import AgentPolicy

class AgentDefinition(BaseModel):
    agent_id: str
    name: str
    role: str
    system_prompt: str
    allowed_tools: List[str]
    max_tool_calls: int = 15
    max_iterations: int = 10
    timeout_seconds: int = 120
    permission_level: ToolPermissionLevel = ToolPermissionLevel.LEVEL_1_WORKSPACE_WRITE

    def to_policy(self) -> AgentPolicy:
        return AgentPolicy(
            agent_id=self.agent_id,
            max_permission_level=self.permission_level,
            allowed_tools=self.allowed_tools,
            allow_sandbox_write=True,
            max_iterations=self.max_iterations,
            max_tool_calls=self.max_tool_calls,
        )

GENERAL_AGENT = AgentDefinition(
    agent_id="agent-general",
    name="Corporate Operations General Agent",
    role="Multi-Tool Operations Specialist",
    system_prompt=(
        "You are the Corporate Operations General Agent operating in AI Agency — Autonomous Business Headquarters.\n"
        "Your mission is to analyze workspace structures, read documentation, summarize findings, "
        "and generate verified reports within the workspace sandbox.\n"
        "Security Rules:\n"
        "- All file writes must be directed to workspace_sandbox.\n"
        "- Never attempt path traversal or reading forbidden files (.env, keys).\n"
        "- Always verify outputs before reporting final completion."
    ),
    allowed_tools=[
        "workspace_list",
        "file_read",
        "file_search",
        "workspace_write",
        "verification_tool",
    ],
    max_tool_calls=15,
    max_iterations=10,
    timeout_seconds=120,
    permission_level=ToolPermissionLevel.LEVEL_1_WORKSPACE_WRITE,
)
