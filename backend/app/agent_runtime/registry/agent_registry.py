from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
from backend.app.agent_runtime.tools.base import ToolPermissionLevel
from backend.app.agent_runtime.policies.permissions import AgentPolicy

class AgentDefinition(BaseModel):
    agent_type: str = Field(..., description="Unique type identifier for specialized agent class")
    display_name: str = Field(..., description="Human-readable title")
    description: str = Field(..., description="Summary of responsibilities and capabilities")
    system_prompt: str = Field(..., description="Base system instructions guiding behavior")
    allowed_tools: List[str] = Field(default_factory=list, description="Whitelisted tool names")
    input_schema: Optional[Dict[str, Any]] = Field(default=None, description="Expected input structure")
    output_schema: Optional[Dict[str, Any]] = Field(default=None, description="Expected output structure")
    max_iterations: int = Field(default=10, description="Max reasoning loops")
    max_tool_calls: int = Field(default=15, description="Max tool executions allowed")
    timeout_seconds: int = Field(default=120, description="Hard timeout per subtask")
    permission_level: ToolPermissionLevel = Field(
        default=ToolPermissionLevel.LEVEL_0_READ_ONLY,
        description="Maximum security clearance"
    )
    enabled: bool = Field(default=True, description="Whether agent is currently active")
    concurrency_limit: int = Field(default=2, description="Max parallel subtasks of this type")
    default_assigned_agent_id: str = Field(..., description="Physical agent ID in database")

    def to_policy(self) -> AgentPolicy:
        return AgentPolicy(
            agent_id=self.default_assigned_agent_id,
            max_permission_level=self.permission_level,
            allowed_tools=self.allowed_tools,
            allow_sandbox_write=(self.permission_level >= ToolPermissionLevel.LEVEL_1_WORKSPACE_WRITE),
            max_iterations=self.max_iterations,
            max_tool_calls=self.max_tool_calls,
        )

class AgentRegistry:
    def __init__(self):
        self._registry: Dict[str, AgentDefinition] = {}
        self._agent_id_map: Dict[str, str] = {}

    def register(self, definition: AgentDefinition, allow_override: bool = False) -> None:
        if definition.default_assigned_agent_id:
            existing_type = self._agent_id_map.get(definition.default_assigned_agent_id)
            if existing_type and existing_type != definition.agent_type and not allow_override:
                raise ValueError(
                    f"Duplicate employee ID conflict: employee '{definition.default_assigned_agent_id}' "
                    f"is already mapped to agent_type '{existing_type}'. Silent overwrite rejected."
                )
            self._agent_id_map[definition.default_assigned_agent_id] = definition.agent_type
        self._registry[definition.agent_type] = definition

    def get(self, key: str) -> Optional[AgentDefinition]:
        """
        Backward-compatible getter. Resolves by agent_type first,
        falling back to default_assigned_agent_id (physical employee ID).
        """
        if key in self._registry:
            return self._registry[key]
        return self.get_by_employee_id(key)

    def get_by_type(self, agent_type: str) -> Optional[AgentDefinition]:
        """Strictly resolves by specialized agent_type."""
        return self._registry.get(agent_type)

    def get_by_employee_id(self, employee_id: str) -> Optional[AgentDefinition]:
        """Strictly resolves by physical employee ID (e.g. 'agent-research-ai')."""
        # 1. Check indexed map
        atype = self._agent_id_map.get(employee_id)
        if atype and atype in self._registry:
            return self._registry[atype]
        # 2. Iterate definitions for matching default_assigned_agent_id
        for d in self._registry.values():
            if d.default_assigned_agent_id == employee_id:
                return d
        # 3. Dynamically recruited specialists where agent_type is the agent.id
        if employee_id in self._registry:
            return self._registry[employee_id]
        return None

    def resolve_agent_def(self, identifier: str) -> Optional[AgentDefinition]:
        """
        Authoritative identity resolution API: checks physical employee ID first,
        then agent_type. Returns None if unresolvable (no silent generic fallback).
        """
        defn = self.get_by_employee_id(identifier)
        if defn:
            return defn
        return self.get_by_type(identifier)

    def list_all(self) -> List[AgentDefinition]:
        return list(self._registry.values())

    def list_active(self) -> List[AgentDefinition]:
        return [a for a in self._registry.values() if a.enabled]

    def resolve_agent_type_for_agent_id(self, agent_id: str) -> Optional[AgentDefinition]:
        """
        Resolves active AgentDefinition for physical employee ID.
        Returns None if not registered or disabled. Never silently defaults to generic agent.
        """
        defn = self.get_by_employee_id(agent_id)
        if defn and defn.enabled:
            return defn
        by_type = self._registry.get(agent_id)
        if by_type and by_type.enabled:
            return by_type
        return None

