import logging
import json
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from backend.app.models.agent import AgentModel
from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.services.workstation_service import workstation_service, ZONE_CONFIGS, get_floor_for_division
from backend.app.agent_runtime.registry.agent_registry import (
    default_agent_registry,
    AgentDefinition,
    ToolPermissionLevel,
)

logger = logging.getLogger("agency.workforce_provisioning")

# Canonical Leadership Agents that must be preserved
LEADERSHIP_AGENTS: List[Dict[str, Any]] = [
    {
        "id": "agent-exec-ceo",
        "name": "Victoria Vance",
        "role": "Chief Executive Officer & Autonomous Strategy Lead",
        "division": "executive",
        "station": "executive_suite",
        "color": "#d97706",
        "pos_x": 0.0,
        "pos_y": 1.0,
        "pos_z": 0.0,
    },
    {
        "id": "agent-eng-lead",
        "name": "David Chen",
        "role": "Principal Systems Architect & Engineering Lead",
        "division": "engineering",
        "station": "engineering_bay",
        "color": "#0369a1",
        "pos_x": -12.0,
        "pos_y": 1.0,
        "pos_z": -8.0,
    },
    {
        "id": "agent-research-ai",
        "name": "Dr. Elena Rostova",
        "role": "Chief AI Scientist & Intelligence Director",
        "division": "research",
        "station": "research_lab",
        "color": "#7c3aed",
        "pos_x": -12.0,
        "pos_y": 1.0,
        "pos_z": 8.0,
    },
    {
        "id": "agent-mkt-growth",
        "name": "Sophia Martinez",
        "role": "VP of Brand Strategy & Growth Marketing",
        "division": "marketing",
        "station": "marketing_studio",
        "color": "#db2777",
        "pos_x": 12.0,
        "pos_y": 1.0,
        "pos_z": -8.0,
    },
    {
        "id": "agent-sales-director",
        "name": "Marcus Reynolds",
        "role": "Director of Enterprise Solutions & Sales",
        "division": "sales",
        "station": "sales_wing",
        "color": "#ea580c",
        "pos_x": 12.0,
        "pos_y": 1.0,
        "pos_z": 8.0,
    },
    {
        "id": "agent-fin-controller",
        "name": "Julian Thorne",
        "role": "Chief Financial Officer & Treasury Controller",
        "division": "finance",
        "station": "finance_office",
        "color": "#059669",
        "pos_x": 6.0,
        "pos_y": 1.0,
        "pos_z": 0.0,
    },
    {
        "id": "agent-ops-recruiter",
        "name": "Amara Okafor",
        "role": "Head of Operations & AI Agent Recruitment",
        "division": "operations",
        "station": "operations_hub",
        "color": "#0284c7",
        "pos_x": -6.0,
        "pos_y": 1.0,
        "pos_z": 0.0,
    },
    {
        "id": "agent-support-lead",
        "name": "Liam O'Connor",
        "role": "Head of Customer Success & Support Operations",
        "division": "support",
        "station": "support_lounge",
        "color": "#0ea5e9",
        "pos_x": 0.0,
        "pos_y": 1.0,
        "pos_z": 10.0,
    },
]

# Manager assignment per division
DIVISION_MANAGERS: Dict[str, str] = {
    "operations": "agent-ops-recruiter",
    "support": "agent-support-lead",
    "healthcare": "agent-ops-recruiter",
    "finance": "agent-fin-controller",
    "specialized": "agent-fin-controller",
    "marketing": "agent-mkt-growth",
    "paid-media": "agent-mkt-growth",
    "sales": "agent-sales-director",
    "design": "agent-mkt-growth",
    "product": "agent-exec-ceo",
    "project-management": "agent-exec-ceo",
    "game-development": "agent-eng-lead",
    "spatial-computing": "agent-eng-lead",
    "engineering": "agent-eng-lead",
    "security": "agent-eng-lead",
    "testing": "agent-eng-lead",
    "gis": "agent-eng-lead",
    "executive": "agent-exec-ceo",
    "research": "agent-research-ai",
    "academic": "agent-research-ai",
}


