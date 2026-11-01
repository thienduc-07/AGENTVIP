import logging
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_

from backend.app.models.agent import AgentModel
from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel
from backend.app.models.recruitment import RecruitmentRecordModel, AgentPerformanceModel
from backend.app.agent_runtime.registry.agent_registry import (
    default_agent_registry,
    AgentDefinition,
    ToolPermissionLevel,
)
from backend.app.websocket_manager import ws_manager

logger = logging.getLogger("agency.recruitment")

# Department Lead Agent IDs
DEPARTMENT_MANAGERS = {
    "Engineering": "agent-eng-lead",
    "AI Research": "agent-research-ai",
    "Marketing": "agent-mkt-growth",
    "Sales": "agent-sales-director",
    "Finance": "agent-fin-controller",
    "Operations": "agent-ops-recruiter",
    "Customer Success": "agent-support-lead",
    "Executive": "agent-exec-ceo",
}

DEPARTMENT_STATIONS = {
    "Engineering": ("engineering_bay", -22.0, 1.0, -8.0),
    "AI Research": ("research_lab", 22.0, 1.0, -8.0),
    "Marketing": ("marketing_studio", -22.0, 1.0, 8.0),
    "Sales": ("sales_wing", 22.0, 1.0, 8.0),
    "Finance": ("finance_office", -14.0, 1.0, 20.0),
    "Operations": ("operations_hub", 14.0, 1.0, 20.0),
    "Customer Success": ("support_lounge", 0.0, 1.0, 10.0),
    "Executive": ("executive_suite", 0.0, 1.0, -18.0),
}

# Lifecycle transitions allowed
VALID_TRANSITIONS = {
    "DISCOVERED": ["IMPORTED"],
    "IMPORTED": ["VALIDATED", "INVALID"],
    "VALIDATED": ["AVAILABLE", "INVALID"],
    "AVAILABLE": ["RECRUITED", "SUSPENDED"],
    "RECRUITED": ["CONFIGURED", "SUSPENDED", "RETIRED"],
    "CONFIGURED": ["ACTIVE", "SUSPENDED", "RETIRED"],
    "ACTIVE": ["SUSPENDED", "RETIRED"],
    "SUSPENDED": ["ACTIVE", "RETIRED"],
    "RETIRED": [],
    "INVALID": [],
    "FAILED": ["RETIRED"],
}

