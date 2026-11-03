import uuid
import threading
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Set
from sqlalchemy.orm import Session
from sqlalchemy import func, desc

from backend.app.core.database import commit_with_retry
from backend.app.models.agent_event import AgentEventModel
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel

# Standardized Event Types conforming to Milestone 5 Specification
TASK_CREATED = "task.created"
TASK_QUEUED = "task.queued"
TASK_STARTED = "task.started"
TASK_STATUS_CHANGED = "task.status_changed"
TASK_COMPLETED = "task.completed"
TASK_FAILED = "task.failed"
TASK_CANCEL_REQUESTED = "task.cancel_requested"
TASK_CANCELLED = "task.cancelled"
TASK_PAUSED = "task.paused"
TASK_RESUMED = "task.resumed"

AGENT_STATUS_CHANGED = "agent.status_changed"
AGENT_IDLE = "agent.idle"
AGENT_WORKING = "agent.working"
AGENT_WAITING_FOR_APPROVAL = "agent.waiting_for_approval"
AGENT_ERROR = "agent.error"

TASK_STEP_STARTED = "task.step.started"
TASK_STEP_COMPLETED = "task.step.completed"
TASK_STEP_FAILED = "task.step.failed"

TOOL_EXECUTION_STARTED = "tool.execution_started"
TOOL_EXECUTION_COMPLETED = "tool.execution_completed"
TOOL_EXECUTION_FAILED = "tool.execution_failed"

APPROVAL_REQUIRED = "approval.required"
APPROVAL_RESOLVED = "approval.resolved"
APPROVAL_DECIDED = "approval.decided"
APPROVAL_APPROVED = "approval.approved"
APPROVAL_REJECTED = "approval.rejected"
ARTIFACT_CREATED = "artifact.created"

# Milestone 6: Multi-Agent Workflow & Subtask Lifecycle Events
WORKFLOW_CREATED = "workflow.created"
WORKFLOW_PLANNED = "workflow.planned"
WORKFLOW_STARTED = "workflow.started"
WORKFLOW_COMPLETED = "workflow.completed"
WORKFLOW_FAILED = "workflow.failed"

SUBTASK_CREATED = "subtask.created"
SUBTASK_ASSIGNED = "subtask.assigned"
SUBTASK_STARTED = "subtask.started"
SUBTASK_COMPLETED = "subtask.completed"
SUBTASK_FAILED = "subtask.failed"

AGENT_DELEGATED = "agent.delegated"
AGENT_RESULT_RECEIVED = "agent.result_received"
WORKFLOW_REVIEW_STARTED = "workflow.review_started"
WORKFLOW_REVIEW_COMPLETED = "workflow.review_completed"

# Milestone 7: Persistent Memory & Knowledge Events
MEMORY_CANDIDATE_CREATED = "memory.candidate_created"
MEMORY_CREATED = "memory.created"
MEMORY_UPDATED = "memory.updated"
MEMORY_ARCHIVED = "memory.archived"
MEMORY_EXPIRED = "memory.expired"
MEMORY_DELETED = "memory.deleted"
MEMORY_RETRIEVAL_COMPLETED = "memory.retrieval_completed"

# Phase 3.3.2: Workforce Lifecycle, Task Assignment & Spatial Workstation Events
AGENT_RECRUITED = "agent.recruited"
AGENT_LIFECYCLE_CHANGED = "agent.lifecycle_changed"
AGENT_ACTIVATED = "agent.activated"
AGENT_SUSPENDED = "agent.suspended"
AGENT_OFFBOARDED = "agent.offboarded"

TASK_ASSIGNED = "task.assigned"
WORKSTATION_ALLOCATED = "workstation.allocated"
WORKSTATION_REASSIGNED = "workstation.reassigned"

