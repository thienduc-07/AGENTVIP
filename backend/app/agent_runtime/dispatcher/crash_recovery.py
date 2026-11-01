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
        if agent and agent.status == "working":
            agent.status = "idle"
            agent.current_task_id = None
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

    db.commit()
    logger.info(f"Crash recovery complete: Safely resolved {recovered_count} abandoned tasks.")
    return recovered_count
