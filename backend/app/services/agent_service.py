from datetime import datetime
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.schemas.agent import AgentCreate, AgentUpdate
from backend.app.core.errors import NotFoundError, ConflictError, ValidationError
from backend.app.services.event_service import event_service

from backend.app.models.recruitment import RecruitmentRecordModel

class AgentService:
    @staticmethod
    def list_agents(db: Session, organization_id: Optional[str] = None, limit: int = 50, offset: int = 0) -> List[AgentModel]:
        limit = min(max(1, limit), 100)
        offset = max(0, offset)
        if organization_id:
            recruited_ids = [
                r[0] for r in db.query(RecruitmentRecordModel.agent_id)
                .filter(RecruitmentRecordModel.organization_id == organization_id)
                .all()
            ]
            all_recruited = [
                r[0] for r in db.query(RecruitmentRecordModel.agent_id).all()
            ]
            return (
                db.query(AgentModel)
                .filter(
                    (AgentModel.organization_id == organization_id) |
                    (AgentModel.id.in_(recruited_ids)) |
                    ((AgentModel.organization_id.is_(None)) & (~AgentModel.id.in_(all_recruited)))
                )
                .order_by(AgentModel.created_at.asc())
                .offset(offset)
                .limit(limit)
                .all()
            )
        return db.query(AgentModel).order_by(AgentModel.created_at.asc()).offset(offset).limit(limit).all()

    @staticmethod
    def get_agent_by_id(db: Session, agent_id: str, organization_id: Optional[str] = None) -> AgentModel:
        agent = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
        if not agent:
            raise NotFoundError(message=f"Agent '{agent_id}' not found", code="AGENT_NOT_FOUND")
        if organization_id:
            if agent.organization_id and agent.organization_id != organization_id:
                raise NotFoundError(message=f"Agent '{agent_id}' not found", code="AGENT_NOT_FOUND")
            rec = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == agent_id).first()
            if rec and rec.organization_id != organization_id:
                raise NotFoundError(message=f"Agent '{agent_id}' not found", code="AGENT_NOT_FOUND")
        return agent

    @staticmethod
    def create_agent(db: Session, agent_in: AgentCreate) -> AgentModel:
        if not agent_in.name.strip():
            raise ValidationError(message="Agent name cannot be blank", code="EMPTY_AGENT_NAME")

        if agent_in.id:
            existing = db.query(AgentModel).filter(AgentModel.id == agent_in.id).first()
            if existing:
                raise ConflictError(message=f"Agent with ID '{agent_in.id}' already exists", code="AGENT_ALREADY_EXISTS")

        agent_data = agent_in.model_dump(exclude_unset=True)
        agent = AgentModel(**agent_data, status="idle")
        db.add(agent)

        event_service.create_event(
            db=db,
            event_type="agent.created",
            agent_id=agent.id,
            payload={"name": agent.name, "role": agent.role, "station": agent.station},
            commit=False
        )

        db.commit()
        db.refresh(agent)
        return agent

    @staticmethod
    def update_agent(db: Session, agent_id: str, agent_in: AgentUpdate, organization_id: Optional[str] = None) -> AgentModel:
        agent = AgentService.get_agent_by_id(db, agent_id, organization_id=organization_id)
        update_data = agent_in.model_dump(exclude_unset=True)

        for field, value in update_data.items():
            setattr(agent, field, value)

        agent.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(agent)
        return agent

    @staticmethod
    def get_agent_tasks(db: Session, agent_id: str, organization_id: Optional[str] = None, limit: int = 50, offset: int = 0) -> List[TaskModel]:
        # Validate agent exists and belongs to tenant
        AgentService.get_agent_by_id(db, agent_id, organization_id=organization_id)

        limit = min(max(1, limit), 100)
        offset = max(0, offset)
        query = db.query(TaskModel).filter(TaskModel.assigned_agent_id == agent_id)
        if organization_id:
            query = query.filter(TaskModel.organization_id == organization_id)
        return (
            query
            .order_by(desc(TaskModel.created_at))
            .offset(offset)
            .limit(limit)
            .all()
        )

    @staticmethod
    def get_agent_inspection(db: Session, agent_id: str, organization_id: str) -> dict:
        agent = AgentService.get_agent_by_id(db, agent_id=agent_id, organization_id=organization_id)

        from backend.app.models.workstation import WorkstationAllocationModel
        from backend.app.models.task_step import TaskStepModel
        from backend.app.models.approval import ApprovalModel
        from backend.app.models.agent_event import AgentEventModel
        from backend.app.schemas.workstation import WorkstationAllocationResponse
        from backend.app.schemas.task import TaskResponse
        from backend.app.schemas.approval import ApprovalResponse
        from backend.app.schemas.event import AgentEventResponse

        # 1. Workstation allocation
        allocation = (
            db.query(WorkstationAllocationModel)
            .filter(
                WorkstationAllocationModel.agent_id == agent.id,
                WorkstationAllocationModel.organization_id == organization_id,
            )
            .first()
        )
        workstation_resp = None
        department = agent.station or "Executive"
        if allocation:
            department = allocation.department
            workstation_resp = WorkstationAllocationResponse(
                id=allocation.id,
                organization_id=allocation.organization_id,
                agent_id=allocation.agent_id,
                department=allocation.department,
                logical_workstation_id=allocation.logical_workstation_id,
                office_zone=allocation.office_zone,
                desk_number=allocation.desk_number,
                pos_x=allocation.pos_x,
                pos_y=allocation.pos_y,
                pos_z=allocation.pos_z,
                allocation_status=allocation.allocation_status,
                is_virtual=allocation.is_virtual,
                agent_name=agent.name,
                agent_role=agent.role,
                agent_status=agent.status,
            )

        # 2. Current active task
        current_task = None
        current_task_steps_count = 0
        current_task_duration_seconds = None
        pending_approvals = []

        task = None
        if agent.current_task_id:
            task = (
                db.query(TaskModel)
                .filter(
                    TaskModel.id == agent.current_task_id,
                    TaskModel.organization_id == organization_id,
                )
                .first()
            )
        if not task:
            task = (
                db.query(TaskModel)
                .filter(
                    TaskModel.assigned_agent_id == agent.id,
                    TaskModel.organization_id == organization_id,
                    TaskModel.status.in_(["running", "in_progress", "waiting_approval", "waiting", "paused", "planning", "queued"]),
                )
                .order_by(desc(TaskModel.updated_at))
                .first()
            )

        if task:
            current_task = TaskResponse.model_validate(task)
            current_task_steps_count = (
                db.query(TaskStepModel).filter(TaskStepModel.task_id == task.id).count()
            )
            if task.started_at:
                now = datetime.utcnow()
                end_time = task.completed_at or now
                current_task_duration_seconds = round((end_time - task.started_at).total_seconds(), 1)

            approvals_raw = (
                db.query(ApprovalModel)
                .filter(
                    ApprovalModel.task_id == task.id,
                    ApprovalModel.status == "pending",
                )
                .all()
            )
            pending_approvals = [ApprovalResponse.model_validate(a) for a in approvals_raw]

        # 3. Determine authoritative runtime status:
        # IDLE, WORKING, THINKING, WAITING_APPROVAL, PAUSED, ERROR, OFFLINE
        if agent.status == "offline":
            runtime_status = "OFFLINE"
        elif agent.status == "error" or (task and task.status == "failed"):
            runtime_status = "ERROR"
        elif task and task.status == "paused":
            runtime_status = "PAUSED"
        elif (task and task.status in ("waiting_approval", "waiting")) or agent.status == "waiting_approval" or len(pending_approvals) > 0:
            runtime_status = "WAITING_APPROVAL"
        elif agent.behavioral_state == "THINKING":
            runtime_status = "THINKING"
        elif (task and task.status in ("running", "in_progress", "planning")) or agent.status == "working":
            runtime_status = "WORKING"
        else:
            runtime_status = "IDLE"

        is_available = (runtime_status == "IDLE")

        # 4. Recent activity history
        recent_events_raw = (
            db.query(AgentEventModel)
            .filter(
                (AgentEventModel.agent_id == agent.id) | (AgentEventModel.task_id == (task.id if task else "__none__")),
                AgentEventModel.organization_id == organization_id,
            )
            .order_by(desc(AgentEventModel.created_at))
            .limit(10)
            .all()
        )
        recent_events = [AgentEventResponse.model_validate(e) for e in recent_events_raw]

        return {
            "agent_id": agent.id,
            "name": agent.name,
            "role": agent.role,
            "department": department,
            "description": agent.description,
            "station": agent.station,
            "avatar": agent.avatar,
            "color": agent.color,
            "status": runtime_status,
            "behavioral_state": agent.behavioral_state,
            "is_available": is_available,
            "pos_x": agent.pos_x,
            "pos_y": agent.pos_y,
            "pos_z": agent.pos_z,
            "last_seen_at": agent.last_seen_at or agent.updated_at,
            "created_at": agent.created_at,
            "workstation": workstation_resp,
            "current_task": current_task,
            "current_task_steps_count": current_task_steps_count,
            "current_task_duration_seconds": current_task_duration_seconds,
            "pending_approvals": pending_approvals,
            "recent_events": recent_events,
        }

agent_service = AgentService()