# Phase 3.3.3: Autonomous Agent Behavior, Spatial Navigation & CEO Supervisory Heartbeat Events
AGENT_BEHAVIORAL_STATE_CHANGED = "agent.behavioral_state_changed"
AGENT_MOVEMENT_STARTED = "agent.movement_started"
AGENT_MOVEMENT_PROGRESS = "agent.movement_progress"
AGENT_MOVEMENT_COMPLETED = "agent.movement_completed"
AGENT_MOVEMENT_INTERRUPTED = "agent.movement_interrupted"
CEO_HEARTBEAT_STARTED = "ceo.heartbeat_started"
CEO_HEARTBEAT_COMPLETED = "ceo.heartbeat_completed"
CEO_HEARTBEAT_FAILED = "ceo.heartbeat_failed"

# Phase 3.3.4: Autonomous Workforce Operationalization & Deliverable Verification Events
TASK_WAITING = "task.waiting"
TASK_RETRYING = "task.retrying"
TASK_INTERRUPTED = "task.interrupted"
SPECIALIST_ASSIGNED = "specialist.assigned"
SPECIALIST_RELEASED = "specialist.released"
DELIVERABLE_SUBMITTED = "deliverable.submitted"
DELIVERABLE_VERIFIED = "deliverable.verified"
CEO_REVIEW_COMPLETED = "ceo.review_completed"

# Phase 4.3.4: Multi-Agent Meeting Subsystem Events
MEETING_CREATED = "meeting.created"
MEETING_INITIALIZING = "meeting.initializing"
MEETING_STARTED = "meeting.started"
MEETING_PAUSED = "meeting.paused"
MEETING_RESUMED = "meeting.resumed"
MEETING_CANCELLED = "meeting.cancelled"
MEETING_COMPLETED = "meeting.completed"
MEETING_FAILED = "meeting.failed"
MEETING_PARTICIPANT_JOINED = "meeting.participant_joined"
MEETING_PARTICIPANT_LEFT = "meeting.participant_left"
MEETING_PARTICIPANT_STATUS_CHANGED = "meeting.participant_status_changed"
MEETING_TURN_STARTED = "meeting.turn_started"
MEETING_TURN_COMPLETED = "meeting.turn_completed"
MEETING_MESSAGE_CREATED = "meeting.message_created"
MEETING_DECISION_PROPOSED = "meeting.decision_proposed"
MEETING_VOTE_SUBMITTED = "meeting.vote_submitted"
MEETING_DECISION_RESOLVED = "meeting.decision_resolved"
MEETING_ACTION_ITEM_CREATED = "meeting.action_item_created"
MEETING_SUMMARY_GENERATED = "meeting.summary_generated"

# Phase 4.3.6: Live Terminal & Workstation Execution Events
EXECUTION_STARTED = "execution.started"
EXECUTION_PROGRESS = "execution.progress"
EXECUTION_COMPLETED = "execution.completed"
EXECUTION_FAILED = "execution.failed"
EXECUTION_CANCELLED = "execution.cancelled"
TERMINAL_OUTPUT = "terminal.output"
TERMINAL_ERROR = "terminal.error"
FILE_OPERATION = "file.operation"
TOOL_CALL_STARTED = TOOL_EXECUTION_STARTED
TOOL_CALL_COMPLETED = TOOL_EXECUTION_COMPLETED
TOOL_CALL_FAILED = TOOL_EXECUTION_FAILED

