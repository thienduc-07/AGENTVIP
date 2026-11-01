import logging
from datetime import datetime
from enum import Enum
from typing import Dict, Optional, Set, Union
from sqlalchemy.orm import Session

from backend.app.core.errors import NotFoundError, ValidationError, ConflictError
from backend.app.models.agent import AgentModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.services.event_service import (
    event_service,
    AGENT_BEHAVIORAL_STATE_CHANGED,
)
from backend.app.websocket_manager import ws_manager

logger = logging.getLogger("agency.behavioral_state")


class BehavioralState(str, Enum):
    """
    Authoritative Agent Behavioral States (Phase 3.3.3 Decision 1).
    Distinct from Agent operational status (idle, working, waiting_approval, error, offline)
    and Task execution status (queued, planning, running, waiting_approval, completed, failed, cancelled).
    """
    IDLE = "IDLE"
    PLANNING = "PLANNING"
    THINKING = "THINKING"
    WORKING = "WORKING"
    COMMUNICATING = "COMMUNICATING"
    MOVING = "MOVING"
    WAITING = "WAITING"
    COMPLETED = "COMPLETED"
    ERROR = "ERROR"


ALL_BEHAVIORAL_STATES: Set[str] = {s.value for s in BehavioralState}

# Valid Behavioral State Transitions Matrix
VALID_BEHAVIORAL_TRANSITIONS: Dict[BehavioralState, Set[BehavioralState]] = {
    BehavioralState.IDLE: {
        BehavioralState.IDLE,
        BehavioralState.PLANNING,
        BehavioralState.THINKING,
        BehavioralState.WORKING,
        BehavioralState.COMMUNICATING,
        BehavioralState.MOVING,
        BehavioralState.WAITING,
        BehavioralState.ERROR,
    },
    BehavioralState.PLANNING: {
        BehavioralState.PLANNING,
        BehavioralState.THINKING,
        BehavioralState.WORKING,
        BehavioralState.COMMUNICATING,
        BehavioralState.MOVING,
        BehavioralState.WAITING,
        BehavioralState.COMPLETED,
        BehavioralState.ERROR,
        BehavioralState.IDLE,
    },
    BehavioralState.THINKING: {
        BehavioralState.THINKING,
        BehavioralState.PLANNING,
        BehavioralState.WORKING,
        BehavioralState.COMMUNICATING,
        BehavioralState.MOVING,
        BehavioralState.WAITING,
        BehavioralState.COMPLETED,
        BehavioralState.ERROR,
        BehavioralState.IDLE,
    },
    BehavioralState.WORKING: {
        BehavioralState.WORKING,
        BehavioralState.THINKING,
        BehavioralState.COMMUNICATING,
        BehavioralState.MOVING,
        BehavioralState.WAITING,
        BehavioralState.COMPLETED,
        BehavioralState.ERROR,
        BehavioralState.IDLE,
    },
    BehavioralState.COMMUNICATING: {
        BehavioralState.COMMUNICATING,
        BehavioralState.PLANNING,
        BehavioralState.THINKING,
        BehavioralState.WORKING,
        BehavioralState.MOVING,
        BehavioralState.WAITING,
        BehavioralState.COMPLETED,
        BehavioralState.ERROR,
        BehavioralState.IDLE,
    },
    BehavioralState.MOVING: {
        BehavioralState.MOVING,
        BehavioralState.IDLE,
        BehavioralState.PLANNING,
        BehavioralState.THINKING,
        BehavioralState.WORKING,
        BehavioralState.COMMUNICATING,
        BehavioralState.WAITING,
        BehavioralState.COMPLETED,
        BehavioralState.ERROR,
    },
    BehavioralState.WAITING: {
        BehavioralState.WAITING,
        BehavioralState.IDLE,
        BehavioralState.PLANNING,
        BehavioralState.THINKING,
        BehavioralState.WORKING,
        BehavioralState.COMMUNICATING,
        BehavioralState.MOVING,
        BehavioralState.ERROR,
    },
    BehavioralState.COMPLETED: {
        BehavioralState.COMPLETED,
        BehavioralState.IDLE,
        BehavioralState.PLANNING,
        BehavioralState.THINKING,
        BehavioralState.MOVING,
        BehavioralState.COMMUNICATING,
        BehavioralState.ERROR,
    },
    BehavioralState.ERROR: {
        BehavioralState.ERROR,
        BehavioralState.IDLE,
        BehavioralState.PLANNING,
        BehavioralState.THINKING,
        BehavioralState.MOVING,
    },
}