# Define Standard Specialized Agents
GENERAL_AGENT_DEF = AgentDefinition(
    agent_type="general",
    display_name="Executive Strategy & General Agent",
    description="Corporate executive coordinator capable of executing end-to-end tasks, inspecting workspace structures, and authorizing verified sandbox deliverables.",
    default_assigned_agent_id="agent-exec-ceo",
    system_prompt=(
        "You are the Executive General Agent (Victoria Vance) operating in AI Agency — Autonomous Business Headquarters.\n"
        "Your mission is to analyze workspace structures, read documentation, summarize findings, "
        "and generate verified reports within the workspace sandbox.\n"
        "Security Rules:\n"
        "- All file writes must be directed to workspace_sandbox/.\n"
        "- Never attempt path traversal or reading forbidden files (.env, keys).\n"
        "- Always verify outputs before reporting final completion."
    ),
    allowed_tools=[
        "workspace_list",
        "workspace.list_files",
        "file_read",
        "workspace.read_file",
        "file_search",
        "workspace.search",
        "calculator",
        "workspace_write",
        "workspace.write_file",
        "verification_tool",
        "workspace.verify_file",
        "artifact.create",
        "artifact.get",
        "artifact.list",
        "artifact.verify",
        "data.inspect",
        "data.profile",
        "data.summarize",
        "data.validate",
        "web.search",
        "web.fetch_page",
        "web.extract_text",
        "api.call",
        "memory_search",
        "memory.search",
        "memory_get",
        "memory.get",
        "memory_propose",
        "memory.propose",
        "memory_archive",
        "memory.archive",
    ],
    max_tool_calls=15,
    max_iterations=10,
    timeout_seconds=120,
    permission_level=ToolPermissionLevel.LEVEL_1_WORKSPACE_WRITE,
    enabled=True,
    concurrency_limit=2,
)

RESEARCH_AGENT_DEF = AgentDefinition(
    agent_type="research",
    display_name="AI Research & Intelligence Specialist",
    description="Gathers, reads, and analyzes workspace documents, source code, and configurations; tracks sources and distinguishes facts from unverified hypotheses.",
    default_assigned_agent_id="agent-research-ai",
    system_prompt=(
        "You are the Research Agent (Dr. Elena Rostova) in AI Agency — Autonomous Business Headquarters.\n"
        "Your mission is to read documents, inspect workspace directory structures, and extract verified facts.\n"
        "Strict Operational Boundaries:\n"
        "- Read-only access: you cannot write files or execute scripts.\n"
        "- Always cite file paths, line ranges, or specific items in your findings.\n"
        "- Explicitly distinguish verified facts from assumptions or unverified information.\n"
        "- Return structured, evidence-backed findings to upstream workflows.\n"
        "- Efficiency: Once you have read the relevant data file(s), synthesize your factual findings and return your final response immediately without performing repetitive searches."
    ),
    allowed_tools=[
        "workspace_list",
        "workspace.list_files",
        "file_read",
        "workspace.read_file",
        "file_search",
        "workspace.search",
        "web.search",
        "web.fetch_page",
        "web.extract_text",
        "artifact.get",
        "artifact.list",
        "memory_search",
        "memory.search",
        "memory_get",
        "memory.get",
    ],
    max_tool_calls=25,
    max_iterations=12,
    timeout_seconds=90,
    permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
    enabled=True,
    concurrency_limit=3,
)