VALID_EVENT_TYPES: Set[str] = {
    TASK_CREATED,
    TASK_QUEUED,
    TASK_STARTED,
    TASK_STATUS_CHANGED,
    TASK_COMPLETED,
    TASK_FAILED,
    TASK_CANCEL_REQUESTED,
    TASK_CANCELLED,
    TASK_PAUSED,
    TASK_RESUMED,
    TASK_ASSIGNED,
    TASK_WAITING,
    TASK_RETRYING,
    TASK_INTERRUPTED,
    SPECIALIST_ASSIGNED,
    SPECIALIST_RELEASED,
    DELIVERABLE_SUBMITTED,
    DELIVERABLE_VERIFIED,
    CEO_REVIEW_COMPLETED,
    AGENT_STATUS_CHANGED,
    AGENT_BEHAVIORAL_STATE_CHANGED,
    AGENT_IDLE,
    AGENT_WORKING,
    AGENT_WAITING_FOR_APPROVAL,
    AGENT_ERROR,
    AGENT_RECRUITED,
    AGENT_LIFECYCLE_CHANGED,
    AGENT_ACTIVATED,
    AGENT_SUSPENDED,
    AGENT_OFFBOARDED,
    AGENT_MOVEMENT_STARTED,
    AGENT_MOVEMENT_PROGRESS,
    AGENT_MOVEMENT_COMPLETED,
    AGENT_MOVEMENT_INTERRUPTED,
    WORKSTATION_ALLOCATED,
    WORKSTATION_REASSIGNED,
    CEO_HEARTBEAT_STARTED,
    CEO_HEARTBEAT_COMPLETED,
    CEO_HEARTBEAT_FAILED,
    TASK_STEP_STARTED,
    TASK_STEP_COMPLETED,
    TASK_STEP_FAILED,
    TOOL_EXECUTION_STARTED,
    TOOL_EXECUTION_COMPLETED,
    TOOL_EXECUTION_FAILED,
    APPROVAL_REQUIRED,
    APPROVAL_RESOLVED,
    APPROVAL_DECIDED,
    APPROVAL_APPROVED,
    APPROVAL_REJECTED,
    ARTIFACT_CREATED,
    WORKFLOW_CREATED,
    WORKFLOW_PLANNED,
    WORKFLOW_STARTED,
    WORKFLOW_COMPLETED,
    WORKFLOW_FAILED,
    SUBTASK_CREATED,
    SUBTASK_ASSIGNED,
    SUBTASK_STARTED,
    SUBTASK_COMPLETED,
    SUBTASK_FAILED,
    AGENT_DELEGATED,
    AGENT_RESULT_RECEIVED,
    WORKFLOW_REVIEW_STARTED,
    WORKFLOW_REVIEW_COMPLETED,
    MEMORY_CANDIDATE_CREATED,
    MEMORY_CREATED,
    MEMORY_UPDATED,
    MEMORY_ARCHIVED,
    MEMORY_EXPIRED,
    MEMORY_DELETED,
    MEMORY_RETRIEVAL_COMPLETED,
    MEETING_CREATED,
    MEETING_INITIALIZING,
    MEETING_STARTED,
    MEETING_PAUSED,
    MEETING_RESUMED,
    MEETING_CANCELLED,
    MEETING_COMPLETED,
    MEETING_FAILED,
    MEETING_PARTICIPANT_JOINED,
    MEETING_PARTICIPANT_LEFT,
    MEETING_PARTICIPANT_STATUS_CHANGED,
    MEETING_TURN_STARTED,
    MEETING_TURN_COMPLETED,
    MEETING_MESSAGE_CREATED,
    MEETING_DECISION_PROPOSED,
    MEETING_VOTE_SUBMITTED,
    MEETING_DECISION_RESOLVED,
    MEETING_ACTION_ITEM_CREATED,
    MEETING_SUMMARY_GENERATED,
    EXECUTION_STARTED,
    EXECUTION_PROGRESS,
    EXECUTION_COMPLETED,
    EXECUTION_FAILED,
    EXECUTION_CANCELLED,
    TERMINAL_OUTPUT,
    TERMINAL_ERROR,
    FILE_OPERATION,
}