class RecruitmentService:
    """
    Manages the specialist recruitment lifecycle:
    DISCOVERED -> IMPORTED -> VALIDATED -> AVAILABLE -> RECRUITED -> CONFIGURED -> ACTIVE
    - Recruits specialists into departments under authorized managers
    - Assigns stations and 3D positioning
    - Enforces permission profiles and resource budgets
    - Dynamically registers active specialists into the AgentRuntime
    - Tracks agent performance metrics
    """

    def recruit_specialist(
        self,
        db: Session,
        specialist_id: str,
        organization_id: str = "org_default_company",
        recruited_by: str = "agent-exec-ceo",
        manager_agent_id: Optional[str] = None,
        department: Optional[str] = None,
        custom_name: Optional[str] = None,
        budget_limit_usd: float = 50.0,
        permission_profile: str = "standard_specialist",
        notes: Optional[str] = None,
        is_virtual: bool = False,
        requested_version: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Recruits an available specialist from the catalog as an active employee for an organization.
        Pins the specialist to an immutable version record.
        Maintains an atomic transaction boundary with rollback on failure.
        """
        # 1. Fetch specialist definition
        specialist = (
            db.query(SpecialistDefinitionModel)
            .filter(
                or_(
                    SpecialistDefinitionModel.id == specialist_id,
                    SpecialistDefinitionModel.slug == specialist_id,
                )
            )
            .first()
        )
        if not specialist:
            raise ValueError(f"Specialist '{specialist_id}' not found in library.")

        if specialist.validation_status == "INVALID":
            raise ValueError(f"Cannot recruit invalid specialist: {specialist.validation_errors}")

        # Check duplicate recruitment within the same organization
        existing_recruitment = (
            db.query(RecruitmentRecordModel)
            .filter(
                RecruitmentRecordModel.specialist_definition_id == specialist.id,
                RecruitmentRecordModel.organization_id == organization_id,
                RecruitmentRecordModel.lifecycle_state.in_(["ACTIVE", "CONFIGURED", "SUSPENDED"]),
            )
            .first()
        )
        if existing_recruitment:
            raise ValueError(
                f"Specialist '{specialist.name}' ({specialist.slug}) is already recruited in organization '{organization_id}'."
            )

        # 1.1 Resolve pinned specialist version record
        version_query = db.query(SpecialistVersionModel).filter(
            SpecialistVersionModel.specialist_id == specialist.id
        )
        if requested_version is not None:
            version_record = version_query.filter(SpecialistVersionModel.version == requested_version).first()
            if not version_record:
                raise ValueError(f"Requested version {requested_version} for specialist '{specialist.slug}' not found.")
        else:
            version_record = version_query.filter(SpecialistVersionModel.version == specialist.version).first()
            if not version_record:
                version_record = version_query.order_by(SpecialistVersionModel.version.desc()).first()

        version_id = version_record.id if version_record else None
        version_num = version_record.version if version_record else (specialist.version or 1)

        # 2. Determine department & manager
        dept = department or specialist.department
        if not dept or dept not in DEPARTMENT_STATIONS:
            dept = "Operations"

        default_manager = DEPARTMENT_MANAGERS.get(dept, "agent-exec-ceo")
        manager_id = manager_agent_id or default_manager

        # Verify manager exists in DB
        manager = db.query(AgentModel).filter(AgentModel.id == manager_id).first()
        if not manager:
            ceo = db.query(AgentModel).filter(AgentModel.id == "agent-exec-ceo").first()
            manager_id = "agent-exec-ceo" if ceo else None

        # 3. Create unique AgentModel instance for the organization
        unique_suffix = str(uuid.uuid4())[:8]
        agent_id = f"agent-spec-{specialist.slug}-{unique_suffix}"
        agent_name = custom_name or f"{specialist.name} (Specialist)"

        station_name, base_x, base_y, base_z = DEPARTMENT_STATIONS.get(dept, ("operations_hub", 14.0, 1.0, 20.0))

        spec_slug = specialist.slug
        try:
            agent = AgentModel(
                id=agent_id,
                name=agent_name,
                role=specialist.role,
                description=specialist.description,
                status="idle",
                station=station_name,
                pos_x=base_x,
                pos_y=base_y,
                pos_z=base_z,
                color=specialist.color or "#3b82f6",
                avatar="specialist",
                organization_id=organization_id,
            )
            db.add(agent)
            db.flush()

            # 4. Allocate dynamic logical workstation
            from backend.app.services.workstation_service import workstation_service
            ws_alloc = workstation_service.allocate_workstation(
                db=db,
                agent_id=agent.id,
                department=dept,
                organization_id=organization_id,
                force_virtual=is_virtual,
                notes=notes,
            )

            # 5. Create RecruitmentRecordModel with organization binding and pinned version
            recruitment = RecruitmentRecordModel(
                specialist_definition_id=specialist.id,
                specialist_version_id=version_id,
                specialist_version_num=version_num,
                agent_id=agent.id,
                organization_id=organization_id,
                department=dept,
                manager_agent_id=manager_id,
                recruited_by=recruited_by,
                lifecycle_state="ACTIVE",
                permission_profile=permission_profile,
                budget_limit_usd=budget_limit_usd,
                budget_spent_usd=0.0,
                max_daily_tasks=100,
                model_preference="auto",
                memory_policy={"retention_days": 30, "scope": f"dept_{dept.lower()}"},
                notes=notes or f"Recruited by {recruited_by} to {dept} department (pinned v{version_num})",
                recruited_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            db.add(recruitment)

            # 6. Initialize Performance Tracking
            perf = AgentPerformanceModel(
                agent_id=agent.id,
                tasks_completed=0,
                tasks_failed=0,
                avg_duration_ms=0.0,
                avg_quality_score=100.0,
                total_tokens_used=0,
                total_cost_usd=0.0,
                last_active_at=None,
                updated_at=datetime.utcnow(),
            )
            db.add(perf)

            # 7. Update specialist definition state if previously unrecruited
            if specialist.lifecycle_state == "AVAILABLE":
                specialist.lifecycle_state = "RECRUITED"

            # Single outer commit owning the transaction
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to recruit specialist '{spec_slug}': {e}")
            raise

        # 8. Register dynamically in AgentRegistry using pinned version
        self._register_in_runtime(agent, specialist, dept, version_record)

        # 9. Persist and broadcast realtime WebSocket event
        self._publish_event(
            db=db,
            event_type="agent.recruited",
            agent_id=agent.id,
            organization_id=organization_id,
            payload={
                "agent_id": agent.id,
                "name": agent.name,
                "role": agent.role,
                "department": dept,
                "manager_id": manager_id,
                "station": ws_alloc.office_zone,
                "position": [ws_alloc.pos_x, ws_alloc.pos_y, ws_alloc.pos_z],
                "color": agent.color,
                "specialist_slug": specialist.slug,
                "specialist_version_id": version_id,
                "specialist_version_num": version_num,
                "organization_id": organization_id,
                "logical_workstation_id": ws_alloc.logical_workstation_id,
                "is_virtual": ws_alloc.is_virtual,
            },
        )

        logger.info(
            f"Specialist '{specialist.slug}' (pinned v{version_num}) recruited as agent '{agent.id}' in {dept} for Org '{organization_id}' (Workstation: {ws_alloc.logical_workstation_id})."
        )
        return {
            "success": True,
            "agent_id": agent.id,
            "name": agent.name,
            "department": dept,
            "manager_agent_id": manager_id,
            "organization_id": organization_id,
            "lifecycle_state": "ACTIVE",
            "specialist_version_id": version_id,
            "specialist_version_num": version_num,
            "station": ws_alloc.office_zone,
            "logical_workstation_id": ws_alloc.logical_workstation_id,
            "desk_number": ws_alloc.desk_number,
            "is_virtual": ws_alloc.is_virtual,
            "position": [ws_alloc.pos_x, ws_alloc.pos_y, ws_alloc.pos_z],
            "budget_limit_usd": budget_limit_usd,
            "recruited_at": recruitment.recruited_at.isoformat(),
        }

    def _register_in_runtime(
        self,
        agent: AgentModel,
        specialist: SpecialistDefinitionModel,
        department: str,
        version_record: Optional[SpecialistVersionModel] = None,
    ):
        """
        Dynamically registers recruited agent in the AgentRegistry.
        Uses the pinned specialist version instructions if available.
        """
        mission = specialist.core_mission or specialist.description
        critical_rules = specialist.critical_rules or "Always operate safely within workspace_sandbox."
        assigned_tools = specialist.assigned_tools or ["workspace_list", "file_read"]
        permission_level = specialist.permission_level
        pinned_ver_num = version_record.version if version_record else (specialist.version or 1)

        # If pinned version has parsed_metadata, use the immutable snapshot
        if version_record and version_record.parsed_metadata:
            meta = version_record.parsed_metadata
            assigned_tools = meta.get("assigned_tools") or assigned_tools
            critical_rules = meta.get("critical_rules") or critical_rules
            if meta.get("permission_level") is not None:
                permission_level = meta.get("permission_level")
            if meta.get("core_mission"):
                mission = meta.get("core_mission")
            elif meta.get("system_instructions"):
                mission = meta.get("system_instructions")
        elif version_record and version_record.raw_content:
            # Fallback to parsing raw_content
            raw = version_record.raw_content
            body = raw
            if raw.startswith("---"):
                parts = raw.split("---", 2)
                if len(parts) >= 3:
                    body = parts[2]
            mission = body.strip() or mission

        perm_level = ToolPermissionLevel(permission_level)
        agent_def = AgentDefinition(
            agent_type=agent.id,
            display_name=agent.name,
            description=f"{specialist.role} ({department} Specialist - Pinned v{pinned_ver_num})",
            system_prompt=(
                f"You are {agent.name}, a specialized {specialist.role} in AI Agency — Autonomous Business Headquarters.\n"
                f"Reporting Department: {department}\n"
                f"Pinned Specialist Version: v{pinned_ver_num}\n\n"
                f"Core Mission & Expertise:\n{mission}\n\n"
                f"Critical Rules:\n{critical_rules}\n\n"
                f"Safety Instructions:\n"
                f"- Read files only within authorized workspace scope.\n"
                f"- Write outputs to workspace_sandbox/.\n"
                f"- Do not execute destructive commands or expose keys."
            ),
            allowed_tools=assigned_tools,
            permission_level=perm_level,
            max_tool_calls=15,
            max_iterations=10,
            timeout_seconds=120,
            enabled=True,
            concurrency_limit=2,
            default_assigned_agent_id=agent.id,
        )
        default_agent_registry.register(agent_def)

        # Equip recruited specialist with domain skills in SkillLoader
        try:
            from backend.app.agent_runtime.skills.skill_loader import skill_loader, DEPARTMENT_SKILL_ASSIGNMENTS
            assigned_skills = specialist.skills if isinstance(specialist.skills, list) else []
            if not assigned_skills and department:
                assigned_skills = DEPARTMENT_SKILL_ASSIGNMENTS.get(department, [])
            if assigned_skills:
                skill_loader.register_agent_skills(agent.id, assigned_skills)
        except Exception as e:
            logger.warning(f"Could not bind skills for recruited agent '{agent.id}': {e}")

    def transition_lifecycle(
        self,
        db: Session,
        agent_id: str,
        target_state: str,
        organization_id: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Transitions recruited agent state: ACTIVE, SUSPENDED, RETIRED.
        Enforces tenant authorization and cancels queued tasks upon suspension/retirement.
        """
        record = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == agent_id).first()
        if not record:
            raise ValueError(f"Recruitment record for agent '{agent_id}' not found.")

        if organization_id and record.organization_id != organization_id:
            raise PermissionError(f"Agent '{agent_id}' does not belong to organization '{organization_id}'.")

        current_state = record.lifecycle_state
        if current_state == target_state:
            return {
                "success": True,
                "agent_id": agent_id,
                "previous_state": current_state,
                "current_state": target_state,
                "lifecycle_state": target_state,
                "reason": reason or "Already in target state",
            }

        allowed = VALID_TRANSITIONS.get(current_state, [])
        if target_state not in allowed:
            raise ValueError(f"Invalid transition from {current_state} to {target_state}. Allowed: {allowed}")

        try:
            record.lifecycle_state = target_state
            record.updated_at = datetime.utcnow()
            if reason:
                record.notes = f"{record.notes or ''}\n[{datetime.utcnow().isoformat()}] Status changed to {target_state}: {reason}"

            agent = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
            if agent:
                agent.behavioral_state = "IDLE"
                if target_state == "SUSPENDED":
                    agent.status = "offline"
                    agent.current_task_id = None
                elif target_state == "ACTIVE":
                    agent.status = "idle"
                elif target_state == "RETIRED":
                    agent.status = "offline"
                    agent.current_task_id = None

            # Update runtime registry enabled flag
            reg_def = default_agent_registry.get(agent_id)
            if reg_def:
                reg_def.enabled = (target_state == "ACTIVE")

            # Handle tasks when transitioning to SUSPENDED or RETIRED
            if target_state in ["SUSPENDED", "RETIRED"]:
                from backend.app.models.task import TaskModel
                queued_tasks = (
                    db.query(TaskModel)
                    .filter(
                        TaskModel.assigned_agent_id == agent_id,
                        TaskModel.status.in_(["queued", "planning", "waiting_approval"]),
                    )
                    .all()
                )
                for t in queued_tasks:
                    t.status = "cancelled"
                    t.error_message = f"Task cancelled: assigned employee was {target_state.lower()}."
                    t.completed_at = datetime.utcnow()

                try:
                    from backend.app.agent_runtime import agent_runtime
                    for t in queued_tasks:
                        agent_runtime.cancel_task(t.id, reason=f"Employee {target_state.lower()}")
                except Exception as ce:
                    logger.debug(f"Runtime task cancellation notice skipped: {ce}")

            # If retiring, release physical workstation reservation
            if target_state == "RETIRED":
                from backend.app.services.workstation_service import workstation_service
                workstation_service.release_workstation(
                    db=db,
                    agent_id=agent_id,
                    organization_id=record.organization_id,
                    reason=reason or "Agent retired",
                )

            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to transition lifecycle: {e}")
            raise

        # Persist and broadcast authoritative lifecycle transition events
        self._publish_event(
            db=db,
            event_type="agent.lifecycle_changed",
            agent_id=agent_id,
            organization_id=record.organization_id,
            payload={
                "agent_id": agent_id,
                "previous_state": current_state,
                "current_state": target_state,
                "reason": reason,
                "organization_id": record.organization_id,
            },
        )

        if target_state == "ACTIVE":
            self._publish_event(
                db=db,
                event_type="agent.activated",
                agent_id=agent_id,
                organization_id=record.organization_id,
                payload={
                    "agent_id": agent_id,
                    "previous_state": current_state,
                    "reason": reason,
                    "organization_id": record.organization_id,
                },
            )
        elif target_state == "SUSPENDED":
            self._publish_event(
                db=db,
                event_type="agent.suspended",
                agent_id=agent_id,
                organization_id=record.organization_id,
                payload={
                    "agent_id": agent_id,
                    "previous_state": current_state,
                    "reason": reason,
                    "organization_id": record.organization_id,
                },
            )
        elif target_state in ("RETIRED", "OFFBOARDED"):
            self._publish_event(
                db=db,
                event_type="agent.offboarded",
                agent_id=agent_id,
                organization_id=record.organization_id,
                payload={
                    "agent_id": agent_id,
                    "previous_state": current_state,
                    "reason": reason,
                    "organization_id": record.organization_id,
                },
            )

        return {
            "success": True,
            "agent_id": agent_id,
            "previous_state": current_state,
            "current_state": target_state,
            "lifecycle_state": target_state,
            "reason": reason,
        }

    def restore_active_workforce(self, db: Session) -> int:
        """
        Loads all active recruited employees into the runtime registry,
        binding them to their pinned specialist versions.
        """
        active_records = (
            db.query(RecruitmentRecordModel)
            .filter(RecruitmentRecordModel.lifecycle_state == "ACTIVE")
            .all()
        )
        restored = 0
        for rec in active_records:
            agent = db.query(AgentModel).filter(AgentModel.id == rec.agent_id).first()
            spec = db.query(SpecialistDefinitionModel).filter(SpecialistDefinitionModel.id == rec.specialist_definition_id).first()
            if agent and spec:
                ver = None
                if rec.specialist_version_id:
                    ver = db.query(SpecialistVersionModel).filter(SpecialistVersionModel.id == rec.specialist_version_id).first()
                self._register_in_runtime(agent, spec, rec.department, ver)
                restored += 1
        logger.info(f"Restored {restored} active specialist(s) into runtime registry.")
        return restored

    def get_corporate_hierarchy(self, db: Session, organization_id: str = "org_default_company") -> Dict[str, Any]:
        """
        Returns full organizational hierarchy for the specified organization:
        Owner -> CEO -> Department Managers -> Recruited Specialists
        """
        ceo = db.query(AgentModel).filter(AgentModel.id == "agent-exec-ceo").first()

        departments_tree: Dict[str, Any] = {}

        for dept_name, manager_id in DEPARTMENT_MANAGERS.items():
            if dept_name == "Executive":
                continue
            manager = db.query(AgentModel).filter(AgentModel.id == manager_id).first()
            if not manager:
                continue

            recruited = (
                db.query(RecruitmentRecordModel, AgentModel, SpecialistDefinitionModel)
                .join(AgentModel, RecruitmentRecordModel.agent_id == AgentModel.id)
                .join(SpecialistDefinitionModel, RecruitmentRecordModel.specialist_definition_id == SpecialistDefinitionModel.id)
                .filter(
                    RecruitmentRecordModel.department == dept_name,
                    RecruitmentRecordModel.organization_id == organization_id,
                )
                .all()
            )

            specialists_list = []
            for rec, ag, spec in recruited:
                specialists_list.append({
                    "agent_id": ag.id,
                    "name": ag.name,
                    "role": ag.role,
                    "status": ag.status,
                    "lifecycle_state": rec.lifecycle_state,
                    "specialist_version_id": rec.specialist_version_id,
                    "specialist_version_num": rec.specialist_version_num,
                    "budget_limit_usd": rec.budget_limit_usd,
                    "budget_spent_usd": rec.budget_spent_usd,
                    "specialist_slug": spec.slug,
                    "emoji": spec.emoji,
                    "color": spec.color,
                })

            departments_tree[dept_name] = {
                "department": dept_name,
                "manager": {
                    "id": manager.id,
                    "name": manager.name,
                    "role": manager.role,
                    "status": manager.status,
                    "station": manager.station,
                },
                "headcount": len(specialists_list),
                "specialists": specialists_list,
            }

        return {
            "owner": "Autonomous Business Owner",
            "organization_id": organization_id,
            "ceo": {
                "id": ceo.id if ceo else "agent-exec-ceo",
                "name": ceo.name if ceo else "Victoria Vance",
                "role": "Chief Executive Officer & Autonomous Strategy Lead",
                "status": ceo.status if ceo else "idle",
            },
            "departments": departments_tree,
            "total_recruited": sum(d["headcount"] for d in departments_tree.values()),
        }

    def compare_specialists(self, db: Session, specialist_ids: List[str]) -> List[Dict[str, Any]]:
        """
        Compares multiple candidates side-by-side.
        """
        specs = (
            db.query(SpecialistDefinitionModel)
            .filter(
                or_(
                    SpecialistDefinitionModel.id.in_(specialist_ids),
                    SpecialistDefinitionModel.slug.in_(specialist_ids),
                )
            )
            .all()
        )

        comparison = []
        for s in specs:
            comparison.append({
                "id": s.id,
                "slug": s.slug,
                "name": s.name,
                "division": s.division,
                "department": s.department,
                "role": s.role,
                "description": s.description,
                "color": s.color,
                "emoji": s.emoji,
                "vibe": s.vibe,
                "permission_level": s.permission_level,
                "capabilities": s.capabilities or [],
                "skills": s.skills or [],
                "assigned_tools": s.assigned_tools or [],
                "deliverables": s.deliverables,
                "success_metrics": s.success_metrics,
                "lifecycle_state": s.lifecycle_state,
            })
        return comparison

    def _publish_event(
        self,
        db: Session,
        event_type: str,
        agent_id: Optional[str] = None,
        organization_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
    ):
        """
        Canonical persistent event pipeline:
        1. Persists event to database via event_service.
        2. Assigns authoritative sequence_id.
        3. Broadcasts full envelope via WebSocketManager.
        4. Guarantees event is recoverable via replay.
        """
        try:
            from backend.app.services.event_service import event_service
            ev = event_service.create_event(
                db=db,
                event_type=event_type,
                agent_id=agent_id,
                organization_id=organization_id,
                payload=payload or {},
                commit=True,
            )
            ws_manager.broadcast_sync(ev.to_envelope())
            return ev
        except Exception as e:
            logger.error(f"Failed to persist and publish event '{event_type}': {e}")
            return None

    def _broadcast_event(self, event_type: str, agent_id: str, payload: Dict[str, Any]):
        """
        Backward-compatible fallback routing through persistent event pipeline.
        """
        from backend.app.core.database import SessionLocal
        db = SessionLocal()
        try:
            org_id = payload.get("organization_id")
            self._publish_event(
                db=db,
                event_type=event_type,
                agent_id=agent_id,
                organization_id=org_id,
                payload=payload,
            )
        finally:
            db.close()

recruitment_service = RecruitmentService()
