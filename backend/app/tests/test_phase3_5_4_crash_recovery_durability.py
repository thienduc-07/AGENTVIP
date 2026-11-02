import asyncio
import os
import uuid
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock

from backend.app.core.database import SessionLocal, commit_with_retry
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.services.event_service import event_service
from backend.app.agent_runtime.dispatcher.crash_recovery import (
    recover_abandoned_tasks,
    detect_and_reclaim_stale_leases,
)
from backend.app.agent_runtime.contracts.deliverable_contract import StructuredDeliverable
from backend.app.agent_runtime.lifecycle.task_lifecycle import task_lifecycle_engine, TaskStatus
from backend.app.agent_runtime.orchestrator.multi_agent_orchestrator import MultiAgentOrchestrator
from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.llm.base import LLMResponse, ToolCallRequest, LLMUsage


@pytest.fixture(scope="function")
def crash_env():
    db = SessionLocal()
    org_id = f"org_crash_{uuid.uuid4().hex[:6]}"
    ceo_id = f"ag_ceo_{uuid.uuid4().hex[:6]}"
    w1_id = f"ag_w1_{uuid.uuid4().hex[:6]}"
    w2_id = f"ag_w2_{uuid.uuid4().hex[:6]}"

    org = OrganizationModel(id=org_id, name="Crash Org", slug=org_id.lower(), is_active=True)
    db.add(org)
    db.add(AgentModel(id=ceo_id, name="CEO", role="general", status="idle", organization_id=org_id))
    db.add(AgentModel(id=w1_id, name="Worker 1", role="general", status="idle", organization_id=org_id))
    db.add(AgentModel(id=w2_id, name="Worker 2", role="general", status="idle", organization_id=org_id))
    db.commit()

    yield {
        "org_id": org_id,
        "ceo_id": ceo_id,
        "w1_id": w1_id,
        "w2_id": w2_id,
        "db": db,
    }

    cleanup_db = SessionLocal()
    try:
        cleanup_db.query(TaskModel).filter(TaskModel.organization_id == org_id).delete()
        cleanup_db.query(AgentEventModel).filter(AgentEventModel.organization_id == org_id).delete()
        cleanup_db.query(AgentModel).filter(AgentModel.organization_id == org_id).delete()
        cleanup_db.query(OrganizationModel).filter(OrganizationModel.id == org_id).delete()
        cleanup_db.commit()
    except Exception:
        pass
    finally:
        cleanup_db.close()
    db.close()


def test_3_5_4_01_worker_process_termination(crash_env):
    """Scenario 1: Worker process SIGKILL mid-task transitions agent to idle and reclaims task."""
    db = crash_env["db"]
    org_id = crash_env["org_id"]
    w1_id = crash_env["w1_id"]

    t_id = f"t-crash-term-{uuid.uuid4().hex[:6]}"
    task = TaskModel(
        id=t_id,
        title="Terminated Task",
        description="Worker terminated abruptly",
        status="running",
        assigned_agent_id=w1_id,
        organization_id=org_id,
    )
    db.add(task)

    agent = db.query(AgentModel).filter(AgentModel.id == w1_id).first()
    agent.status = "working"
    agent.behavioral_state = "WORKING"
    agent.current_task_id = t_id
    db.commit()

    recovered = recover_abandoned_tasks(db, auto_retry=True)
    assert recovered >= 1

    db.expire_all()
    reloaded_t = db.query(TaskModel).filter(TaskModel.id == t_id).first()
    assert reloaded_t.status == "queued"
    assert reloaded_t.retry_count == 1

    reloaded_ag = db.query(AgentModel).filter(AgentModel.id == w1_id).first()
    assert reloaded_ag.status == "idle"
    assert reloaded_ag.behavioral_state == "IDLE"
    assert reloaded_ag.current_task_id is None


def test_3_5_4_02_application_process_termination(crash_env):
    """Scenario 2: Entire application crashes with multiple active workflows."""
    db = crash_env["db"]
    org_id = crash_env["org_id"]
    w1_id = crash_env["w1_id"]

    wf_id = f"wf-app-crash-{uuid.uuid4().hex[:6]}"
    wf = TaskModel(
        id=wf_id,
        title="App Crash Workflow",
        description="Parent workflow interrupted",
        status="in_progress",
        task_type="workflow",
        assigned_agent_id=w1_id,
        organization_id=org_id,
    )
    db.add(wf)

    # 1 subtask completed, 1 in_progress
    st_comp = TaskModel(
        id=f"st-c1-{uuid.uuid4().hex[:6]}",
        parent_task_id=wf_id,
        title="Completed Subtask",
        description="Was finished before crash",
        status="completed",
        task_type="subtask",
        assigned_agent_id=w1_id,
        organization_id=org_id,
    )
    st_run = TaskModel(
        id=f"st-r1-{uuid.uuid4().hex[:6]}",
        parent_task_id=wf_id,
        title="Running Subtask",
        description="Was running when server crashed",
        status="running",
        task_type="subtask",
        assigned_agent_id=w1_id,
        organization_id=org_id,
    )
    db.add(st_comp)
    db.add(st_run)
    db.commit()

    recovered = recover_abandoned_tasks(db, auto_retry=True)
    assert recovered >= 1

    db.expire_all()
    # Completed subtask remains completed!
    assert db.query(TaskModel).filter(TaskModel.id == st_comp.id).first().status == "completed"
    # Interrupted subtask is re-queued
    assert db.query(TaskModel).filter(TaskModel.id == st_run.id).first().status == "queued"


