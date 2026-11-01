import pytest
import asyncio
from datetime import datetime
from backend.app.agent_runtime.registry.agent_registry import (
    default_agent_registry,
    AgentRegistry,
    AgentDefinition,
    GENERAL_AGENT_DEF,
    RESEARCH_AGENT_DEF,
    ANALYST_AGENT_DEF,
    WRITER_AGENT_DEF,
    REVIEWER_AGENT_DEF,
    SALES_AGENT_DEF,
    OPERATIONS_AGENT_DEF,
    SUPPORT_AGENT_DEF,
)
from backend.app.agent_runtime.skills.skill_loader import (
    skill_loader,
    CORPORATE_AGENT_SKILL_ASSIGNMENTS,
    DEPARTMENT_SKILL_ASSIGNMENTS,
    AGENT_TYPE_SKILL_ASSIGNMENTS,
)
from backend.app.agent_runtime.tools.base import ToolPermissionLevel
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.agent_runtime.dispatcher.dispatcher import task_dispatcher
from backend.app.scripts.seed import CORPORATE_AGENTS


# ==============================================================================
# PHASE B: AGENT IDENTITY RESOLUTION TESTS
# ==============================================================================

def test_registry_resolves_all_eight_corporate_employees_by_id():
    """Verify that each of the eight corporate employee IDs resolves to their authoritative AgentDefinition."""
    expected_mappings = {
        "agent-exec-ceo": "general",
        "agent-eng-lead": "reviewer",
        "agent-research-ai": "research",
        "agent-mkt-growth": "writer",
        "agent-sales-director": "sales",
        "agent-fin-controller": "analyst",
        "agent-ops-recruiter": "operations",
        "agent-support-lead": "support",
    }

    for emp_id, expected_type in expected_mappings.items():
        # Test lookup strictly by employee ID
        defn_by_emp = default_agent_registry.get_by_employee_id(emp_id)
        assert defn_by_emp is not None, f"Failed to resolve employee ID: {emp_id}"
        assert defn_by_emp.agent_type == expected_type
        assert defn_by_emp.default_assigned_agent_id == emp_id
        assert defn_by_emp.enabled is True

        # Test backward-compatible .get() with employee ID
        defn_get = default_agent_registry.get(emp_id)
        assert defn_get is not None
        assert defn_get.agent_type == expected_type

        # Test resolve_agent_def()
        defn_resolved = default_agent_registry.resolve_agent_def(emp_id)
        assert defn_resolved is not None
        assert defn_resolved.agent_type == expected_type


def test_registry_resolves_all_registered_agent_types():
    """Verify that each registered specialized agent_type resolves to its AgentDefinition."""
    agent_types = ["general", "research", "analyst", "writer", "reviewer", "sales", "operations", "support"]

    for atype in agent_types:
        defn = default_agent_registry.get_by_type(atype)
        assert defn is not None, f"Failed to resolve agent_type: {atype}"
        assert defn.agent_type == atype
        assert defn.enabled is True


def test_registry_duplicate_employee_id_cannot_silently_overwrite():
    """Verify that an attempt to register a new agent_type with an existing employee ID fails with ValueError."""
    reg = AgentRegistry()
    reg.register(GENERAL_AGENT_DEF)

    # Attempt to register a conflicting agent definition using Victoria Vance's employee ID
    rogue_def = AgentDefinition(
        agent_type="rogue_hijacker",
        display_name="Rogue Agent",
        description="Attempted hijack",
        default_assigned_agent_id="agent-exec-ceo",
        system_prompt="Hijack",
        allowed_tools=[],
    )

    with pytest.raises(ValueError, match="Duplicate employee ID conflict"):
        reg.register(rogue_def)

    # Verification: 'agent-exec-ceo' still points strictly to 'general'
    assert reg.get_by_employee_id("agent-exec-ceo").agent_type == "general"



def test_registry_unknown_employee_id_returns_none():
    """Verify that unknown employee IDs return None and do NOT silently return general agent."""
    unknown_ids = ["agent-unknown-123", "nonexistent-bot", "agent-captain-roger-obsolete"]

    for bad_id in unknown_ids:
        assert default_agent_registry.get_by_employee_id(bad_id) is None
        assert default_agent_registry.resolve_agent_type_for_agent_id(bad_id) is None