ANALYST_AGENT_DEF = AgentDefinition(
    agent_type="analyst",
    display_name="Financial & Systems Data Analyst Agent",
    description="Examines data structures, computes numerical metrics via safe AST tools, and identifies trends, discrepancies, and operational patterns.",
    default_assigned_agent_id="agent-fin-controller",
    system_prompt=(
        "You are the Data & Financial Analyst Agent (Julian Thorne) in AI Agency — Autonomous Business Headquarters.\n"
        "Your mission is to analyze data, compute metrics, check structures, and extract verifiable insights.\n"
        "Strict Operational Boundaries:\n"
        "- Perform calculations using the safe 'calculator' tool.\n"
        "- Note data limitations, quality gaps, and confidence levels.\n"
        "- Do not fabricate missing metrics or unbacked conclusions."
    ),
    allowed_tools=[
        "workspace_list",
        "workspace.list_files",
        "file_read",
        "workspace.read_file",
        "file_search",
        "workspace.search",
        "calculator",
        "data.inspect",
        "data.profile",
        "data.summarize",
        "data.validate",
        "artifact.get",
        "artifact.list",
        "memory_search",
        "memory.search",
        "memory_get",
        "memory.get",
    ],
    max_tool_calls=25,
    max_iterations=12,
    timeout_seconds=90,
    permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
    enabled=True,
    concurrency_limit=2,
)

WRITER_AGENT_DEF = AgentDefinition(
    agent_type="writer",
    display_name="Brand Strategy & Report Synthesis Agent",
    description="Synthesizes upstream research and analysis into structured reports and documentation; generates verified sandbox artifacts.",
    default_assigned_agent_id="agent-mkt-growth",
    system_prompt=(
        "You are the Synthesis & Report Writer Agent (Sophia Martinez) in AI Agency — Autonomous Business Headquarters.\n"
        "Your mission is to synthesize results from upstream Research and Analysis subtasks into comprehensive, verified markdown reports.\n"
        "Strict Operational Boundaries:\n"
        "- All report files MUST be written strictly inside workspace_sandbox/.\n"
        "- Cite upstream evidence, files, and findings accurately.\n"
        "- Always verify generated files using verification_tool before declaring completion.\n"
        "- Efficiency: Once the report is written and verified, conclude with your final summary response."
    ),
    allowed_tools=[
        "file_read",
        "workspace.read_file",
        "workspace_write",
        "workspace.write_file",
        "verification_tool",
        "workspace.verify_file",
        "artifact.create",
        "artifact.get",
        "artifact.list",
        "artifact.verify",
        "memory_search",
        "memory.search",
        "memory_get",
        "memory.get",
        "memory_propose",
        "memory.propose",
    ],
    max_tool_calls=25,
    max_iterations=12,
    timeout_seconds=120,
    permission_level=ToolPermissionLevel.LEVEL_1_WORKSPACE_WRITE,
    enabled=True,
    concurrency_limit=2,
)

REVIEWER_AGENT_DEF = AgentDefinition(
    agent_type="reviewer",
    display_name="Engineering Quality & Security Reviewer Agent",
    description="Inspects generated reports and artifacts against initial goals, detects discrepancies or unsupported assertions, and provides structured review findings.",
    default_assigned_agent_id="agent-eng-lead",
    system_prompt=(
        "You are the Engineering Quality Reviewer Agent (David Chen) in AI Agency — Autonomous Business Headquarters.\n"
        "Your mission is to rigorously evaluate generated reports and artifacts against the original corporate goal and upstream evidence.\n"
        "Strict Operational Boundaries:\n"
        "- Check if all initial requirements have been completely addressed.\n"
        "- Identify contradictions, unbacked assertions, or missing requirements.\n"
        "- Return a structured review including verdict (APPROVED / REVISIONS_NEEDED), rubric score (0-100), issue list, and actionable recommendations."
    ),
    allowed_tools=[
        "file_read",
        "workspace.read_file",
        "verification_tool",
        "workspace.verify_file",
        "artifact.get",
        "artifact.list",
        "artifact.verify",
        "data.validate",
        "memory_search",
        "memory.search",
        "memory_get",
        "memory.get",
        "memory_archive",
        "memory.archive",
    ],
    max_tool_calls=25,
    max_iterations=12,
    timeout_seconds=90,
    permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
    enabled=True,
    concurrency_limit=2,
)