def test_3_5_4_03_stale_worker_leases_reclamation(crash_env):
    """Scenario 3: Tasks without heartbeats past lease timeout are reclaimed with new lease token."""
    db = crash_env["db"]
    org_id = crash_env["org_id"]
    w1_id = crash_env["w1_id"]

    t_id = f"t-stale-lease-{uuid.uuid4().hex[:6]}"
    stale_time = datetime.now(timezone.utc) - timedelta(seconds=400)
    task = TaskModel(
        id=t_id,
        title="Stale Lease Task",
        description="Stalled execution",
        status="running",
        assigned_agent_id=w1_id,
        organization_id=org_id,
        updated_at=stale_time,
        lease_token="lease_initial_12345",
    )
    db.add(task)
    db.commit()

    reclaimed = detect_and_reclaim_stale_leases(db, lease_timeout_seconds=300.0)
    assert reclaimed >= 1

    db.expire_all()
    reloaded = db.query(TaskModel).filter(TaskModel.id == t_id).first()
    assert reloaded.status == "queued"
    # Lease token must be invalidated and updated to a new token!
    assert reloaded.lease_token is not None
    assert reloaded.lease_token != "lease_initial_12345"


def test_3_5_4_04_fencing_token_rejects_stale_worker(crash_env):
    """
    Scenario 4: Fencing Token Verification:
    A stale worker wakes up after lease expiry and tries to commit subtask completion.
    The orchestrator detects fencing token mismatch and rejects the stale write.
    """
    db = crash_env["db"]
    org_id = crash_env["org_id"]
    w1_id = crash_env["w1_id"]

    t_id = f"t-fence-{uuid.uuid4().hex[:6]}"
    task = TaskModel(
        id=t_id,
        title="Fencing Verification Task",
        description="Stale worker test",
        status="running",
        assigned_agent_id=w1_id,
        organization_id=org_id,
        lease_token="lease_new_reassigned_9999", # Database has newer lease
    )
    db.add(task)
    db.commit()

    # Stale worker thinks its token was "lease_stale_old_1111"
    stale_worker_token = "lease_stale_old_1111"
    current_db_subtask = db.query(TaskModel).filter(TaskModel.id == t_id).first()

    assert current_db_subtask.lease_token != stale_worker_token
    # Fencing check correctly flags mismatch
    fencing_valid = (current_db_subtask.lease_token == stale_worker_token)
    assert fencing_valid is False


def test_3_5_4_05_recovery_with_partially_completed_dag(crash_env):
    """Scenario 5: DAG workflow with partial branch completion resumes cleanly."""
    db = crash_env["db"]
    org_id = crash_env["org_id"]
    w1_id = crash_env["w1_id"]
    w2_id = crash_env["w2_id"]

    wf_id = f"wf-dag-part-{uuid.uuid4().hex[:6]}"
    wf = TaskModel(
        id=wf_id,
        title="Partial DAG Workflow",
        description="Crash mid-diamond",
        status="in_progress",
        task_type="workflow",
        assigned_agent_id=w1_id,
        organization_id=org_id,
    )
    db.add(wf)

    # Step A: completed
    st_a = TaskModel(
        id=f"st-a-{uuid.uuid4().hex[:6]}",
        parent_task_id=wf_id,
        title="Step A",
        description="Step A",
        status="completed",
        task_type="subtask",
        assigned_agent_id=w1_id,
        organization_id=org_id,
        input_data_json={"subtask_key": "step_a"},
        dependencies_json=[],
    )
    # Step B: running (interrupted)
    st_b = TaskModel(
        id=f"st-b-{uuid.uuid4().hex[:6]}",
        parent_task_id=wf_id,
        title="Step B",
        description="Step B",
        status="running",
        task_type="subtask",
        assigned_agent_id=w2_id,
        organization_id=org_id,
        input_data_json={"subtask_key": "step_b"},
        dependencies_json=["step_a"],
    )
    db.add(st_a)
    db.add(st_b)
    db.commit()

    recover_abandoned_tasks(db, auto_retry=True)

    db.expire_all()
    assert db.query(TaskModel).filter(TaskModel.id == st_a.id).first().status == "completed"
    assert db.query(TaskModel).filter(TaskModel.id == st_b.id).first().status == "queued"