def test_registry_disabled_definition_behavior():
    """Verify that disabled definitions are respected and filtered out of active listings."""
    custom_reg = AgentRegistry()
    disabled_def = AgentDefinition(
        agent_type="contractor_disabled",
        display_name="Temporary Contractor",
        description="Temporarily disabled contractor",
        default_assigned_agent_id="agent-contractor-01",
        system_prompt="Disabled prompt",
        allowed_tools=["file_read"],
        permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
        enabled=False,
    )
    custom_reg.register(disabled_def)

    # Definition exists in registry but is marked disabled
    retrieved = custom_reg.get("contractor_disabled")
    assert retrieved is not None
    assert retrieved.enabled is False

    # Filtered from active list
    assert retrieved not in custom_reg.list_active()

    # resolve_agent_type_for_agent_id returns None for disabled definitions
    assert custom_reg.resolve_agent_type_for_agent_id("agent-contractor-01") is None
    assert custom_reg.resolve_agent_type_for_agent_id("contractor_disabled") is None


def test_registry_dynamically_recruited_specialist():
    """Verify that dynamic specialist definitions registered during recruitment can be resolved."""
    custom_reg = AgentRegistry()
    recruited_id = "agent-recruited-sec-audit"
    dynamic_def = AgentDefinition(
        agent_type=recruited_id,
        display_name="Security Auditor Specialist",
        description="Dynamic Security Audit Specialist",
        default_assigned_agent_id=recruited_id,
        system_prompt="Security audit prompt",
        allowed_tools=["workspace_list", "file_read"],
        permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
        enabled=True,
    )
    custom_reg.register(dynamic_def)

    # Resolves by both employee ID and type
    assert custom_reg.get_by_employee_id(recruited_id) == dynamic_def
    assert custom_reg.get(recruited_id) == dynamic_def
    assert custom_reg.resolve_agent_def(recruited_id) == dynamic_def


@pytest.mark.asyncio
async def test_dispatcher_rejects_unresolvable_agent_identity_no_silent_fallback(db_session):
    """Verify that Dispatcher rejects tasks with unresolvable agent identities and does NOT silently run general agent."""
    ghost_agent_id = "agent-nonexistent-ghost-404"
    # Agent exists in DB to satisfy foreign keys, but has NO AgentDefinition registered
    ghost_agent = AgentModel(
        id=ghost_agent_id,
        name="Unregistered Employee",
        role="Ghost Role",
        status="idle",
        organization_id="org_default_company",
    )
    db_session.add(ghost_agent)
    db_session.flush()

    fake_task = TaskModel(
        id="task-unresolvable-identity-001",
        title="Execute Rogue Mission",
        description="Should fail cleanly due to unresolvable agent identity",
        status="queued",
        priority="normal",
        assigned_agent_id=ghost_agent_id,
        organization_id="org_default_company",
        created_at=datetime.utcnow(),
    )
    db_session.add(fake_task)
    db_session.commit()

    await task_dispatcher._process_task(fake_task.id, db=db_session)

    db_session.refresh(fake_task)
    assert fake_task.status == "failed"
    assert "unresolvable agent identity" in fake_task.error_message
    assert ghost_agent_id in fake_task.error_message


@pytest.mark.asyncio
async def test_dispatcher_rejects_disabled_agent_definition(db_session):
    """Verify that Dispatcher cancels execution when the assigned agent's definition is disabled."""
    disabled_id = "agent-temp-disabled-emp"
    disabled_def = AgentDefinition(
        agent_type="temp_disabled",
        display_name="Disabled Staff",
        description="Temporarily disabled staff",
        default_assigned_agent_id=disabled_id,
        system_prompt="Disabled",
        allowed_tools=["file_read"],
        permission_level=ToolPermissionLevel.LEVEL_0_READ_ONLY,
        enabled=False,
    )
    default_agent_registry.register(disabled_def)

    emp_agent = AgentModel(
        id=disabled_id,
        name="Disabled Staff Member",
        role="Temp Staff",
        status="idle",
        organization_id="org_default_company",
    )
    db_session.add(emp_agent)

    task = TaskModel(
        id="task-disabled-agent-001",
        title="Execute On Disabled Agent",
        description="Should be cancelled because definition is disabled",
        status="queued",
        priority="normal",
        assigned_agent_id=disabled_id,
        organization_id="org_default_company",
        created_at=datetime.utcnow(),
    )
    db_session.add(task)
    db_session.commit()

    await task_dispatcher._process_task(task.id, db=db_session)

    db_session.refresh(task)
    assert task.status == "cancelled"
    assert "disabled in registry" in task.error_message