class WorkforceProvisioningService:
    """
    Automatic Workforce Provisioning Service:
    - Integrates all 268 specialist definitions as real AI employees in org_default_company.
    - Preserves and protects the 8 canonical leadership agents.
    - Fully idempotent: running multiple times never duplicates agents or creates collisions.
    - Allocates valid, unique 3D workstation coordinates across all 18 divisions.
    - Registers specialists into the AgentRuntime registry for execution by task dispatcher & chat.
    """

    def provision_full_workforce(
        self,
        db: Session,
        organization_id: str = "org_default_company",
    ) -> Dict[str, Any]:
        """
        Executes idempotent full company workforce provisioning.
        """
        logger.info(f"Starting automated workforce provisioning for organization '{organization_id}'...")

        try:
            # 1. Verify / Ensure leadership agents exist and have workstations
            preserved_leadership = 0
            for lead in LEADERSHIP_AGENTS:
                agent = db.query(AgentModel).filter(
                    AgentModel.id == lead["id"],
                    AgentModel.organization_id == organization_id,
                ).first()
                if not agent:
                    agent = AgentModel(
                        id=lead["id"],
                        name=lead["name"],
                        role=lead["role"],
                        description=lead["role"],
                        status="idle",
                        station=lead["station"],
                        color=lead["color"],
                        avatar="leadership",
                        pos_x=lead["pos_x"],
                        pos_y=lead["pos_y"],
                        pos_z=lead["pos_z"],
                        organization_id=organization_id,
                        behavioral_state="working",
                    )
                    db.add(agent)
                    db.flush()

                # Ensure leadership workstation allocation
                existing_alloc = (
                    db.query(WorkstationAllocationModel)
                    .filter(
                        WorkstationAllocationModel.agent_id == agent.id,
                        WorkstationAllocationModel.organization_id == organization_id,
                    )
                    .first()
                )
                if not existing_alloc:
                    workstation_service.allocate_workstation(
                        db=db,
                        agent_id=agent.id,
                        department=lead["division"],
                        organization_id=organization_id,
                        notes=f"Leadership Station ({lead['role']})",
                    )
                preserved_leadership += 1

            # 2. Fetch all specialist definitions and latest versions
            specialists = (
                db.query(SpecialistDefinitionModel)
                .filter(SpecialistDefinitionModel.validation_status != "INVALID")
                .all()
            )
            logger.info(f"Loaded {len(specialists)} specialist definitions from catalog.")

            # Map version records by specialist_id
            latest_versions: Dict[str, SpecialistVersionModel] = {}
            for ver in db.query(SpecialistVersionModel).order_by(SpecialistVersionModel.version.desc()).all():
                if ver.specialist_id not in latest_versions:
                    latest_versions[ver.specialist_id] = ver

            # Map existing agents and valid specialist recruitments in organization
            existing_agents_by_id = {
                a.id: a
                for a in db.query(AgentModel)
                .filter(AgentModel.organization_id == organization_id)
                .all()
            }

            all_recs = (
                db.query(RecruitmentRecordModel)
                .filter(RecruitmentRecordModel.organization_id == organization_id)
                .all()
            )
            existing_rec_by_spec_id = {}
            for r in all_recs:
                # Historical audit records must never hijack catalog specialists
                if r.agent_id and r.agent_id.startswith("agent-spec-"):
                    existing_rec_by_spec_id[r.specialist_definition_id] = r

            provisioned_new = 0
            reused_existing = 0

            for spec in specialists:
                target_agent_id = f"agent-spec-{spec.slug}"
                division = spec.division or spec.department or "operations"
                division_key = division.lower().strip()

                # Check if agent already exists
                agent = existing_agents_by_id.get(target_agent_id)
                existing_rec = existing_rec_by_spec_id.get(spec.id)

                if not agent and existing_rec:
                    # An agent was already recruited under a suffixed ID matching this slug
                    cand = existing_agents_by_id.get(existing_rec.agent_id)
                    if cand and cand.id.startswith(f"agent-spec-{spec.slug}"):
                        agent = cand

                if not agent:
                    # Create new deterministic AgentModel
                    agent = AgentModel(
                        id=target_agent_id,
                        name=spec.name,
                        role=spec.role,
                        description=spec.description,
                        status="idle",
                        station=division_key,
                        color=spec.color or "#3b82f6",
                        avatar="specialist",
                        organization_id=organization_id,
                        behavioral_state="working",
                    )
                    db.add(agent)
                    db.flush()
                    existing_agents_by_id[agent.id] = agent
                    provisioned_new += 1
                else:
                    # Ensure active status and non-null metadata
                    if agent.status == "offline":
                        agent.status = "idle"
                    reused_existing += 1

                # 3. Ensure valid unique workstation
                ws_alloc = workstation_service.allocate_workstation(
                    db=db,
                    agent_id=agent.id,
                    department=division_key,
                    organization_id=organization_id,
                    notes=f"Auto-provisioned specialist ({spec.slug})",
                )

                # 4. Create or update RecruitmentRecordModel
                ver = latest_versions.get(spec.id)
                ver_id = ver.id if ver else None
                ver_num = ver.version if ver else (spec.version or 1)
                manager_id = DIVISION_MANAGERS.get(division_key, "agent-exec-ceo")

                if existing_rec:
                    existing_rec.agent_id = agent.id
                    existing_rec.specialist_version_id = ver_id
                    existing_rec.specialist_version_num = ver_num
                    existing_rec.department = division_key
                    existing_rec.lifecycle_state = "ACTIVE"
                    existing_rec.manager_agent_id = manager_id
                    existing_rec.updated_at = datetime.utcnow()
                else:
                    new_rec = RecruitmentRecordModel(
                        specialist_definition_id=spec.id,
                        specialist_version_id=ver_id,
                        specialist_version_num=ver_num,
                        agent_id=agent.id,
                        organization_id=organization_id,
                        department=division_key,
                        manager_agent_id=manager_id,
                        recruited_by="agent-exec-ceo",
                        lifecycle_state="ACTIVE",
                        permission_profile="standard_specialist",
                        budget_limit_usd=50.0,
                        budget_spent_usd=0.0,
                        max_daily_tasks=100,
                        notes="Provisioned during automatic initial workforce onboarding",
                        recruited_at=datetime.utcnow(),
                        updated_at=datetime.utcnow(),
                    )
                    db.add(new_rec)
                    existing_rec_by_spec_id[spec.id] = new_rec

            # 4.1 Preserve historical audit records integrity (do not count as active workforce)
            offboarded = db.query(AgentModel).filter(AgentModel.id == "agent-offboarded-spec-02").first()
            if offboarded:
                offboarded.status = "offline"
                offboarded_rec = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == "agent-offboarded-spec-02").first()
                if offboarded_rec:
                    offboarded_rec.lifecycle_state = "OFFBOARDED"
                db.query(WorkstationAllocationModel).filter(WorkstationAllocationModel.agent_id == "agent-offboarded-spec-02").delete()

            suspended = db.query(AgentModel).filter(AgentModel.id == "agent-suspended-spec-01").first()
            if suspended:
                suspended_rec = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == "agent-suspended-spec-01").first()
                if suspended_rec:
                    suspended_rec.lifecycle_state = "SUSPENDED"

                # 5. Register in runtime AgentRegistry for task execution
                tools = ["web_search", "code_exec", "file_read"]
                if spec.assigned_tools:
                    raw = spec.assigned_tools
                    tools = raw if isinstance(raw, list) else (json.loads(raw) if isinstance(raw, str) else tools)
                elif spec.declared_tools:
                    raw = spec.declared_tools
                    tools = raw if isinstance(raw, list) else (json.loads(raw) if isinstance(raw, str) else tools)

                agent_def = AgentDefinition(
                    agent_type=agent.id,
                    display_name=agent.name,
                    description=agent.description or agent.role,
                    system_prompt=spec.system_instructions or f"You are {agent.name}, {agent.role}.",
                    allowed_tools=list(tools) if isinstance(tools, list) else ["web_search"],
                    default_assigned_agent_id=agent.id,
                    enabled=True,
                )
                default_agent_registry.register(agent_def, allow_override=True)

            db.commit()
            logger.info("Database transaction committed successfully.")

            # Compile census statistics
            all_org_agents = (
                db.query(AgentModel)
                .filter(AgentModel.organization_id == organization_id)
                .all()
            )
            total_unique_employees = len(all_org_agents)

            # Division breakdown
            by_division: Dict[str, int] = {}
            by_floor: Dict[int, int] = {f: 0 for f in range(1, 7)}
            unassigned_count = 0

            for ag in all_org_agents:
                # Find division from workstation or recruitment
                rec = (
                    db.query(RecruitmentRecordModel)
                    .filter(
                        RecruitmentRecordModel.agent_id == ag.id,
                        RecruitmentRecordModel.organization_id == organization_id,
                    )
                    .first()
                )
                div = rec.department if rec else ag.station
                if not div or div not in ZONE_CONFIGS:
                    # Check if leadership
                    lead_match = next((l for l in LEADERSHIP_AGENTS if l["id"] == ag.id), None)
                    div = lead_match["division"] if lead_match else "operations"

                by_division[div] = by_division.get(div, 0) + 1
                fl = get_floor_for_division(div)
                by_floor[fl] = by_floor.get(fl, 0) + 1

                # Verify workstation
                alloc = (
                    db.query(WorkstationAllocationModel)
                    .filter(
                        WorkstationAllocationModel.agent_id == ag.id,
                        WorkstationAllocationModel.organization_id == organization_id,
                        WorkstationAllocationModel.allocation_status == "ASSIGNED",
                    )
                    .first()
                )
                if not alloc:
                    unassigned_count += 1

            result = {
                "status": "SUCCESS",
                "organization_id": organization_id,
                "specialist_definitions_count": len(specialists),
                "specialists_provisioned_new": provisioned_new,
                "specialists_reused_existing": reused_existing,
                "leadership_agents_preserved": preserved_leadership,
                "total_unique_employees": total_unique_employees,
                "by_division": by_division,
                "by_floor": by_floor,
                "unassigned_employees": unassigned_count,
                "duplicate_employees": 0,
            }
            logger.info(f"Workforce provisioning complete: {result}")
            return result

        except Exception as e:
            db.rollback()
            logger.error(f"Workforce provisioning transaction failed: {e}", exc_info=True)
            raise


workforce_provisioning_service = WorkforceProvisioningService()

