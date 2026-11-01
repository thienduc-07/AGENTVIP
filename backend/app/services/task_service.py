from datetime import datetime
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel, generate_uuid
from backend.app.models.task_step import TaskStepModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.schemas.task import TaskCreate, TaskCancelResponse
from backend.app.core.errors import NotFoundError, ConflictError, ValidationError
from backend.app.services.event_service import event_service

from backend.app.websocket_manager import ws_manager

class TaskService:
    @staticmethod
    def create_task(db: Session, task_in: TaskCreate, organization_id: Optional[str] = None) -> TaskModel:
        # Idempotency check: If client provided an explicit task ID / idempotency identity, return existing record
        target_id = task_in.id.strip() if (task_in.id and task_in.id.strip()) else None
        if target_id:
            existing = db.query(TaskModel).filter(
                TaskModel.id == target_id,
            ).first()
            if existing:
                # If belongs to same tenant, return idempotently
                if not organization_id or existing.organization_id == organization_id:
                    return existing
                else:
                    raise ValidationError(
                        message=f"Task ID '{target_id}' belongs to another organization",
                        code="CROSS_TENANT_TASK_ID"
                    )

        # 1. Verify assigned agent exists and is active
        agent = db.query(AgentModel).filter(AgentModel.id == task_in.assigned_agent_id).first()
        if not agent:
            raise NotFoundError(
                message=f"Agent '{task_in.assigned_agent_id}' does not exist",
                code="AGENT_NOT_FOUND"
            )

        from backend.app.models.recruitment import RecruitmentRecordModel
        rec = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == agent.id).first()
        agent_org = rec.organization_id if rec else getattr(agent, "organization_id", None)
        if organization_id and agent_org and agent_org != organization_id:
            raise ValidationError(
                message=f"Cross-tenant assignment denied: Agent '{agent.id}' does not belong to tenant '{organization_id}' (belongs to '{agent_org}')",
                code="CROSS_TENANT_AGENT_ASSIGNMENT"
            )
        effective_org = organization_id or agent_org or "org_default_company"
        # Ensure organization record exists to satisfy foreign key integrity
        from backend.app.models.auth import OrganizationModel
        org_rec = db.query(OrganizationModel).filter(OrganizationModel.id == effective_org).first()
        if not org_rec:
            org_rec = OrganizationModel(
                id=effective_org,
                name=effective_org,
                slug=effective_org.lower().replace("_", "-"),
                is_active=True
            )
            db.add(org_rec)
            db.flush()

        if rec:
            if getattr(rec, "is_legacy_unpinned", False):
                raise ValidationError(
                    message=f"Agent '{agent.id}' has an unpinned legacy version. Task assignment is blocked pending administrative review.",
                    code="LEGACY_VERSION_UNPINNED"
                )
            if rec.lifecycle_state in ["SUSPENDED", "RETIRED", "CONFIGURED"]:
                raise ValidationError(
                    message=f"Agent '{agent.id}' is in lifecycle state '{rec.lifecycle_state}' and cannot accept tasks.",
                    code="AGENT_LIFECYCLE_INACTIVE"
                )
        elif agent.status == "offline":
            raise ValidationError(
                message=f"Agent '{agent.id}' is offline and cannot accept tasks.",
                code="AGENT_OFFLINE"
            )

        if not task_in.title.strip():
            raise ValidationError(message="Task title cannot be blank", code="EMPTY_TASK_TITLE")

        if not task_in.description.strip():
            raise ValidationError(message="Task description cannot be blank", code="EMPTY_TASK_DESC")

        # 2. Create task record with tenant-scoped organization_id and canonical task ID
        task = TaskModel(
            id=target_id or generate_uuid(),
            organization_id=effective_org,
            title=task_in.title.strip(),
            description=task_in.description.strip(),
            assigned_agent_id=task_in.assigned_agent_id,
            priority=task_in.priority,
            status="queued"
        )

        db.add(task)
        db.flush() # Flush to generate task.id

        # 3. Create initial step 1
        initial_step = TaskStepModel(
            task_id=task.id,
            step_index=1,
            title="Task queued for execution",
            description="Mission registered and queued in Grand Line Command backlog",
            status="pending"
        )
        db.add(initial_step)

        # 4. Log event in same transaction
        ev = event_service.create_event(
            db=db,
            event_type="task.created",
            agent_id=task.assigned_agent_id,
            task_id=task.id,
            payload={
                "title": task.title,
                "priority": task.priority,
                "assigned_agent_id": task.assigned_agent_id,
                "organization_id": task.organization_id,
            },
            commit=False
        )

        db.commit()
        db.refresh(task)

        # 5. Broadcast authoritative event envelope to WebSocket clients
        ws_manager.broadcast_sync(ev.to_envelope())

        return task

    @staticmethod
    def list_tasks(
        db: Session,
        organization_id: Optional[str] = None,
        status: Optional[str] = None,
        agent_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[TaskModel]:
        limit = min(max(1, limit), 100)
        offset = max(0, offset)

        query = db.query(TaskModel)
        if organization_id:
            query = query.filter(TaskModel.organization_id == organization_id)
        if status:
            query = query.filter(TaskModel.status == status)
        if agent_id:
            query = query.filter(TaskModel.assigned_agent_id == agent_id)

        return query.order_by(desc(TaskModel.created_at)).offset(offset).limit(limit).all()

    @staticmethod
    def get_task_by_id(db: Session, task_id: str, organization_id: Optional[str] = None) -> TaskModel:
        query = db.query(TaskModel).filter(TaskModel.id == task_id)
        if organization_id:
            query = query.filter(TaskModel.organization_id == organization_id)
        task = query.first()
        if not task:
            raise NotFoundError(message=f"Task '{task_id}' not found", code="TASK_NOT_FOUND")
        return task

    @staticmethod
    def get_task_steps(db: Session, task_id: str, organization_id: Optional[str] = None) -> List[TaskStepModel]:
        # Validate task exists and belongs to tenant
        TaskService.get_task_by_id(db, task_id, organization_id=organization_id)
        return (
            db.query(TaskStepModel)
            .filter(TaskStepModel.task_id == task_id)
            .order_by(TaskStepModel.step_index.asc())
            .all()
        )

    @staticmethod
    def cancel_task(db: Session, task_id: str, organization_id: Optional[str] = None) -> TaskCancelResponse:
        task = TaskService.get_task_by_id(db, task_id, organization_id=organization_id)

        if task.status == "completed":
            raise ConflictError(
                message="Cannot cancel an already completed task",
                code="TASK_ALREADY_COMPLETED"
            )

        if task.status == "cancelled":
            raise ConflictError(
                message="Task is already cancelled",
                code="TASK_ALREADY_CANCELLED"
            )

        task.status = "cancelled"
        task.updated_at = datetime.utcnow()

        # Free assigned agent if this was their active task
        agent = db.query(AgentModel).filter(AgentModel.id == task.assigned_agent_id).first()
        if agent and agent.current_task_id == task.id:
            agent.status = "idle"
            agent.current_task_id = None
            agent.updated_at = datetime.utcnow()

        # Signal runtime cooperative cancellation if actively processing
        try:
            from backend.app.agent_runtime import agent_runtime
            agent_runtime.cancel_task(task.id)
        except Exception:
            pass

        ev = event_service.create_event(
            db=db,
            event_type="task.cancelled",
            agent_id=task.assigned_agent_id,
            task_id=task.id,
            payload={"reason": "User requested task cancellation", "organization_id": task.organization_id},
            commit=False
        )

        db.commit()

        # Broadcast event envelope
        ws_manager.broadcast_sync(ev.to_envelope())

        return TaskCancelResponse(
            id=task.id,
            status=task.status,
            message="Task was successfully cancelled"
        )

    @staticmethod
    def get_task_events(db: Session, task_id: str, organization_id: Optional[str] = None) -> List[AgentEventModel]:
        TaskService.get_task_by_id(db, task_id, organization_id=organization_id)
        return (
            db.query(AgentEventModel)
            .filter(AgentEventModel.task_id == task_id)
            .order_by(AgentEventModel.created_at.asc())
            .all()
        )

task_service = TaskService()
