import logging
from datetime import datetime
from sqlalchemy.orm import Session
from backend.app.models.task import TaskModel
from backend.app.models.agent import AgentModel
from backend.app.services.event_service import event_service

logger = logging.getLogger("grandline.runtime.recovery")

def recover_abandoned_tasks(db: Session) -> int:
    """
    Scans for tasks left in 'planning' or 'running' states due to unexpected worker
    or server restarts, safely resetting them and freeing assigned agents.
    """
    interrupted_tasks = (
        db.query(TaskModel)
        .filter(TaskModel.status.in_(["planning", "running"]))
        .all()
    )

    if not interrupted_tasks:
        logger.info("Crash recovery check: No orphaned tasks found.")
        return 0

    recovered_count = 0
    for task in interrupted_tasks:
        logger.warning(f"Recovering abandoned task '{task.id}' (was in status '{task.status}')")
        task.status = "failed"
        task.error_message = "Task terminated unexpectedly due to worker restart or process interruption."
        task.updated_at = datetime.utcnow()
        task.completed_at = datetime.utcnow()

        # Free assigned agent
        agent = db.query(AgentModel).filter(AgentModel.id == task.assigned_agent_id).first()
        if agent and (agent.status == "working" or getattr(agent, "behavioral_state", "IDLE") != "IDLE"):
            agent.status = "idle" if agent.status != "offline" else "offline"
            agent.behavioral_state = "IDLE"
            agent.current_task_id = None
            agent.active_movement_id = None
            agent.target_pos_x = None
            agent.target_pos_y = None
            agent.target_pos_z = None
            agent.target_destination = None
            agent.updated_at = datetime.utcnow()

        # Record audit event
        event_service.create_event(
            db=db,
            event_type="task.interrupted",
            agent_id=task.assigned_agent_id,
            task_id=task.id,
            organization_id=task.organization_id,
            payload={"reason": "Worker process rebooted during execution"},
            commit=False,
        )
        recovered_count += 1

    # Also recover any agents left in non-IDLE behavioral_state with no active task
    active_task_ids = {
        t[0]
        for t in db.query(TaskModel.id)
        .filter(TaskModel.status.in_(["queued", "planning", "running", "waiting_approval"]))
        .all()
    }
    stuck_agents = (
        db.query(AgentModel)
        .filter(
            (AgentModel.status == "working")
            | (AgentModel.behavioral_state.in_(["PLANNING", "THINKING", "WORKING", "COMMUNICATING", "MOVING"]))
        )
        .all()
    )
    for ag in stuck_agents:
        if not ag.current_task_id or ag.current_task_id not in active_task_ids:
            ag.status = "idle" if ag.status != "offline" else "offline"
            ag.behavioral_state = "IDLE"
            ag.current_task_id = None
            ag.active_movement_id = None
            ag.target_pos_x = None
            ag.target_pos_y = None
            ag.target_pos_z = None
            ag.target_destination = None
            ag.updated_at = datetime.utcnow()

    db.commit()
    logger.info(f"Crash recovery complete: Safely resolved {recovered_count} abandoned tasks.")
    return recovered_count
