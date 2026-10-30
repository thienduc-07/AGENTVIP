import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session

from backend.app.models.task import TaskModel
from backend.app.models.agent import AgentModel
from backend.app.schemas.workflow import WorkflowCreate
from backend.app.core.errors import NotFoundError, ValidationError, ConflictError
from backend.app.services.event_service import event_service, WORKFLOW_CREATED, WORKFLOW_FAILED
from backend.app.websocket_manager import ws_manager

logger = logging.getLogger("grandline.services.workflow")

class WorkflowService:
    @staticmethod
    def create_workflow(db: Session, workflow_in: WorkflowCreate) -> Dict[str, Any]:
        if not workflow_in.title.strip():
            raise ValidationError(message="Workflow title cannot be blank", code="EMPTY_TITLE")
        if len(workflow_in.title) > 120:
            raise ValidationError(message="Workflow title cannot exceed 120 characters", code="TITLE_TOO_LONG")

        # Verify assigned agent exists
        agent = db.query(AgentModel).filter(AgentModel.id == workflow_in.assigned_agent_id).first()
        if not agent:
            # Fallback to CEO or first agent
            agent = db.query(AgentModel).filter(AgentModel.id == "agent-exec-ceo").first() or db.query(AgentModel).first()
            if not agent:
                raise NotFoundError(message=f"Agent '{workflow_in.assigned_agent_id}' not found", code="AGENT_NOT_FOUND")

        workflow_task = TaskModel(
            title=workflow_in.title.strip(),
            description=workflow_in.description.strip(),
            task_type="workflow",
            status="queued",
            priority=workflow_in.priority or "normal",
            assigned_agent_id=agent.id,
            created_at=datetime.utcnow(),
        )
        db.add(workflow_task)
        db.flush()

        # Persist event
        ev = event_service.create_event(
            db=db,
            event_type=WORKFLOW_CREATED,
            agent_id=agent.id,
            task_id=workflow_task.id,
            payload={
                "workflow_id": workflow_task.id,
                "title": workflow_task.title,
                "status": "queued",
                "priority": workflow_task.priority,
            },
            commit=False
        )
        db.commit()
        db.refresh(workflow_task)

        # Broadcast event envelope
        ws_manager.broadcast_sync(ev.to_envelope())
        logger.info(f"Created Multi-Agent Workflow '{workflow_task.id}': {workflow_task.title}")
        return workflow_task.to_workflow_dict()

    @staticmethod
    def get_workflow(db: Session, workflow_id: str) -> Dict[str, Any]:
        wf = (
            db.query(TaskModel)
            .filter(TaskModel.id == workflow_id, TaskModel.task_type == "workflow")
            .first()
        )
        if not wf:
            raise NotFoundError(message=f"Workflow '{workflow_id}' not found", code="WORKFLOW_NOT_FOUND")
        return wf.to_workflow_dict()

    @staticmethod
    def list_workflows(
        db: Session,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        query = db.query(TaskModel).filter(TaskModel.task_type == "workflow")
        if status:
            query = query.filter(TaskModel.status == status)
        records = query.order_by(TaskModel.created_at.desc()).offset(offset).limit(limit).all()
        return [r.to_workflow_dict() for r in records]

    @staticmethod
    def cancel_workflow(db: Session, workflow_id: str) -> Dict[str, Any]:
        wf = (
            db.query(TaskModel)
            .filter(TaskModel.id == workflow_id, TaskModel.task_type == "workflow")
            .first()
        )
        if not wf:
            raise NotFoundError(message=f"Workflow '{workflow_id}' not found", code="WORKFLOW_NOT_FOUND")

        if wf.status in ["completed", "failed", "cancelled"]:
            raise ConflictError(message=f"Workflow is already {wf.status}", code="WORKFLOW_ALREADY_TERMINATED")

        wf.status = "cancelled"
        wf.error_message = "Workflow cancelled by user request"
        wf.completed_at = datetime.utcnow()

        # Cancel active/queued subtasks
        for st in wf.subtasks:
            if st.status in ["pending", "queued", "running"]:
                st.status = "cancelled"
                st.completed_at = datetime.utcnow()

        db.commit()
        return wf.to_workflow_dict()

workflow_service = WorkflowService()