@pytest.mark.asyncio
async def test_dispatcher_executes_corporate_research_scientist_with_correct_policy(db_session, auth_client):
    """Verify that assigning a task to Dr. Elena Rostova executes with her authoritative research policy."""
    # Ensure Elena exists in DB
    elena = db_session.query(AgentModel).filter(AgentModel.id == "agent-research-ai").first()
    if not elena:
        elena = AgentModel(
            id="agent-research-ai",
            name="Dr. Elena Rostova",
            role="Chief AI Scientist",
            station="research_lab",
            status="idle",
            organization_id="org_default_company",
        )
        db_session.add(elena)
        db_session.commit()

    task = TaskModel(
        id="task-research-elena-001",
        title="Examine AI Architecture Models",
        description="Read workspace documentation and extract architectural findings",
        status="queued",
        priority="high",
        assigned_agent_id="agent-research-ai",
        organization_id="org_default_company",
        created_at=datetime.utcnow(),
    )
    db_session.add(task)
    db_session.commit()

    await task_dispatcher._process_task(task.id, db=db_session)

    db_session.refresh(task)
    assert task.status == "completed"
    assert task.result_summary is not None


# ==============================================================================
# PHASE C: CORPORATE SKILL ASSIGNMENT TESTS
# ==============================================================================

def test_skill_loader_scans_and_parses_available_skills():
    """Verify that SkillLoader indexes real skills from agent-skills/skills."""
    all_skills = skill_loader.list_skills()
    assert len(all_skills) >= 15
    skill_names = [s.name for s in all_skills]
    assert "internal-comms" in skill_names
    assert "mcp-builder" in skill_names
    assert "pdf" in skill_names
    assert "xlsx" in skill_names
    assert "brand-guidelines" in skill_names


def test_corporate_employee_role_based_skill_assignment():
    """Verify that all eight corporate employees receive their intended corporate capability skills."""
    # 1. Victoria Vance (CEO)
    ceo_skills = [s.name for s in skill_loader.get_agent_skills("agent-exec-ceo")]
    assert "internal-comms" in ceo_skills
    assert "doc-coauthoring" in ceo_skills
    assert "discernment-nudge" in ceo_skills

    # 2. David Chen (Engineering Lead)
    eng_skills = [s.name for s in skill_loader.get_agent_skills("agent-eng-lead")]
    assert "mcp-builder" in eng_skills
    assert "webapp-testing" in eng_skills
    assert "frontend-design" in eng_skills

    # 3. Dr. Elena Rostova (Research Scientist)
    research_skills = [s.name for s in skill_loader.get_agent_skills("agent-research-ai")]
    assert "pdf" in research_skills
    assert "docx" in research_skills
    assert "doc-coauthoring" in research_skills

    # 4. Sophia Martinez (Marketing VP)
    mkt_skills = [s.name for s in skill_loader.get_agent_skills("agent-mkt-growth")]
    assert "brand-guidelines" in mkt_skills
    assert "pptx" in mkt_skills
    assert "canvas-design" in mkt_skills

    # 5. Marcus Reynolds (Sales Director)
    sales_skills = [s.name for s in skill_loader.get_agent_skills("agent-sales-director")]
    assert "internal-comms" in sales_skills
    assert "pptx" in sales_skills

    # 6. Julian Thorne (CFO)
    fin_skills = [s.name for s in skill_loader.get_agent_skills("agent-fin-controller")]
    assert "xlsx" in fin_skills
    assert "pdf" in fin_skills

    # 7. Amara Okafor (Operations Head)
    ops_skills = [s.name for s in skill_loader.get_agent_skills("agent-ops-recruiter")]
    assert "internal-comms" in ops_skills
    assert "academy-guide" in ops_skills

    # 8. Liam O'Connor (Customer Success Head)
    cs_skills = [s.name for s in skill_loader.get_agent_skills("agent-support-lead")]
    assert "internal-comms" in cs_skills
    assert "doc-coauthoring" in cs_skills


