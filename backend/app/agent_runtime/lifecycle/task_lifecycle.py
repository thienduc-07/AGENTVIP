import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Union
from sqlalchemy.orm import Session

from backend.app.agent_runtime.contracts.deliverable_contract import StructuredDeliverable
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.services.event_service import event_service
from backend.app.websocket_manager import ws_manager

logger = logging.getLogger("grandline.runtime.lifecycle")


class TaskStatus(str, Enum):
    """
    Authoritative canonical task lifecycle states conforming to Phase 3.3.4 specifications.
    """
    CREATED = "created"
    PLANNING = "planning"
    READY = "ready"
    ASSIGNED = "assigned"
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    WAITING = "waiting"
    REVIEW = "review"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# Backward-compatibility alias map for existing code & tests
STATUS_ALIASES: Dict[str, TaskStatus] = {
    "running": TaskStatus.IN_PROGRESS,
    "waiting_approval": TaskStatus.WAITING,
    "pending": TaskStatus.READY,
    "created": TaskStatus.CREATED,
    "planning": TaskStatus.PLANNING,
    "ready": TaskStatus.READY,
    "assigned": TaskStatus.ASSIGNED,
    "queued": TaskStatus.QUEUED,
    "in_progress": TaskStatus.IN_PROGRESS,
    "waiting": TaskStatus.WAITING,
    "review": TaskStatus.REVIEW,
    "paused": TaskStatus.PAUSED,
    "completed": TaskStatus.COMPLETED,
    "failed": TaskStatus.FAILED,
    "cancelled": TaskStatus.CANCELLED,
}


def normalize_task_status(status_raw: Union[str, TaskStatus]) -> TaskStatus:
    """Normalizes any status string or enum to its canonical TaskStatus."""
    if isinstance(status_raw, TaskStatus):
        return status_raw
    cleaned = str(status_raw or "").strip().lower()
    if cleaned in STATUS_ALIASES:
        return STATUS_ALIASES[cleaned]
    try:
        return TaskStatus(cleaned)
    except ValueError:
        raise ValueError(f"Unrecognized task status '{status_raw}'. Valid states: {[s.value for s in TaskStatus]}")


ALLOWED_TRANSITIONS: Dict[TaskStatus, Set[TaskStatus]] = {
    TaskStatus.CREATED: {
        TaskStatus.PLANNING,
        TaskStatus.READY,
        TaskStatus.ASSIGNED,
        TaskStatus.QUEUED,
        TaskStatus.CANCELLED,
        TaskStatus.PAUSED,
    },
    TaskStatus.PLANNING: {
        TaskStatus.READY,
        TaskStatus.ASSIGNED,
        TaskStatus.QUEUED,
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
        TaskStatus.PAUSED,
    },
    TaskStatus.READY: {
        TaskStatus.ASSIGNED,
        TaskStatus.QUEUED,
        TaskStatus.IN_PROGRESS,
        TaskStatus.CANCELLED,
        TaskStatus.PAUSED,
    },
    TaskStatus.ASSIGNED: {
        TaskStatus.QUEUED,
        TaskStatus.IN_PROGRESS,
        TaskStatus.READY,
        TaskStatus.CANCELLED,
        TaskStatus.PAUSED,
    },
    TaskStatus.QUEUED: {
        TaskStatus.IN_PROGRESS,
        TaskStatus.WAITING,
        TaskStatus.ASSIGNED,
        TaskStatus.CANCELLED,
        TaskStatus.PAUSED,
    },
    TaskStatus.IN_PROGRESS: {
        TaskStatus.WAITING,
        TaskStatus.REVIEW,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
        TaskStatus.PAUSED,
    },
    TaskStatus.WAITING: {
        TaskStatus.IN_PROGRESS,
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
        TaskStatus.PAUSED,
    },
    TaskStatus.REVIEW: {
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.IN_PROGRESS,
        TaskStatus.CANCELLED,
        TaskStatus.PAUSED,
    },
    TaskStatus.PAUSED: {
        TaskStatus.QUEUED,
        TaskStatus.READY,
        TaskStatus.IN_PROGRESS,
        TaskStatus.CANCELLED,
    },
    TaskStatus.COMPLETED: set(),  # Terminal state
    TaskStatus.FAILED: {
        TaskStatus.QUEUED,
        TaskStatus.READY,  # Re-queue on bounded retry
    },
    TaskStatus.CANCELLED: set(),  # Terminal state
}


