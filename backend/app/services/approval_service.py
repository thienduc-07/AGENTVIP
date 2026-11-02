import logging
from datetime import datetime
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
from backend.app.models.approval import ApprovalModel
from backend.app.models.task import TaskModel
from backend.app.models.agent import AgentModel
from backend.app.models.task_step import TaskStepModel
from backend.app.core.errors import NotFoundError, ConflictError
from backend.app.services.event_service import event_service
from backend.app.services.behavioral_state_service import behavioral_state_service, BehavioralState
from backend.app.agent_runtime.lifecycle.task_lifecycle import task_lifecycle_engine, TaskStatus
from backend.app.websocket_manager import ws_manager

logger = logging.getLogger("grandline.service.approval")


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
        # 1. Fetch approval with strict tenant ownership validation (via TaskModel join)
        approval = ApprovalService.get_approval_by_id(db, approval_id, organization_id=organization_id)

        # 2. Invariant: Approval must be currently pending
        if approval.status != "pending":
            raise ConflictError(
                message=f"Approval request '{approval_id}' is already {approval.status} and cannot be decided again",
                code="APPROVAL_ALREADY_RESOLVED"
            )

        # 3. Retrieve associated task
        task = db.query(TaskModel).filter(TaskModel.id == approval.task_id).first()
        if not task:
            raise NotFoundError(message=f"Task '{approval.task_id}' not found for approval '{approval_id}'", code="TASK_NOT_FOUND")

        # 4. Critical State Invariants on Task
        # - CANCELLED tasks must never be resurrected
        if task.status == "cancelled":
            raise ConflictError(
                message=f"Cannot decide approval for cancelled task '{task.id}'",
                code="TASK_ALREADY_CANCELLED"
            )
        # - COMPLETED tasks must never restart
        if task.status == "completed":
            raise ConflictError(
                message=f"Cannot decide approval for completed task '{task.id}'",
                code="TASK_ALREADY_COMPLETED"
            )

        now = datetime.utcnow()
        approval.status = decision  # "approved", "rejected", "expired", "cancelled"
        approval.resolved_at = now
        approval.decision_reason = reason

        # 5. Handle Decision Behaviors
        if decision == "approved":
            # Record approval context in task metadata
            out_meta = dict(task.output_data_json or {})
            approved_actions = out_meta.get("approved_actions", [])
            if approval.action_type not in approved_actions:
                approved_actions.append(approval.action_type)
            out_meta["approved_actions"] = approved_actions
            out_meta["last_approved_action"] = approval.action_type
            out_meta["last_approval_id"] = approval.id
            out_meta["last_approved_at"] = now.isoformat()
            task.output_data_json = out_meta
            task.updated_at = now

            # Record step in task step history
            max_step = (
                db.query(TaskStepModel)
                .filter(TaskStepModel.task_id == task.id)
                .order_by(TaskStepModel.step_index.desc())
                .first()
            )
            next_idx = (max_step.step_index + 1) if max_step else 1
            step = TaskStepModel(
                task_id=task.id,
                step_index=next_idx,
                title=f"Authorization Granted: {approval.action_type}",
                description=f"Action '{approval.action_type}' authorized by human operator: {reason or 'Approved'}",
                status="completed",
                started_at=now,
                completed_at=now,
            )
            db.add(step)

            # Invariant: PAUSED tasks must remain paused after approval
            if task.status == "paused":
                logger.info(f"Task '{task.id}' is paused; approval '{approval.id}' recorded but task remains paused.")
            elif task.status in ("waiting", "waiting_approval"):
                # Transition task from WAITING to QUEUED via TaskLifecycleEngine
                task_lifecycle_engine.transition(
                    db=db,
                    task=task,
                    target_status=TaskStatus.QUEUED,
                    reason=f"Action '{approval.action_type}' approved: {reason or 'Approved by operator'}",
                    commit=False,
                    broadcast=False,
                )
                # Free assigned agent to IDLE so agent is ready for dispatch claiming
                agent = db.query(AgentModel).filter(AgentModel.id == task.assigned_agent_id).first()
                if agent and agent.current_task_id == task.id:
                    agent.status = "idle" if agent.status != "offline" else "offline"
                    agent.behavioral_state = "IDLE"
                    agent.updated_at = now
                logger.info(f"Task '{task.id}' re-enqueued to 'queued' following approval '{approval.id}'.")

        elif decision == "rejected":
            # Prevent protected operation from executing; fail the task if it was waiting or in progress
            if task.status in ("waiting", "waiting_approval", "in_progress"):
                task_lifecycle_engine.transition(
                    db=db,
                    task=task,
                    target_status=TaskStatus.FAILED,
                    error_message=f"Action '{approval.action_type}' rejected by operator: {reason or 'No reason provided'}",
                    commit=False,
                    broadcast=False,
                )
            else:
                out_meta = dict(task.output_data_json or {})
                out_meta["rejected_action"] = approval.action_type
                out_meta["rejection_reason"] = reason
                task.output_data_json = out_meta
                task.updated_at = now

        elif decision == "cancelled":
            if task.status in ("waiting", "waiting_approval"):
                task_lifecycle_engine.transition(
                    db=db,
                    task=task,
                    target_status=TaskStatus.CANCELLED,
                    reason=f"Approval cancelled by operator: {reason or 'Cancelled'}",
                    commit=False,
                    broadcast=False,
                )

        elif decision == "expired":
            if task.status in ("waiting", "waiting_approval"):
                task_lifecycle_engine.transition(
                    db=db,
                    task=task,
                    target_status=TaskStatus.FAILED,
                    error_message=f"Approval request expired without response: {reason or 'Expired'}",
                    commit=False,
                    broadcast=False,
                )

        # 6. Audit Event Envelopes
        ev_decided = event_service.create_event(
            db=db,
            event_type="approval.decided",
            agent_id=task.assigned_agent_id if task else None,
            task_id=approval.task_id,
            organization_id=task.organization_id if task else None,
            payload={
                "approval_id": approval.id,
                "action_type": approval.action_type,
                "decision": decision,
                "reason": reason,
                "organization_id": task.organization_id if task else None,
            },
            commit=False
        )

        specific_ev_type = f"approval.{decision}"
        ev_specific = event_service.create_event(
            db=db,
            event_type=specific_ev_type if specific_ev_type in ("approval.approved", "approval.rejected") else "approval.resolved",
            agent_id=task.assigned_agent_id if task else None,
            task_id=approval.task_id,
            organization_id=task.organization_id if task else None,
            payload={
                "approval_id": approval.id,
                "action_type": approval.action_type,
                "decision": decision,
                "reason": reason,
                "organization_id": task.organization_id if task else None,
            },
            commit=False
        )

        # 7. Atomic Commit Before WebSocket Broadcast
        db.commit()
        db.refresh(approval)

        # 8. Post-Persistence Broadcast
        ws_manager.broadcast_sync(ev_decided.to_envelope())
        ws_manager.broadcast_sync(ev_specific.to_envelope())

        return approval


approval_service = ApprovalService()
