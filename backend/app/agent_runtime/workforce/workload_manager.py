import logging
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.agent_runtime.registry.agent_registry import default_agent_registry
from backend.app.models.agent import AgentModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.specialist import SpecialistDefinitionModel
from backend.app.models.task import TaskModel

logger = logging.getLogger("grandline.runtime.workforce")


class SpecialistWorkloadProfile(BaseModel):
    """Authoritative operational profile of an enterprise specialist employee."""
    agent_id: str
    name: str
    role: str
    division: str
    department: str
    skills: List[str] = Field(default_factory=list)
    tool_permissions: int = 0
    allowed_tools: List[str] = Field(default_factory=list)
    status: str
    behavioral_state: str
    lifecycle_state: str = "ACTIVE"
    active_task_count: int = 0
    is_available: bool = True
    completed_task_count: int = 0
    failed_task_count: int = 0
    success_rate: float = 1.0


class SpecialistWorkloadManager:
    """
    Manages specialist availability, workload distribution, and capability-aware task assignment.
    Guarantees tasks are only assigned to recruited active agents within the tenant organization.
    """

    def get_agent_workload(self, db: Session, agent_id: str, organization_id: str) -> SpecialistWorkloadProfile:
        agent = (
            db.query(AgentModel)
            .filter(AgentModel.id == agent_id, AgentModel.organization_id == organization_id)
            .first()
        )
        if not agent:
            raise ValueError(f"Agent '{agent_id}' does not exist in organization '{organization_id}'")

        # Query active task count
        active_count = (
            db.query(func.count(TaskModel.id))
            .filter(
                TaskModel.assigned_agent_id == agent_id,
                TaskModel.organization_id == organization_id,
                TaskModel.status.in_(["queued", "planning", "running", "in_progress", "waiting", "waiting_approval"]),
            )
            .scalar()
            or 0
        )

        completed_count = (
            db.query(func.count(TaskModel.id))
            .filter(
                TaskModel.assigned_agent_id == agent_id,
                TaskModel.organization_id == organization_id,
                TaskModel.status == "completed",
            )
            .scalar()
            or 0
        )

        failed_count = (
            db.query(func.count(TaskModel.id))
            .filter(
                TaskModel.assigned_agent_id == agent_id,
                TaskModel.organization_id == organization_id,
                TaskModel.status == "failed",
            )
            .scalar()
            or 0
        )

        total_done = completed_count + failed_count
        success_rate = (completed_count / total_done) if total_done > 0 else 1.0

        # Resolve specialist definition & recruitment profile
        rec = (
            db.query(RecruitmentRecordModel)
            .filter(
                RecruitmentRecordModel.agent_id == agent_id,
                RecruitmentRecordModel.organization_id == organization_id,
            )
            .first()
        )

        division = "General"
        department = "Operations"
        skills: List[str] = []
        allowed_tools: List[str] = []
        permission_level = 0
        lifecycle_state = rec.lifecycle_state if rec else "ACTIVE"

        if rec and rec.specialist_definition:
            spec: SpecialistDefinitionModel = rec.specialist_definition
            division = spec.division or division
            department = spec.department or department
            skills = list(spec.skills or [])
            allowed_tools = list(spec.assigned_tools or spec.declared_tools or [])
            permission_level = spec.permission_level
        else:
            # Fall back to AgentRegistry definition if core agent
            agent_def = default_agent_registry.resolve_agent_def(agent.id)
            if agent_def:
                division = getattr(agent_def, "division", "Executive")
                department = getattr(agent_def, "department", "Operations")
                skills = getattr(agent_def, "skills", [])
                allowed_tools = list(agent_def.allowed_tools or [])
                permission_level = (
                    agent_def.permission_level.value
                    if hasattr(agent_def.permission_level, "value")
                    else int(agent_def.permission_level or 0)
                )

        is_available = (
            lifecycle_state == "ACTIVE"
            and agent.status != "offline"
            and active_count < 3  # Max 3 concurrent tasks per specialist
        )

        return SpecialistWorkloadProfile(
            agent_id=agent.id,
            name=agent.name,
            role=agent.role,
            division=division,
            department=department,
            skills=skills,
            tool_permissions=permission_level,
            allowed_tools=allowed_tools,
            status=agent.status,
            behavioral_state=agent.behavioral_state,
            lifecycle_state=lifecycle_state,
            active_task_count=active_count,
            is_available=is_available,
            completed_task_count=completed_count,
            failed_task_count=failed_count,
            success_rate=round(success_rate, 4),
        )

    def list_workforce_profiles(self, db: Session, organization_id: str) -> List[SpecialistWorkloadProfile]:
        """Lists workload profiles for all recruited active agents in the tenant organization."""
        agents = db.query(AgentModel).filter(AgentModel.organization_id == organization_id).all()
        profiles: List[SpecialistWorkloadProfile] = []
        for ag in agents:
            try:
                prof = self.get_agent_workload(db, ag.id, organization_id)
                profiles.append(prof)
            except Exception as err:
                logger.debug(f"Could not build profile for agent '{ag.id}': {err}")
        return profiles

    def find_best_specialist(
        self,
        db: Session,
        organization_id: str,
        required_agent_type: Optional[str] = None,
        required_skills: Optional[List[str]] = None,
        required_tools: Optional[List[str]] = None,
        required_permission_level: int = 0,
        preferred_agent_id: Optional[str] = None,
    ) -> Optional[AgentModel]:
        """
        Dynamically selects the optimal recruited specialist for a task based on
        tool permissions, capability matching, current workload, and availability.
        """
        all_profiles = self.list_workforce_profiles(db, organization_id)
        if not all_profiles:
            # Fall back to any agent in the organization if none profiled
            return db.query(AgentModel).filter(AgentModel.organization_id == organization_id).first()

        # 1. Filter candidates by active lifecycle and permission level
        candidates = [
            p for p in all_profiles
            if p.lifecycle_state == "ACTIVE"
            and p.status != "offline"
            and p.tool_permissions >= required_permission_level
        ]

        if not candidates:
            # Re-widen search without permission requirement if no strict match
            candidates = [p for p in all_profiles if p.lifecycle_state == "ACTIVE" and p.status != "offline"]

        if not candidates:
            return None

        # 2. Score candidates
        def score_candidate(p: SpecialistWorkloadProfile) -> float:
            score = 100.0

            # Match preferred physical agent if specified
            if preferred_agent_id and p.agent_id == preferred_agent_id:
                score += 50.0

            # Match agent_type (e.g., 'research', 'analyst', 'writer', 'reviewer')
            if required_agent_type:
                atype = required_agent_type.lower()
                role_lower = p.role.lower()
                name_lower = p.name.lower()
                div_lower = p.division.lower()
                dept_lower = p.department.lower()
                id_lower = p.agent_id.lower()

                if atype in id_lower or atype in role_lower:
                    score += 40.0
                elif atype in name_lower or atype in div_lower or atype in dept_lower:
                    score += 20.0

            # Match skills
            if required_skills:
                matching_skills = sum(1 for s in required_skills if any(s.lower() in sk.lower() for sk in p.skills))
                score += matching_skills * 10.0

            # Match tools
            if required_tools:
                matching_tools = sum(
                    1 for t in required_tools
                    if t in p.allowed_tools or t.replace(".", "_") in p.allowed_tools or t.replace("_", ".") in p.allowed_tools
                )
                score += matching_tools * 5.0

            # Penalize heavy active workloads
            score -= (p.active_task_count * 15.0)

            # Bonus for currently IDLE agents
            if p.status == "idle" and p.behavioral_state == "IDLE":
                score += 15.0

            # Historical reliability factor
            score += (p.success_rate * 10.0)

            return score

        candidates.sort(key=score_candidate, reverse=True)
        best_profile = candidates[0]
        logger.info(
            f"Assigned specialist '{best_profile.agent_id}' ({best_profile.role}) "
            f"for requirement='{required_agent_type}' (active_workload={best_profile.active_task_count})"
        )
        return db.query(AgentModel).filter(AgentModel.id == best_profile.agent_id).first()


specialist_workload_manager = SpecialistWorkloadManager()