class EventService:
    EXECUTION_STARTED = EXECUTION_STARTED
    EXECUTION_PROGRESS = EXECUTION_PROGRESS
    EXECUTION_COMPLETED = EXECUTION_COMPLETED
    EXECUTION_FAILED = EXECUTION_FAILED
    EXECUTION_CANCELLED = EXECUTION_CANCELLED
    TERMINAL_OUTPUT = TERMINAL_OUTPUT
    TERMINAL_ERROR = TERMINAL_ERROR
    FILE_OPERATION = FILE_OPERATION
    TOOL_CALL_STARTED = TOOL_CALL_STARTED
    TOOL_CALL_COMPLETED = TOOL_CALL_COMPLETED
    TOOL_CALL_FAILED = TOOL_CALL_FAILED

    MEETING_CREATED = MEETING_CREATED
    MEETING_INITIALIZING = MEETING_INITIALIZING
    MEETING_STARTED = MEETING_STARTED
    MEETING_PAUSED = MEETING_PAUSED
    MEETING_RESUMED = MEETING_RESUMED
    MEETING_CANCELLED = MEETING_CANCELLED
    MEETING_COMPLETED = MEETING_COMPLETED
    MEETING_FAILED = MEETING_FAILED
    MEETING_PARTICIPANT_JOINED = MEETING_PARTICIPANT_JOINED
    MEETING_PARTICIPANT_LEFT = MEETING_PARTICIPANT_LEFT
    MEETING_PARTICIPANT_STATUS_CHANGED = MEETING_PARTICIPANT_STATUS_CHANGED
    MEETING_TURN_STARTED = MEETING_TURN_STARTED
    MEETING_TURN_COMPLETED = MEETING_TURN_COMPLETED
    MEETING_MESSAGE_CREATED = MEETING_MESSAGE_CREATED
    MEETING_DECISION_PROPOSED = MEETING_DECISION_PROPOSED
    MEETING_VOTE_SUBMITTED = MEETING_VOTE_SUBMITTED
    MEETING_DECISION_RESOLVED = MEETING_DECISION_RESOLVED
    MEETING_ACTION_ITEM_CREATED = MEETING_ACTION_ITEM_CREATED
    MEETING_SUMMARY_GENERATED = MEETING_SUMMARY_GENERATED

    TASK_CREATED = TASK_CREATED
    TASK_QUEUED = TASK_QUEUED
    TASK_STARTED = TASK_STARTED
    TASK_STATUS_CHANGED = TASK_STATUS_CHANGED
    TASK_COMPLETED = TASK_COMPLETED
    TASK_FAILED = TASK_FAILED
    TASK_CANCEL_REQUESTED = TASK_CANCEL_REQUESTED
    TASK_CANCELLED = TASK_CANCELLED
    TASK_ASSIGNED = TASK_ASSIGNED
    TASK_WAITING = TASK_WAITING
    TASK_RETRYING = TASK_RETRYING
    TASK_INTERRUPTED = TASK_INTERRUPTED
    SPECIALIST_ASSIGNED = SPECIALIST_ASSIGNED
    SPECIALIST_RELEASED = SPECIALIST_RELEASED
    DELIVERABLE_SUBMITTED = DELIVERABLE_SUBMITTED
    DELIVERABLE_VERIFIED = DELIVERABLE_VERIFIED
    CEO_REVIEW_COMPLETED = CEO_REVIEW_COMPLETED
    AGENT_STATUS_CHANGED = AGENT_STATUS_CHANGED
    AGENT_BEHAVIORAL_STATE_CHANGED = AGENT_BEHAVIORAL_STATE_CHANGED
    AGENT_IDLE = AGENT_IDLE
    AGENT_WORKING = AGENT_WORKING
    AGENT_WAITING_FOR_APPROVAL = AGENT_WAITING_FOR_APPROVAL
    AGENT_ERROR = AGENT_ERROR
    AGENT_RECRUITED = AGENT_RECRUITED
    AGENT_LIFECYCLE_CHANGED = AGENT_LIFECYCLE_CHANGED
    AGENT_ACTIVATED = AGENT_ACTIVATED
    AGENT_SUSPENDED = AGENT_SUSPENDED
    AGENT_OFFBOARDED = AGENT_OFFBOARDED
    AGENT_MOVEMENT_STARTED = AGENT_MOVEMENT_STARTED
    AGENT_MOVEMENT_PROGRESS = AGENT_MOVEMENT_PROGRESS
    AGENT_MOVEMENT_COMPLETED = AGENT_MOVEMENT_COMPLETED
    AGENT_MOVEMENT_INTERRUPTED = AGENT_MOVEMENT_INTERRUPTED
    WORKSTATION_ALLOCATED = WORKSTATION_ALLOCATED
    WORKSTATION_REASSIGNED = WORKSTATION_REASSIGNED
    CEO_HEARTBEAT_STARTED = CEO_HEARTBEAT_STARTED
    CEO_HEARTBEAT_COMPLETED = CEO_HEARTBEAT_COMPLETED
    CEO_HEARTBEAT_FAILED = CEO_HEARTBEAT_FAILED
    TASK_STEP_STARTED = TASK_STEP_STARTED
    TASK_STEP_COMPLETED = TASK_STEP_COMPLETED
    TASK_STEP_FAILED = TASK_STEP_FAILED
    TOOL_EXECUTION_STARTED = TOOL_EXECUTION_STARTED
    TOOL_EXECUTION_COMPLETED = TOOL_EXECUTION_COMPLETED
    TOOL_EXECUTION_FAILED = TOOL_EXECUTION_FAILED
    APPROVAL_REQUIRED = APPROVAL_REQUIRED
    APPROVAL_RESOLVED = APPROVAL_RESOLVED
    ARTIFACT_CREATED = ARTIFACT_CREATED

    WORKFLOW_CREATED = WORKFLOW_CREATED
    WORKFLOW_PLANNED = WORKFLOW_PLANNED
    WORKFLOW_STARTED = WORKFLOW_STARTED
    WORKFLOW_COMPLETED = WORKFLOW_COMPLETED
    WORKFLOW_FAILED = WORKFLOW_FAILED
    SUBTASK_CREATED = SUBTASK_CREATED
    SUBTASK_ASSIGNED = SUBTASK_ASSIGNED
    SUBTASK_STARTED = SUBTASK_STARTED
    SUBTASK_COMPLETED = SUBTASK_COMPLETED
    SUBTASK_FAILED = SUBTASK_FAILED
    AGENT_DELEGATED = AGENT_DELEGATED
    AGENT_RESULT_RECEIVED = AGENT_RESULT_RECEIVED
    WORKFLOW_REVIEW_STARTED = WORKFLOW_REVIEW_STARTED
    WORKFLOW_REVIEW_COMPLETED = WORKFLOW_REVIEW_COMPLETED

    EVENT_AGENT_STATUS_CHANGED = AGENT_STATUS_CHANGED
    EVENT_TASK_CREATED = TASK_CREATED
    EVENT_TASK_STARTED = TASK_STARTED
    EVENT_TASK_COMPLETED = TASK_COMPLETED
    EVENT_TASK_PAUSED = TASK_PAUSED
    EVENT_TASK_RESUMED = TASK_RESUMED
    EVENT_APPROVAL_DECIDED = APPROVAL_DECIDED
    EVENT_APPROVAL_APPROVED = APPROVAL_APPROVED
    EVENT_APPROVAL_REJECTED = APPROVAL_REJECTED

    _sequence_lock = threading.Lock()
    _current_max_seq: Optional[int] = None

    @staticmethod
    def create_event(
        db: Session,
        event_type: str,
        agent_id: Optional[str] = None,
        task_id: Optional[str] = None,
        organization_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        commit: bool = True,
        event_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        causation_id: Optional[str] = None,
        execution_id: Optional[str] = None,
    ) -> AgentEventModel:
        """
        Creates and persists an event record with monotonic sequence_id and tenant organization ownership.
        Strictly enforces resource existence, cross-tenant consistency, and non-repudiation.
        Supports idempotent submission: if event_id already exists, returns existing event without duplicates.
        Supports correlation_id and causation_id propagation for distributed observability and causal tracing.
        """
        if event_id:
            existing_ev = db.query(AgentEventModel).filter(AgentEventModel.id == event_id).first()
            if existing_ev:
                return existing_ev

        # Flush pending objects in the current transaction so newly created agents/tasks are queryable
        try:
            db.flush()
        except Exception:
            pass

        # 1. Resolve and validate Agent reference
        resolved_agent_id: Optional[str] = None
        agent_org: Optional[str] = None
        if agent_id:
            if agent_id in ("system", "system-catalog") or agent_id.startswith("system_") or agent_id.startswith("system-"):
                resolved_agent_id = None
                agent_org = None
            else:
                agent_obj = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
                if not agent_obj:
                    raise ValueError(f"Referenced agent '{agent_id}' does not exist")
                resolved_agent_id = agent_obj.id
                agent_org = agent_obj.organization_id

        # 2. Resolve and validate Task reference
        resolved_task_id: Optional[str] = None
        task_org: Optional[str] = None
        if task_id:
            task_obj = db.query(TaskModel).filter(TaskModel.id == task_id).first()
            if not task_obj:
                raise ValueError(f"Referenced task '{task_id}' does not exist")
            resolved_task_id = task_obj.id
            task_org = task_obj.organization_id

        # 3. Enforce cross-resource ownership consistency
        if task_org and agent_org and task_org != agent_org:
            raise ValueError("Ownership conflict: Task and Agent belong to different organizations")

        relational_org = task_org or agent_org

        # 4. Resolve and validate explicit organization_id
        resolved_org_id: Optional[str] = None
        if organization_id:
            from backend.app.models.auth import OrganizationModel
            org_exists = db.query(OrganizationModel.id).filter(
                OrganizationModel.id == organization_id,
                OrganizationModel.is_active == True,
            ).first()
            if not org_exists:
                raise ValueError(f"Invalid organization: Organization '{organization_id}' does not exist or is inactive")

            if relational_org and organization_id != relational_org:
                raise ValueError("Ownership conflict: Explicit organization_id does not match related resource ownership")
            resolved_org_id = organization_id
        elif relational_org:
            resolved_org_id = relational_org
        else:
            resolved_org_id = None

        # Build payload with correlation & causation IDs
        payload_data = dict(payload) if payload else {}
        if correlation_id:
            payload_data["correlation_id"] = correlation_id
        if causation_id:
            payload_data["causation_id"] = causation_id

        # Globally monotonic thread-safe sequence allocation
        with EventService._sequence_lock:
            max_db_seq = db.query(func.coalesce(func.max(AgentEventModel.sequence_id), 0)).scalar() or 0
            current = EventService._current_max_seq
            if current is None or int(max_db_seq) > current:
                current = int(max_db_seq)
            next_seq = current + 1
            EventService._current_max_seq = next_seq

        resolved_exec_id = execution_id or payload_data.get("execution_id")

        event = AgentEventModel(
            id=event_id or f"evt_{uuid.uuid4().hex[:16]}",
            sequence_id=next_seq,
            event_type=event_type,
            agent_id=resolved_agent_id,
            task_id=resolved_task_id,
            execution_id=resolved_exec_id,
            organization_id=resolved_org_id,
            payload_json=payload_data,
            created_at=datetime.utcnow(),
        )
        db.add(event)
        if commit:
            commit_with_retry(db)
            db.refresh(event)
        return event

    @staticmethod
    def replay_task_events(
        db: Session,
        task_id: str,
    ) -> Dict[str, Any]:
        """
        Replays the immutable event stream for a task in sequence order to reconstruct its lifecycle state.
        Demonstrates event-sourced projection consistency: current state matches replayed state.
        """
        events = (
            db.query(AgentEventModel)
            .filter(AgentEventModel.task_id == task_id)
            .order_by(AgentEventModel.sequence_id.asc(), AgentEventModel.created_at.asc())
            .all()
        )
        state = {
            "task_id": task_id,
            "status": "unknown",
            "assigned_agent_id": None,
            "steps_count": 0,
            "tools_executed": [],
            "artifacts_created": [],
            "deliverable_verified": False,
        }
        for ev in events:
            p = ev.payload_json or {}
            if ev.event_type in (TASK_CREATED, TASK_QUEUED):
                state["status"] = "queued"
            elif ev.event_type in (TASK_STARTED, SUBTASK_STARTED):
                state["status"] = "running"
            elif ev.event_type in (TASK_COMPLETED, SUBTASK_COMPLETED):
                state["status"] = "completed"
            elif ev.event_type in (TASK_FAILED, SUBTASK_FAILED):
                state["status"] = "failed"
            elif ev.event_type == TASK_CANCELLED:
                state["status"] = "cancelled"
            elif ev.event_type in (TASK_ASSIGNED, SUBTASK_ASSIGNED):
                state["assigned_agent_id"] = ev.agent_id or p.get("assigned_agent_id")
            elif ev.event_type == TASK_STEP_COMPLETED:
                state["steps_count"] += 1
            elif ev.event_type == TOOL_EXECUTION_COMPLETED:
                tool_name = p.get("tool_name")
                if tool_name:
                    state["tools_executed"].append(tool_name)
            elif ev.event_type == ARTIFACT_CREATED:
                art_id = p.get("artifact_id")
                if art_id:
                    state["artifacts_created"].append(art_id)
            elif ev.event_type == DELIVERABLE_VERIFIED:
                state["deliverable_verified"] = True
        return state

    @staticmethod
    def detect_sequence_gaps(
        events: List[AgentEventModel],
    ) -> List[tuple]:
        """
        Detects missing sequence gaps in a stream of events.
        Returns a list of (expected_start, gap_end) tuples where gaps occurred.
        """
        gaps = []
        if not events:
            return gaps
        sorted_events = sorted([e for e in events if e.sequence_id is not None], key=lambda e: e.sequence_id)
        for i in range(len(sorted_events) - 1):
            curr_seq = sorted_events[i].sequence_id
            next_seq = sorted_events[i + 1].sequence_id
            if next_seq > curr_seq + 1:
                gaps.append((curr_seq + 1, next_seq - 1))
        return gaps

    @staticmethod
    def get_events(
        db: Session,
        agent_id: Optional[str] = None,
        task_id: Optional[str] = None,
        event_type: Optional[str] = None,
        organization_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[AgentEventModel]:
        limit = min(max(1, limit), 100)
        offset = max(0, offset)

        query = db.query(AgentEventModel)
        if organization_id:
            query = query.filter(AgentEventModel.organization_id == organization_id)
        if agent_id:
            query = query.filter(AgentEventModel.agent_id == agent_id)
        if task_id:
            query = query.filter(AgentEventModel.task_id == task_id)
        if event_type:
            query = query.filter(AgentEventModel.event_type == event_type)

        return query.order_by(desc(AgentEventModel.created_at)).offset(offset).limit(limit).all()

    @staticmethod
    def get_events_after(
        db: Session,
        organization_id: Optional[str],
        last_sequence_id: int,
        limit: int = 100,
        is_superadmin: bool = False,
    ) -> List[AgentEventModel]:
        """
        Retrieves missed events after a given sequence cursor strictly scoped to the tenant organization.
        Enforces fail-closed tenant isolation at the database query level.
        """
        if not organization_id and not is_superadmin:
            return []

        limit = min(max(1, limit), 100)
        query = db.query(AgentEventModel).filter(
            AgentEventModel.sequence_id > last_sequence_id
        )

        if not is_superadmin:
            query = query.filter(AgentEventModel.organization_id == organization_id)
        elif organization_id:
            query = query.filter(AgentEventModel.organization_id == organization_id)

        return query.order_by(AgentEventModel.sequence_id.asc()).limit(limit).all()

    @staticmethod
    def build_initial_snapshot(
        db: Session,
        organization_id: Optional[str] = None,
        is_superadmin: bool = False,
    ) -> Dict[str, Any]:
        """
        Constructs an authoritative state snapshot for newly connected or resyncing clients.
        Strictly tenant-scoped for non-superadmin connections.
        """
        agent_query = db.query(AgentModel)
        task_query = db.query(TaskModel).filter(
            TaskModel.status.in_(["queued", "planning", "running", "waiting_approval"])
        )
        seq_query = db.query(func.coalesce(func.max(AgentEventModel.sequence_id), 0))

        if not is_superadmin:
            if not organization_id:
                # Fail closed if tenant context is missing
                return {
                    "message_type": "snapshot",
                    "snapshot_id": f"snap_{uuid.uuid4().hex[:12]}",
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "last_sequence_id": 0,
                    "data": {"agents": [], "active_tasks": []},
                }
            agent_query = agent_query.filter(AgentModel.organization_id == organization_id)
            task_query = task_query.filter(TaskModel.organization_id == organization_id)
            seq_query = seq_query.filter(AgentEventModel.organization_id == organization_id)
        elif organization_id:
            agent_query = agent_query.filter(AgentModel.organization_id == organization_id)
            task_query = task_query.filter(TaskModel.organization_id == organization_id)
        else:
            agent_query = agent_query.filter(AgentModel.organization_id == "org_default_company")
            task_query = task_query.filter(TaskModel.organization_id == "org_default_company")

        # Acquire authoritative sequence watermark prior to reading entity snapshots
        # This guarantees that any event emitted during snapshot construction will have sequence_id > max_seq
        # and will be safely delivered via replay without silent gap loss.
        max_seq = seq_query.scalar() or 0
        all_agents = agent_query.all()
        active_tasks = task_query.order_by(TaskModel.created_at.desc()).limit(50).all()

        return {
            "message_type": "snapshot",
            "snapshot_id": f"snap_{uuid.uuid4().hex[:12]}",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "last_sequence_id": int(max_seq),
            "data": {
                "agents": [
                    {
                        "id": a.id,
                        "name": a.name,
                        "role": a.role,
                        "station": a.station,
                        "status": a.status,
                        "behavioral_state": getattr(a, "behavioral_state", None) or "IDLE",
                        "color": a.color,
                        "avatar": a.avatar,
                        "pos_x": a.pos_x,
                        "pos_y": a.pos_y,
                        "pos_z": a.pos_z,
                        "target_pos_x": getattr(a, "target_pos_x", None),
                        "target_pos_y": getattr(a, "target_pos_y", None),
                        "target_pos_z": getattr(a, "target_pos_z", None),
                        "target_destination": getattr(a, "target_destination", None),
                        "active_movement_id": getattr(a, "active_movement_id", None),
                        "current_task_id": a.current_task_id,
                        "description": a.description,
                    }
                    for a in all_agents
                ],
                "active_tasks": [
                    {
                        "id": t.id,
                        "title": t.title,
                        "description": t.description,
                        "status": t.status,
                        "priority": t.priority,
                        "assigned_agent_id": t.assigned_agent_id,
                        "created_at": t.created_at.isoformat() if t.created_at else None,
                        "started_at": t.started_at.isoformat() if t.started_at else None,
                    }
                    for t in active_tasks
                ],
            },
        }

event_service = EventService()

# Module-level aliases
record_event = event_service.create_event
get_events_after = event_service.get_events_after
build_initial_snapshot = event_service.build_initial_snapshot