# Backwards-compatible mapping from BehavioralState to AgentModel.status (operational status)
OPERATIONAL_STATUS_MAPPING: Dict[BehavioralState, str] = {
    BehavioralState.IDLE: "idle",
    BehavioralState.PLANNING: "working",
    BehavioralState.THINKING: "working",
    BehavioralState.WORKING: "working",
    BehavioralState.COMMUNICATING: "working",
    BehavioralState.MOVING: "working",
    BehavioralState.WAITING: "waiting_approval",
    BehavioralState.COMPLETED: "idle",
    BehavioralState.ERROR: "error",
}

ACTIVE_EXECUTION_STATES: Set[BehavioralState] = {
    BehavioralState.PLANNING,
    BehavioralState.THINKING,
    BehavioralState.WORKING,
    BehavioralState.COMMUNICATING,
    BehavioralState.MOVING,
    BehavioralState.WAITING,
}


class BehavioralStateService:
    """
    Manages authoritative agent behavioral state transitions, validation,
    backwards-compatible operational status synchronization, tenant isolation,
    and EventService persistence.
    """

    @staticmethod
    def parse_state(state: Union[str, BehavioralState]) -> BehavioralState:
        if isinstance(state, BehavioralState):
            return state
        if not state or not isinstance(state, str):
            raise ValidationError(
                message=f"Invalid behavioral state: '{state}'",
                code="INVALID_BEHAVIORAL_STATE",
            )
        normalized = state.strip().upper()
        try:
            return BehavioralState(normalized)
        except ValueError:
            raise ValidationError(
                message=(
                    f"Unsupported behavioral state '{state}'. "
                    f"Must be one of: {sorted(ALL_BEHAVIORAL_STATES)}"
                ),
                code="INVALID_BEHAVIORAL_STATE",
            )

    @classmethod
    def validate_transition(
        cls,
        current_state: Union[str, BehavioralState],
        target_state: Union[str, BehavioralState],
    ) -> BehavioralState:
        curr = cls.parse_state(current_state or BehavioralState.IDLE)
        target = cls.parse_state(target_state)
        allowed = VALID_BEHAVIORAL_TRANSITIONS.get(curr, set())
        if target not in allowed:
            raise ValidationError(
                message=(
                    f"Invalid behavioral state transition from '{curr.value}' to '{target.value}'. "
                    f"Allowed transitions from '{curr.value}': {sorted(s.value for s in allowed)}"
                ),
                code="INVALID_BEHAVIORAL_TRANSITION",
            )
        return target

    @classmethod
    def transition_state(
        cls,
        db: Session,
        agent_id: str,
        target_state: Union[str, BehavioralState],
        organization_id: Optional[str] = None,
        task_id: Optional[str] = None,
        reason: Optional[str] = None,
        sync_operational_status: bool = True,
        force_recovery: bool = False,
        commit: bool = False,
        broadcast: bool = True,
    ) -> AgentModel:
        """
        Validates and persists an authoritative behavioral state transition for an agent.
        Strictly enforces tenant isolation and lifecycle readiness.
        """
        agent = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
        if not agent:
            raise NotFoundError(
                message=f"Agent '{agent_id}' not found",
                code="AGENT_NOT_FOUND",
            )

        rec = (
            db.query(RecruitmentRecordModel)
            .filter(RecruitmentRecordModel.agent_id == agent_id)
            .first()
        )
        agent_org = rec.organization_id if rec else agent.organization_id

        # Enforce strict tenant isolation
        if organization_id and agent_org and agent_org != organization_id:
            raise ValidationError(
                message=(
                    f"Tenant isolation violation: Agent '{agent_id}' does not belong to "
                    f"organization '{organization_id}'"
                ),
                code="CROSS_TENANT_BEHAVIORAL_TRANSITION",
            )

        target = cls.parse_state(target_state)
        raw_current = getattr(agent, "behavioral_state", None) or "IDLE"
        try:
            current = cls.parse_state(raw_current)
        except ValidationError:
            current = BehavioralState.IDLE

        # Lifecycle & offline guard for active behavioral states
        if not force_recovery and target in ACTIVE_EXECUTION_STATES:
            if rec and rec.lifecycle_state in ("SUSPENDED", "OFFBOARDED", "RETIRED"):
                raise ConflictError(
                    message=(
                        f"Cannot transition agent '{agent_id}' to '{target.value}' while "
                        f"in lifecycle state '{rec.lifecycle_state}'"
                    ),
                    code="AGENT_LIFECYCLE_INACTIVE",
                )
            if agent.status == "offline":
                raise ConflictError(
                    message=f"Cannot transition offline agent '{agent_id}' to '{target.value}'",
                    code="AGENT_OFFLINE",
                )

        if not force_recovery:
            cls.validate_transition(current, target)

        previous_state = current.value
        agent.behavioral_state = target.value
        agent.updated_at = datetime.utcnow()

        if sync_operational_status:
            if agent.status == "offline" and target == BehavioralState.IDLE:
                # Preserve offline operational status when resetting behavioral state
                pass
            else:
                agent.status = OPERATIONAL_STATUS_MAPPING.get(target, "idle")

        effective_task_id = task_id if task_id is not None else agent.current_task_id
        effective_org = organization_id or agent_org

        event_task_id = effective_task_id
        if event_task_id and effective_org:
            from backend.app.models.task import TaskModel
            linked_task = db.query(TaskModel).filter(TaskModel.id == event_task_id).first()
            if linked_task and linked_task.organization_id and linked_task.organization_id != effective_org:
                event_task_id = None

        ev = event_service.create_event(
            db=db,
            event_type=AGENT_BEHAVIORAL_STATE_CHANGED,
            agent_id=agent.id,
            task_id=event_task_id,
            organization_id=effective_org,
            payload={
                "agent_id": agent.id,
                "previous_state": previous_state,
                "behavioral_state": target.value,
                "operational_status": agent.status,
                "task_id": effective_task_id,
                "reason": reason,
                "organization_id": effective_org,
            },
            commit=commit,
        )

        if broadcast and ev:
            ws_manager.broadcast_sync(ev.to_envelope())

        return agent

    @classmethod
    def safe_release_agent(
        cls,
        db: Session,
        agent_id: Optional[str],
        organization_id: Optional[str] = None,
        task_id: Optional[str] = None,
        terminal_state: Optional[Union[str, BehavioralState]] = None,
        reason: Optional[str] = None,
        failure_reason: Optional[str] = None,
        use_error_state: Optional[bool] = None,
        commit: bool = False,
        broadcast: bool = True,
    ) -> Optional[AgentModel]:
        """
        Guarantees that a completed, failed, cancelled, or rejected task execution
        NEVER leaves an Agent permanently in WORKING (or PLANNING / THINKING / COMMUNICATING).
        Optionally records an intermediate terminal behavioral state (e.g., COMPLETED or ERROR)
        before settling the agent into IDLE with current_task_id = None.
        """
        if not agent_id:
            return None

        effective_reason = reason or failure_reason
        if terminal_state is None and use_error_state:
            terminal_state = BehavioralState.ERROR

        agent = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
        if not agent:
            return None

        if organization_id and agent.organization_id and agent.organization_id != organization_id:
            return None

        # 1. Optionally emit intermediate terminal state (COMPLETED or ERROR)
        if terminal_state is not None:
            term_enum = cls.parse_state(terminal_state)
            if agent.behavioral_state != term_enum.value:
                try:
                    cls.transition_state(
                        db=db,
                        agent_id=agent.id,
                        target_state=term_enum,
                        organization_id=organization_id,
                        task_id=task_id,
                        reason=effective_reason,
                        sync_operational_status=True,
                        force_recovery=True,
                        commit=False,
                        broadcast=broadcast,
                    )
                except Exception as e:
                    logger.debug(f"Intermediate terminal transition skipped for '{agent.id}': {e}")

        # 2. Clear task assignment and settle behavioral state to IDLE
        if task_id is None or agent.current_task_id in (None, task_id):
            agent.current_task_id = None

        cls.transition_state(
            db=db,
            agent_id=agent.id,
            target_state=BehavioralState.IDLE,
            organization_id=organization_id,
            task_id=task_id,
            reason=effective_reason or "Agent released to idle standby",
            sync_operational_status=True,
            force_recovery=True,
            commit=commit,
            broadcast=broadcast,
        )
        return agent


behavioral_state_service = BehavioralStateService()