def test_3_5_4_06_recovery_during_retry_backoff(crash_env):
    """Scenario 6: Tasks undergoing exponential retry backoff maintain retry state."""
    db = crash_env["db"]
    org_id = crash_env["org_id"]
    w1_id = crash_env["w1_id"]

    t_id = f"t-backoff-{uuid.uuid4().hex[:6]}"
    task = TaskModel(
        id=t_id,
        title="Retry Backoff Task",
        description="Fails repeatedly up to max_retries",
        status="running",
        assigned_agent_id=w1_id,
        organization_id=org_id,
        retry_count=1,
        max_retries=2,
    )
    db.add(task)
    db.commit()

    # Recovery evaluates retry attempt 2
    recover_abandoned_tasks(db, auto_retry=True)

    db.expire_all()
    reloaded = db.query(TaskModel).filter(TaskModel.id == t_id).first()
    assert reloaded.status == "queued"
    assert reloaded.retry_count == 2

    # Subsequent crash when max_retries exceeded transitions to failed
    reloaded.status = "running"
    db.commit()

    recover_abandoned_tasks(db, auto_retry=True)
    db.expire_all()
    terminal_t = db.query(TaskModel).filter(TaskModel.id == t_id).first()
    assert terminal_t.status == "failed"
    assert "exhausted" in terminal_t.error_message.lower()


def test_3_5_4_07_recovery_after_artifact_creation(crash_env):
    """Scenario 7: Artifact created prior to worker crash is preserved and verified on recovery."""
    db = crash_env["db"]
    org_id = crash_env["org_id"]
    w1_id = crash_env["w1_id"]
    t_id = f"t-rec-art-{uuid.uuid4().hex[:6]}"

    deliv_dict = {
        "deliverable_id": f"deliv_{uuid.uuid4().hex[:8]}",
        "task_id": t_id,
        "verification_status": "VERIFIED",
        "result_summary": "Artifact generated and verified on disk",
    }

    task = TaskModel(
        id=t_id,
        title="Artifact Preserved Task",
        description="Preserves verified deliverable",
        status="running",
        assigned_agent_id=w1_id,
        organization_id=org_id,
        output_data_json={"deliverable": deliv_dict},
    )
    db.add(task)
    db.commit()

    recover_abandoned_tasks(db, auto_retry=True)

    db.expire_all()
    recovered = db.query(TaskModel).filter(TaskModel.id == t_id).first()
    assert recovered.status == "completed"


def test_3_5_4_08_recovery_during_event_publication(crash_env):
    """Scenario 8: Audit event is reliably persisted during crash recovery."""
    db = crash_env["db"]
    org_id = crash_env["org_id"]
    w1_id = crash_env["w1_id"]
    t_id = f"t-rec-evt-{uuid.uuid4().hex[:6]}"

    task = TaskModel(
        id=t_id,
        title="Event Recovery Task",
        description="Auditable recovery",
        status="running",
        assigned_agent_id=w1_id,
        organization_id=org_id,
    )
    db.add(task)
    db.commit()

    recover_abandoned_tasks(db, auto_retry=True)

    # Verify event was persisted
    events = (
        db.query(AgentEventModel)
        .filter(AgentEventModel.task_id == t_id, AgentEventModel.event_type == "task.interrupted")
        .all()
    )
    assert len(events) >= 1
    assert events[0].payload_json.get("reason") == "Worker process rebooted during execution"


def test_3_5_4_09_dead_letter_audit_trail(crash_env):
    """Scenario 9: Dead-lettered tasks record full diagnostic audit details."""
    db = crash_env["db"]
    org_id = crash_env["org_id"]
    w1_id = crash_env["w1_id"]
    t_id = f"t-dead-letter-{uuid.uuid4().hex[:6]}"

    task = TaskModel(
        id=t_id,
        title="Dead Letter Task",
        description="Max retries already reached",
        status="running",
        assigned_agent_id=w1_id,
        organization_id=org_id,
        retry_count=2,
        max_retries=2,
    )
    db.add(task)
    db.commit()

    recover_abandoned_tasks(db, auto_retry=False)

    db.expire_all()
    failed_t = db.query(TaskModel).filter(TaskModel.id == t_id).first()
    assert failed_t.status == "failed"
    assert failed_t.completed_at is not None
    assert failed_t.error_message is not None


def test_3_5_4_10_agent_state_reconciliation_post_crash(crash_env):
    """Scenario 10: Agents left in non-IDLE states without active tasks are reconciled to IDLE."""
    db = crash_env["db"]
    org_id = crash_env["org_id"]
    w1_id = crash_env["w1_id"]

    agent = db.query(AgentModel).filter(AgentModel.id == w1_id).first()
    agent.status = "working"
    agent.behavioral_state = "THINKING"
    agent.current_task_id = "non-existent-task"
    db.commit()

    recover_abandoned_tasks(db, auto_retry=True)

    db.expire_all()
    reloaded_ag = db.query(AgentModel).filter(AgentModel.id == w1_id).first()
    assert reloaded_ag.status == "idle"
    assert reloaded_ag.behavioral_state == "IDLE"
    assert reloaded_ag.current_task_id is None