SALES_AGENT_DEF = AgentDefinition(
    agent_type="sales",
    display_name="Enterprise Solutions & Sales Director Agent",
    description="Director of Enterprise Sales managing client qualification, proposal generation, and enterprise contracts.",
    default_assigned_agent_id="agent-sales-director",
    system_prompt=(
        "You are the Director of Enterprise Sales (Marcus Reynolds) in AI Agency — Autonomous Business Headquarters.\n"
        "Your mission is to qualify prospects, draft enterprise proposals, and analyze market requirements.\n"
        "Strict Operational Boundaries:\n"
        "- Read-only inspection of client dossiers and market research.\n"
        "- Draft proposals and client correspondence in verified sandbox artifacts.\n"
        "- Never promise pricing or terms beyond authorized board guardrails."
    ),
    allowed_tools=[
        "workspace_list",
        "workspace.list_files",
        "file_read",
        "workspace.read_file",
        "file_search",
        "workspace.search",
        "artifact.get",
        "artifact.list",
        "web.search",
        "web.fetch_page",
        "memory_search",
        "memory.search",
        "memory_get",
        "memory.get",
        "memory_propose",
        "memory.propose",
    ],
    max_tool_calls=10,
    max_iterations=8,
    timeout_seconds=90,
    permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
    enabled=True,
    concurrency_limit=2,
)

OPERATIONS_AGENT_DEF = AgentDefinition(
    agent_type="operations",
    display_name="People & Autonomous Operations Agent",
    description="Head of Operations managing agent recruitment, onboarding, process documentation, and departmental allocation.",
    default_assigned_agent_id="agent-ops-recruiter",
    system_prompt=(
        "You are the Head of Operations (Amara Okafor) in AI Agency — Autonomous Business Headquarters.\n"
        "Your mission is to manage workforce allocation, monitor operational health, and document standard operating procedures.\n"
        "Strict Operational Boundaries:\n"
        "- All process artifacts must be written to workspace_sandbox/.\n"
        "- Respect organizational boundaries and multi-tenant isolation.\n"
        "- Verify workforce telemetry before recommending structural changes."
    ),
    allowed_tools=[
        "workspace_list",
        "workspace.list_files",
        "file_read",
        "workspace.read_file",
        "file_search",
        "workspace.search",
        "calculator",
        "workspace_write",
        "workspace.write_file",
        "verification_tool",
        "workspace.verify_file",
        "artifact.create",
        "artifact.get",
        "artifact.list",
        "artifact.verify",
        "memory_search",
        "memory.search",
        "memory_get",
        "memory.get",
        "memory_propose",
        "memory.propose",
    ],
    max_tool_calls=12,
    max_iterations=8,
    timeout_seconds=120,
    permission_level=ToolPermissionLevel.LEVEL_1_WORKSPACE_WRITE,
    enabled=True,
    concurrency_limit=2,
)

SUPPORT_AGENT_DEF = AgentDefinition(
    agent_type="support",
    display_name="Customer Success & Support Operations Agent",
    description="Head of Customer Success managing client health, automated ticket triage, SLA compliance, and support documentation.",
    default_assigned_agent_id="agent-support-lead",
    system_prompt=(
        "You are the Head of Customer Success (Liam O'Connor) in AI Agency — Autonomous Business Headquarters.\n"
        "Your mission is to ensure client satisfaction, analyze support telemetry, and diagnose reported issues.\n"
        "Strict Operational Boundaries:\n"
        "- Analyze incoming tickets and triage according to SLA urgency.\n"
        "- Cite relevant knowledge base records when forming recommendations.\n"
        "- Do not execute destructive actions or modify production without escalation."
    ),
    allowed_tools=[
        "workspace_list",
        "workspace.list_files",
        "file_read",
        "workspace.read_file",
        "file_search",
        "workspace.search",
        "artifact.get",
        "artifact.list",
        "memory_search",
        "memory.search",
        "memory_get",
        "memory.get",
        "memory_propose",
        "memory.propose",
    ],
    max_tool_calls=10,
    max_iterations=8,
    timeout_seconds=90,
    permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
    enabled=True,
    concurrency_limit=2,
)

def create_default_agent_registry() -> AgentRegistry:
    reg = AgentRegistry()
    reg.register(GENERAL_AGENT_DEF)
    reg.register(RESEARCH_AGENT_DEF)
    reg.register(ANALYST_AGENT_DEF)
    reg.register(WRITER_AGENT_DEF)
    reg.register(REVIEWER_AGENT_DEF)
    reg.register(SALES_AGENT_DEF)
    reg.register(OPERATIONS_AGENT_DEF)
    reg.register(SUPPORT_AGENT_DEF)
    return reg

default_agent_registry = create_default_agent_registry()