class InvalidTaskTransitionError(Exception):
    """Raised when an illegal state transition is requested."""
    pass


class DeliverableNotVerifiedError(Exception):
    """Raised when transitioning to COMPLETED without verified deliverable output."""
    pass


class TaskLifecycleEngine:
    """
    Authoritative state machine governing the lifecycle of corporate tasks and subtasks.
    Enforces validated transitions, physical deliverable verification, persistence,
    and event-driven WebSocket synchronization.
    """

    @staticmethod
    def is_transition_allowed(
        current_status: Union[str, TaskStatus],
        target_status: Union[str, TaskStatus],
    ) -> bool:
        cur = normalize_task_status(current_status)
        tgt = normalize_task_status(target_status)
        if cur == tgt:
            return True
        allowed = ALLOWED_TRANSITIONS.get(cur, set())
        return tgt in allowed

    @staticmethod
    def transition(
        db: Session,
        task: TaskModel,
        target_status: Union[str, TaskStatus],
        reason: Optional[str] = None,
        deliverable: Optional[StructuredDeliverable] = None,
        deliverable_verified: Optional[bool] = None,
        error_message: Optional[str] = None,
        result_summary: Optional[str] = None,
        output_data: Optional[Dict[str, Any]] = None,
        guidance: Optional[str] = None,
        commit: bool = True,
        broadcast: bool = True,
    ) -> TaskModel:
        """
        Executes a validated task state transition, updating timestamps, metadata,
        agent behavioral state, audit events, and WebSocket envelopes.
        """
        cur = normalize_task_status(task.status)
        tgt = normalize_task_status(target_status)

        if cur == tgt:
            # Idempotent no-op if status matches, still update result/deliverable if supplied
            if deliverable:
                output_dict = task.output_data_json or {}
                output_dict["deliverable"] = deliverable.to_dict()
                task.output_data_json = output_dict
            if commit:
                db.commit()
            return task

        allowed = ALLOWED_TRANSITIONS.get(cur, set())
        if tgt not in allowed:
            raise InvalidTaskTransitionError(
                f"Invalid task transition from '{cur.value}' to '{tgt.value}' for task '{task.id}'. "
                f"Permitted transitions from '{cur.value}': {sorted([s.value for s in allowed])}."
            )

        now = datetime.now(timezone.utc)
        task.updated_at = now

        # Strict deliverable verification requirement for COMPLETED state
        if tgt == TaskStatus.COMPLETED:
            is_verified = False
            if deliverable_verified is True:
                is_verified = True
            elif deliverable and deliverable.verification_status == "VERIFIED":
                # If transitioning from REVIEW, verified deliverable with non-empty summary is accepted
                if cur == TaskStatus.REVIEW and deliverable.result_summary and len(deliverable.result_summary.strip()) > 0:
                    is_verified = True
                # If completing directly from IN_PROGRESS or unreviewed states, physical evidence is required
                elif (
                    deliverable.result_summary
                    and (
                        len(deliverable.evidence_references) > 0
                        or len(deliverable.artifact_paths) > 0
                        or len(deliverable.tools_invoked) > 0
                    )
                ):
                    is_verified = True
            elif isinstance(task.output_data_json, dict):
                deliv_data = task.output_data_json.get("deliverable", {})
                if deliv_data.get("verification_status") == "VERIFIED" or task.output_data_json.get("verified") is True:
                    is_verified = True
                elif task.output_data_json.get("reviewer_verdict") in ("APPROVED", "COMPLETED"):
                    is_verified = True

            if not is_verified:
                raise DeliverableNotVerifiedError(
                    f"Task '{task.id}' cannot transition to COMPLETED without deliverable verification. "
                    "A verified deliverable contract with required evidence or reviewer approval must be provided."
                )

            task.completed_at = now
            if result_summary:
                task.result_summary = result_summary
            if deliverable:
                cur_output = task.output_data_json or {}
                cur_output["deliverable"] = deliverable.to_dict()
                task.output_data_json = cur_output

        elif tgt == TaskStatus.IN_PROGRESS:
            if not task.started_at:
                task.started_at = now

        elif tgt == TaskStatus.FAILED:
            task.completed_at = now
            task.error_message = error_message or reason or "Task execution failed."

        elif tgt == TaskStatus.CANCELLED:
            task.completed_at = now
            task.error_message = reason or "Task cancelled by cooperative user request."

        elif tgt == TaskStatus.PAUSED:
            cur_out = dict(task.output_data_json or {})
            cur_out["paused_at"] = now.isoformat()
            if reason:
                cur_out["pause_reason"] = reason
            task.output_data_json = cur_out

        if output_data:
            existing_out = task.output_data_json or {}
            existing_out.update(output_data)
            task.output_data_json = existing_out

        # Authoritatively apply new status
        old_status_val = task.status
        task.status = tgt.value

        # Manage agent release on terminal or paused states
        if tgt in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.PAUSED):
            from backend.app.services.behavioral_state_service import (
                behavioral_state_service,
                BehavioralState,
            )
            agent = db.query(AgentModel).filter(AgentModel.id == task.assigned_agent_id).first()
            if agent and agent.current_task_id == task.id:
                terminal_behavioral = (
                    BehavioralState.COMPLETED
                    if tgt == TaskStatus.COMPLETED
                    else (BehavioralState.ERROR if tgt == TaskStatus.FAILED else BehavioralState.IDLE)
                )
                behavioral_state_service.safe_release_agent(
                    db=db,
                    agent_id=agent.id,
                    organization_id=task.organization_id,
                    task_id=task.id,
                    terminal_state=terminal_behavioral,
                    reason=f"Task transitioned to {tgt.value}: {reason or ''}".strip(),
                    commit=False,
                    broadcast=broadcast,
                )

        # Emit audit event
        ev_payload = {
            "task_id": task.id,
            "previous_status": old_status_val,
            "new_status": tgt.value,
            "status": tgt.value,
            "reason": reason,
            "assigned_agent_id": task.assigned_agent_id,
            "organization_id": task.organization_id,
        }
        if guidance:
            ev_payload["guidance"] = guidance
        if deliverable:
            ev_payload["deliverable_id"] = deliverable.deliverable_id
            ev_payload["verification_status"] = deliverable.verification_status

        ev = event_service.create_event(
            db=db,
            event_type="task.status_changed",
            agent_id=task.assigned_agent_id,
            task_id=task.id,
            organization_id=task.organization_id,
            payload=ev_payload,
            commit=False,
        )

        # Emit specific lifecycle events alongside status_changed
        if tgt == TaskStatus.PAUSED:
            ev_paused = event_service.create_event(
                db=db,
                event_type="task.paused",
                agent_id=task.assigned_agent_id,
                task_id=task.id,
                organization_id=task.organization_id,
                payload=ev_payload,
                commit=False,
            )
            if broadcast:
                ws_manager.broadcast_sync(ev_paused.to_envelope())
        elif cur == TaskStatus.PAUSED and tgt in (TaskStatus.QUEUED, TaskStatus.READY, TaskStatus.IN_PROGRESS):
            ev_resumed = event_service.create_event(
                db=db,
                event_type="task.resumed",
                agent_id=task.assigned_agent_id,
                task_id=task.id,
                organization_id=task.organization_id,
                payload=ev_payload,
                commit=False,
            )
            if broadcast:
                ws_manager.broadcast_sync(ev_resumed.to_envelope())
        elif tgt == TaskStatus.CANCELLED:
            ev_cancelled = event_service.create_event(
                db=db,
                event_type="task.cancelled",
                agent_id=task.assigned_agent_id,
                task_id=task.id,
                organization_id=task.organization_id,
                payload=ev_payload,
                commit=False,
            )
            if broadcast:
                ws_manager.broadcast_sync(ev_cancelled.to_envelope())

        if commit:
            db.commit()
            db.refresh(task)

        if broadcast:
            ws_manager.broadcast_sync(ev.to_envelope())

        logger.info(f"Task '{task.id}' transitioned from '{old_status_val}' to '{tgt.value}' (reason='{reason}')")
        return task


task_lifecycle_engine = TaskLifecycleEngine()