def test_skill_loader_department_fallback_for_recruited_specialists():
    """Verify that recruited specialists receive skills according to their department when no custom skills are set."""
    eng_recruited_skills = [
        s.name for s in skill_loader.get_agent_skills("agent-new-hire-01", department="Engineering")
    ]
    assert "mcp-builder" in eng_recruited_skills
    assert "webapp-testing" in eng_recruited_skills

    fin_recruited_skills = [
        s.name for s in skill_loader.get_agent_skills("agent-new-hire-02", department="Finance")
    ]
    assert "xlsx" in fin_recruited_skills


def test_skill_loader_employee_specific_override():
    """Verify that explicit custom skill assignments override standard mappings."""
    override_agent_id = "agent-eng-lead"
    custom_skills = ["xlsx", "slack-gif-creator"]

    try:
        skill_loader.register_agent_skills(override_agent_id, custom_skills)
        equipped = [s.name for s in skill_loader.get_agent_skills(override_agent_id)]
        assert equipped == custom_skills
    finally:
        # Clean up override to preserve test isolation
        if override_agent_id in skill_loader._custom_agent_skills:
            del skill_loader._custom_agent_skills[override_agent_id]


def test_skill_loader_unknown_employee_without_department_returns_empty():
    """Verify that an unknown agent with no department or mapping returns an empty skill list."""
    unknown_skills = skill_loader.get_agent_skills("agent-completely-unknown")
    assert unknown_skills == []


def test_skill_security_separation_does_not_modify_policy_permissions():
    """Verify that skills provide operational guidance only and cannot escalate AgentPolicy permissions or tools."""
    # Research Agent is Level 0 Read-Only
    policy = RESEARCH_AGENT_DEF.to_policy()
    assert policy.max_permission_level == ToolPermissionLevel.LEVEL_0_READ_ONLY
    assert policy.allow_sandbox_write is False
    assert "workspace_write" not in policy.allowed_tools

    # Equipping skills to research agent
    skills_prompt = skill_loader.get_skills_prompt_for_agent("agent-research-ai")
    assert "EQUIPPED CORPORATE OPERATIONAL SKILLS" in skills_prompt
    assert "CRITICAL SECURITY MANDATE & GOVERNANCE" in skills_prompt
    assert "DO NOT grant permissions" in skills_prompt

    # Policy remains strictly intact and unescalated
    assert policy.max_permission_level == ToolPermissionLevel.LEVEL_0_READ_ONLY
    assert "workspace_write" not in policy.allowed_tools


# ==============================================================================
# PHASE D & E: API & RETRIEVAL COMPATIBILITY
# ==============================================================================

def test_api_v1_agents_registry_endpoint(client):
    """Verify that /api/v1/agents/registry returns active corporate definitions."""
    res = client.get("/api/v1/agents/registry")
    assert res.status_code == 200
    registry_data = res.json()
    assert len(registry_data) >= 8

    registered_types = [a["agent_type"] for a in registry_data]
    assert "general" in registered_types
    assert "research" in registered_types
    assert "reviewer" in registered_types
    assert "analyst" in registered_types
    assert "writer" in registered_types
    assert "sales" in registered_types
    assert "operations" in registered_types
    assert "support" in registered_types


def test_api_v1_agents_skills_endpoint(client):
    """Verify that /api/v1/skills and /api/v1/skills/agent/{id} reflect corporate employees."""
    res = client.get("/api/v1/skills")
    assert res.status_code == 200
    skills = res.json()
    assert len(skills) >= 15

    # Check skills for Elena Rostova
    agent_res = client.get("/api/v1/skills/agent/agent-research-ai")
    assert agent_res.status_code == 200
    elena_skills = [s["name"] for s in agent_res.json()]
    assert "pdf" in elena_skills
    assert "docx" in elena_skills


def test_legacy_router_deprecation_isolation():
    """Verify that backend.app.routers.agents is safely deprecated and aliases corporate seed."""
    from backend.app.routers.agents import router, INITIAL_AGENTS as LEGACY_INITIAL
    assert router.prefix == "/api/agents"
    # Ensure INITIAL_AGENTS in legacy router points to corporate agents, not pirates
    emp_ids = [a["id"] for a in LEGACY_INITIAL]
    assert "agent-exec-ceo" in emp_ids
    assert "agent-research-ai" in emp_ids
    assert "agent-captain-roger" not in emp_ids
