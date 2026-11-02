import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from sqlalchemy.orm import Session
from backend.app.models.task import TaskModel
from backend.app.models.agent import AgentModel
from backend.app.services.event_service import event_service
from backend.app.agent_runtime.lifecycle.retry_manager import retry_manager

logger = logging.getLogger("grandline.runtime.recovery")


def recover_abandoned_tasks(db: Session, auto_retry: bool = False) -> int:
    """
    Scans for tasks left in 'planning', 'running', or 'in_progress' states due to unexpected worker
    or server restarts. Preserves completed subtasks, re-queues retryable tasks with backoff history,
    and reconciles agent behavioral states.
    """
    interrupted_tasks = (
        db.query(TaskModel)
        .filter(TaskModel.status.in_(["planning", "running", "in_progress"]))
        .all()
    )

    if not interrupted_tasks:
        logger.info("Crash recovery check: No orphaned tasks found.")
        return 0

    now = datetime.now(timezone.utc)
    recovered_count = 0
    processed_task_ids: set = set()

    for task in interrupted_tasks:
        if task.id in processed_task_ids:
            continue
        processed_task_ids.add(task.id)
        logger.warning(f"Recovering abandoned task '{task.id}' (was in status '{task.status}', type='{task.task_type}')")

        # 1. Hierarchical workflow recovery: preserve completed subtasks
        if task.task_type == "workflow":
            child_subtasks = db.query(TaskModel).filter(TaskModel.parent_task_id == task.id).all()
            completed_children = [st for st in child_subtasks if st.status == "completed"]
            running_children = [st for st in child_subtasks if st.status in ("running", "in_progress", "planning")]

            for c_st in running_children:
                processed_task_ids.add(c_st.id)
                c_decision = retry_manager.evaluate_retry(
                    c_st,
                    error_message="Worker process rebooted during subtask execution",
                )
                if auto_retry and c_decision.should_retry:
                    retry_manager.record_retry_attempt(c_st, c_decision, "Server reboot during execution")
                    c_st.status = "queued"
                    c_st.updated_at = now
                    event_service.create_event(
                        db=db,
                        event_type="task.retrying",
                        agent_id=c_st.assigned_agent_id,
                        task_id=c_st.id,
                        organization_id=c_st.organization_id,
                        payload={"reason": "Server reboot: subtask re-queued for execution", "attempt": c_st.retry_count},
                        commit=False,
                    )
                else:
                    c_st.status = "failed"
                    c_st.error_message = "Subtask terminated unexpectedly during server restart (retries exhausted)."
                    c_st.completed_at = now
                    c_st.updated_at = now

                # Free child assigned agent
                if c_st.assigned_agent_id:
                    child_agent = db.query(AgentModel).filter(AgentModel.id == c_st.assigned_agent_id).first()
                    if child_agent and (child_agent.status == "working" or getattr(child_agent, "behavioral_state", "IDLE") != "IDLE"):
                        child_agent.status = "idle" if child_agent.status != "offline" else "offline"
                        child_agent.behavioral_state = "IDLE"
                        child_agent.current_task_id = None
                        child_agent.active_movement_id = None
                        child_agent.updated_at = now

            # If any unfinished children were re-queued, re-queue parent workflow to resume
            remaining_to_do = [st for st in child_subtasks if st.status in ("pending", "queued", "ready")]
            if remaining_to_do:
                task.status = "queued"
                task.updated_at = now
                logger.info(f"Workflow '{task.id}' preserved with {len(completed_children)} completed subtasks; re-queued to resume remaining.")
            else:
                task.status = "failed"
                task.error_message = "Workflow interrupted and unable to resume remaining work."
                task.completed_at = now
                task.updated_at = now

        else:
            # 2. Standalone task or isolated subtask recovery
            decision = retry_manager.evaluate_retry(
                task,
                error_message="Worker process restarted during task execution",
            )
            if auto_retry and decision.should_retry:
                retry_manager.record_retry_attempt(task, decision, "Server process restarted during execution")
                task.status = "queued"
                task.updated_at = now
                event_service.create_event(
                    db=db,
                    event_type="task.retrying",
                    agent_id=task.assigned_agent_id,
                    task_id=task.id,
                    organization_id=task.organization_id,
                    payload={"reason": "Server restart: task re-queued for execution", "attempt": task.retry_count},
                    commit=False,
                )
                logger.info(f"Task '{task.id}' re-queued under retry attempt {task.retry_count}/{task.max_retries}")
            else:
                task.status = "failed"
                task.error_message = "Task terminated unexpectedly due to worker restart or process interruption."
                task.completed_at = now
                task.updated_at = now

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
            agent.updated_at = now

        # Record audit event
        event_service.create_event(
            db=db,
            event_type="task.interrupted",
            agent_id=task.assigned_agent_id,
            task_id=task.id,
            organization_id=task.organization_id,
            payload={"reason": "Worker process rebooted during execution", "resolved_status": task.status},
            commit=False,
        )
        recovered_count += 1

    # Also recover any agents left in non-IDLE behavioral_state or working status
    # During post-crash recovery, no agent can actively be executing work.
    executing_task_ids = {
        t[0]
        for t in db.query(TaskModel.id)
        .filter(TaskModel.status.in_(["running", "in_progress"]))
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
        if not ag.current_task_id or ag.current_task_id not in executing_task_ids:
            ag.status = "idle" if ag.status != "offline" else "offline"
            ag.behavioral_state = "IDLE"
            ag.current_task_id = None
            ag.active_movement_id = None
            ag.target_pos_x = None
            ag.target_pos_y = None
            ag.target_pos_z = None
            ag.target_destination = None
            ag.updated_at = now

    db.commit()
    logger.info(f"Crash recovery complete: Safely resolved {recovered_count} abandoned tasks.")
    return recovered_count


def detect_and_reclaim_stale_leases(db: Session, lease_timeout_seconds: float = 300.0) -> int:
    """
    Identifies tasks that have been in active status without an updated timestamp
    longer than the lease threshold, reclaiming them for execution.
    """
    threshold = datetime.now(timezone.utc) - timedelta(seconds=lease_timeout_seconds)
    stale_tasks = (
        db.query(TaskModel)
        .filter(
            TaskModel.status.in_(["running", "in_progress"]),
            TaskModel.updated_at < threshold,
        )
        .all()
    )

    reclaimed_count = 0
    now = datetime.now(timezone.utc)
    for task in stale_tasks:
        logger.warning(f"Reclaiming stale execution lease for task '{task.id}' (last updated {task.updated_at})")
        decision = retry_manager.evaluate_retry(
            task,
            error_message=f"Execution lease timed out after {lease_timeout_seconds}s without heartbeat",
        )
        if decision.should_retry:
            retry_manager.record_retry_attempt(task, decision, "Stale execution lease reclaimed")
            task.status = "queued"
            task.updated_at = now
            event_service.create_event(
                db=db,
                event_type="task.retrying",
                agent_id=task.assigned_agent_id,
                task_id=task.id,
                organization_id=task.organization_id,
                payload={"reason": "Stale lease reclaimed: re-queued", "attempt": task.retry_count},
                commit=False,
            )
        else:
            task.status = "failed"
            task.error_message = f"Execution lease timed out after {lease_timeout_seconds}s (retries exhausted)."
            task.completed_at = now
            task.updated_at = now

        # Free assigned agent
        agent = db.query(AgentModel).filter(AgentModel.id == task.assigned_agent_id).first()
        if agent and agent.current_task_id == task.id:
            agent.status = "idle" if agent.status != "offline" else "offline"
            agent.behavioral_state = "IDLE"
            agent.current_task_id = None
            agent.updated_at = now

        reclaimed_count += 1

    if reclaimed_count > 0:
        db.commit()
        logger.info(f"Stale lease reclamation complete: Reclaimed {reclaimed_count} stalled tasks.")
    return reclaimed_count
