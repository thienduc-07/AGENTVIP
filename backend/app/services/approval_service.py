from datetime import datetime
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
from backend.app.models.approval import ApprovalModel
from backend.app.core.errors import NotFoundError, ConflictError
from backend.app.services.event_service import event_service

from backend.app.models.task import TaskModel

class ApprovalService:
    @staticmethod
    def list_approvals(
        db: Session,
        organization_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[ApprovalModel]:
        limit = min(max(1, limit), 100)
        offset = max(0, offset)

        query = db.query(ApprovalModel)
        if organization_id:
            query = query.join(TaskModel, ApprovalModel.task_id == TaskModel.id).filter(TaskModel.organization_id == organization_id)
        if status:
            query = query.filter(ApprovalModel.status == status)

        return query.order_by(desc(ApprovalModel.requested_at)).offset(offset).limit(limit).all()

    @staticmethod
    def get_approval_by_id(db: Session, approval_id: str, organization_id: Optional[str] = None) -> ApprovalModel:
        query = db.query(ApprovalModel).filter(ApprovalModel.id == approval_id)
        if organization_id:
            query = query.join(TaskModel, ApprovalModel.task_id == TaskModel.id).filter(TaskModel.organization_id == organization_id)
        approval = query.first()
        if not approval:
            raise NotFoundError(message=f"Approval request '{approval_id}' not found", code="APPROVAL_NOT_FOUND")
        return approval

    @staticmethod
    def decide_approval(
        db: Session,
        approval_id: str,
        decision: str,
        reason: Optional[str] = None,
        organization_id: Optional[str] = None
    ) -> ApprovalModel:
        approval = ApprovalService.get_approval_by_id(db, approval_id, organization_id=organization_id)

        if approval.status != "pending":
            raise ConflictError(
                message=f"Approval request is already {approval.status} and cannot be decided again",
                code="APPROVAL_ALREADY_RESOLVED"
            )

        approval.status = decision # "approved" or "rejected"
        approval.resolved_at = datetime.utcnow()
        approval.decision_reason = reason

        event_service.create_event(
            db=db,
            event_type="approval.decided",
            task_id=approval.task_id,
            payload={"approval_id": approval.id, "decision": decision, "reason": reason},
            commit=False
        )

        db.commit()
        db.refresh(approval)
        return approval

approval_service = ApprovalService()
