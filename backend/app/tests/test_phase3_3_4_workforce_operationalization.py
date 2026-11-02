import uuid
import pytest
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.contracts.deliverable_contract import StructuredDeliverable
from backend.app.agent_runtime.dispatcher.crash_recovery import (
    recover_abandoned_tasks,
    detect_and_reclaim_stale_leases,
)
from backend.app.agent_runtime.lifecycle.retry_manager import (
    retry_manager,
    RetryDecision,
)
from backend.app.agent_runtime.lifecycle.task_lifecycle import (
    TaskLifecycleEngine,
    TaskStatus,
    InvalidTaskTransitionError,
    DeliverableNotVerifiedError,
    task_lifecycle_engine,
    normalize_task_status,
)
from backend.app.agent_runtime.orchestrator.multi_agent_orchestrator import (
    MultiAgentOrchestrator,
)
from backend.app.agent_runtime.workforce.workload_manager import (
    specialist_workload_manager,
    SpecialistWorkloadProfile,
)
from backend.app.core.database import SessionLocal
from backend.app.core.errors import ValidationError
from backend.app.models.agent import AgentModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.specialist import SpecialistDefinitionModel
from backend.app.models.task import TaskModel
from backend.app.services.event_service import event_service
from backend.app.services.task_service import task_service


@pytest.fixture
def org_test_setup():
    db = SessionLocal()
    org_id = f"org_test_334_{uuid.uuid4().hex[:8]}"
    org_b_id = f"org_test_334_b_{uuid.uuid4().hex[:8]}"
    org = OrganizationModel(id=org_id, name="Phase 334 Org", slug=org_id.lower(), is_active=True)
    org_b = OrganizationModel(id=org_b_id, name="Tenant B Org", slug=org_b_id.lower(), is_active=True)
    db.add(org)
    db.add(org_b)

    # Core agents in Org A
    agents = [
        AgentModel(id=f"agent_ceo_{org_id}", name="CEO", role="Chief Executive Officer", organization_id=org_id, status="idle", behavioral_state="IDLE"),
        AgentModel(id=f"agent_res_{org_id}", name="Researcher", role="Research Specialist", organization_id=org_id, status="idle", behavioral_state="IDLE"),
        AgentModel(id=f"agent_wri_{org_id}", name="Writer", role="Content Writer", organization_id=org_id, status="idle", behavioral_state="IDLE"),
    ]
    # Agent in Org B for tenant isolation tests
    agent_b = AgentModel(id=f"agent_b_{org_b_id}", name="Agent B", role="General Agent", organization_id=org_b_id, status="idle", behavioral_state="IDLE")

    for ag in agents + [agent_b]:
        db.add(ag)
    db.commit()

    yield {
        "db": db,
        "org_id": org_id,
        "org_b_id": org_b_id,
        "ceo_id": f"agent_ceo_{org_id}",
        "res_id": f"agent_res_{org_id}",
        "wri_id": f"agent_wri_{org_id}",
        "b_agent_id": f"agent_b_{org_b_id}",
    }

    try:
        db.query(AgentEventModel).filter(AgentEventModel.organization_id.in_([org_id, org_b_id])).delete(synchronize_session=False)
        db.query(TaskModel).filter(TaskModel.organization_id.in_([org_id, org_b_id])).delete(synchronize_session=False)
        db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.organization_id.in_([org_id, org_b_id])).delete(synchronize_session=False)
        db.query(AgentModel).filter(AgentModel.organization_id.in_([org_id, org_b_id])).delete(synchronize_session=False)
        db.query(OrganizationModel).filter(OrganizationModel.id.in_([org_id, org_b_id])).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def test_1_task_lifecycle_explicit_valid_transitions(org_test_setup):
    """1. Verifies explicit valid state transition flow: CREATED -> READY -> ASSIGNED -> QUEUED -> IN_PROGRESS -> REVIEW -> COMPLETED."""
    db = org_test_setup["db"]
    org_id = org_test_setup["org_id"]
    agent_id = org_test_setup["res_id"]

    task = TaskModel(
        id=f"task-cycle-{uuid.uuid4().hex[:8]}",
        organization_id=org_id,
        title="Test Lifecycle Progression",
        description="Verify valid transitions",
        assigned_agent_id=agent_id,
        status="created",
    )
    db.add(task)
    db.commit()

    # CREATED -> READY
    task = task_lifecycle_engine.transition(db, task, TaskStatus.READY, reason="Inputs prepared")
    assert task.status == "ready"

    # READY -> ASSIGNED
    task = task_lifecycle_engine.transition(db, task, TaskStatus.ASSIGNED, reason="Specialist matched")
    assert task.status == "assigned"

    # ASSIGNED -> QUEUED
    task = task_lifecycle_engine.transition(db, task, TaskStatus.QUEUED, reason="Enqueued in execution backlog")
    assert task.status == "queued"

    # QUEUED -> IN_PROGRESS
    task = task_lifecycle_engine.transition(db, task, TaskStatus.IN_PROGRESS, reason="Execution commenced")
    assert task.status == "in_progress"
    assert task.started_at is not None

    # IN_PROGRESS -> REVIEW
    task = task_lifecycle_engine.transition(db, task, TaskStatus.REVIEW, reason="Deliverable submitted for review")
    assert task.status == "review"

    # REVIEW -> COMPLETED (with verified deliverable)
    deliv = StructuredDeliverable(
        task_id=task.id,
        agent_id=agent_id,
        organization_id=org_id,
        execution_id="exec_001",
        objective=task.title,
        result_summary="Verified execution completed successfully",
        verification_status="VERIFIED",
    )
    task = task_lifecycle_engine.transition(db, task, TaskStatus.COMPLETED, deliverable=deliv, result_summary=deliv.result_summary)
    assert task.status == "completed"
    assert task.completed_at is not None
    assert task.output_data_json["deliverable"]["verification_status"] == "VERIFIED"


def test_2_invalid_state_transitions_rejected(org_test_setup):
    """2. Verifies illegal transitions (e.g. COMPLETED -> IN_PROGRESS, CANCELLED -> COMPLETED) are strictly rejected."""
    db = org_test_setup["db"]
    org_id = org_test_setup["org_id"]
    agent_id = org_test_setup["res_id"]

    task = TaskModel(
        id=f"task-invalid-{uuid.uuid4().hex[:8]}",
        organization_id=org_id,
        title="Test Invalid Transition",
        description="Verify transition guardrails",
        assigned_agent_id=agent_id,
        status="completed",
        completed_at=datetime.utcnow(),
    )
    db.add(task)
    db.commit()

    # Attempt illegal transition: COMPLETED -> IN_PROGRESS
    with pytest.raises(InvalidTaskTransitionError) as exc_info:
        task_lifecycle_engine.transition(db, task, TaskStatus.IN_PROGRESS, reason="Illegal resume attempt")
    assert "Invalid task transition from 'completed' to 'in_progress'" in str(exc_info.value)

    # Cancelled task terminal check
    task.status = "cancelled"
    db.commit()
    with pytest.raises(InvalidTaskTransitionError) as exc_info:
        task_lifecycle_engine.transition(db, task, TaskStatus.COMPLETED, reason="Illegal revival")
    assert "Invalid task transition from 'cancelled' to 'completed'" in str(exc_info.value)


def test_3_deliverable_verification_required_for_completion(org_test_setup):
    """3. Verifies that a task CANNOT transition to COMPLETED without deliverable verification."""
    db = org_test_setup["db"]
    org_id = org_test_setup["org_id"]
    agent_id = org_test_setup["res_id"]

    task = TaskModel(
        id=f"task-unverified-{uuid.uuid4().hex[:8]}",
        organization_id=org_id,
        title="Unverified Task",
        description="Cannot complete without verified deliverable",
        assigned_agent_id=agent_id,
        status="in_progress",
        started_at=datetime.utcnow(),
    )
    db.add(task)
    db.commit()

    # Attempt completion without deliverable or verified summary
    with pytest.raises(DeliverableNotVerifiedError) as exc_info:
        task_lifecycle_engine.transition(db, task, TaskStatus.COMPLETED, reason="Premature completion")
    assert "cannot transition to COMPLETED without deliverable verification" in str(exc_info.value)


def test_4_specialist_capability_and_workload_matching(org_test_setup):
    """4. Verifies capability-aware specialist matching factoring tool permissions, skills, and current workload."""
    db = org_test_setup["db"]
    org_id = org_test_setup["org_id"]
    res_id = org_test_setup["res_id"]
    wri_id = org_test_setup["wri_id"]

    # Assign 2 active tasks to researcher to increase its workload
    for i in range(2):
        t = TaskModel(
            id=f"task-load-{i}-{uuid.uuid4().hex[:6]}",
            organization_id=org_id,
            title=f"Background Load Task {i}",
            description="Testing workload",
            assigned_agent_id=res_id,
            status="in_progress",
        )
        db.add(t)
    db.commit()

    # Profile check
    res_prof = specialist_workload_manager.get_agent_workload(db, res_id, org_id)
    assert res_prof.active_task_count == 2

    # Query for writer specialist: should select wri_id
    matched_writer = specialist_workload_manager.find_best_specialist(
        db=db,
        organization_id=org_id,
        required_agent_type="writer",
        required_permission_level=0,
    )
    assert matched_writer is not None
    assert matched_writer.id == wri_id


def test_5_retry_manager_exponential_backoff_and_classification(org_test_setup):
    """5. Verifies RetryManager differentiates retryable vs non-retryable errors and computes exponential backoff."""
    org_id = org_test_setup["org_id"]
    agent_id = org_test_setup["res_id"]

    task = TaskModel(
        id=f"task-retry-{uuid.uuid4().hex[:8]}",
        organization_id=org_id,
        title="Retry Evaluation Task",
        description="Testing retry logic",
        assigned_agent_id=agent_id,
        status="in_progress",
        retry_count=0,
        max_retries=2,
    )

    # 1. Non-retryable error test (e.g. ValidationError)
    decision_non = retry_manager.evaluate_retry(task, error=ValidationError("Illegal schema format"))
    assert decision_non.should_retry is False
    assert "Non-retryable" in decision_non.reason

    # 2. Retryable transient error test (e.g. Timeout/Network error)
    decision_retry = retry_manager.evaluate_retry(task, error_message="HTTP 503 Upstream Gateway Timeout")
    assert decision_retry.should_retry is True
    assert decision_retry.next_retry_count == 1
    assert decision_retry.backoff_seconds == 0.5  # 0.5 * 2^0

    # Record retry attempt
    retry_manager.record_retry_attempt(task, decision_retry, "HTTP 503 Upstream Gateway Timeout")
    assert task.retry_count == 1
    assert len(task.output_data_json["retry_history"]) == 1

    # Second retry attempt
    decision_retry_2 = retry_manager.evaluate_retry(task, error_message="HTTP 503 Service Unavailable")
    assert decision_retry_2.should_retry is True
    assert decision_retry_2.next_retry_count == 2
    assert decision_retry_2.backoff_seconds == 1.0  # 0.5 * 2^1
    retry_manager.record_retry_attempt(task, decision_retry_2, "HTTP 503 Service Unavailable")

    # Third retry attempt (exceeds max_retries=2)
    decision_exhausted = retry_manager.evaluate_retry(task, error_message="HTTP 503 Service Unavailable")
    assert decision_exhausted.should_retry is False
    assert "Exhausted maximum retry budget" in decision_exhausted.reason


def test_6_crash_recovery_preserves_completed_subtasks(org_test_setup):
    """6. Verifies crash recovery preserves completed workflow subtasks, re-queues retryable work, and frees agents."""
    db = org_test_setup["db"]
    org_id = org_test_setup["org_id"]
    ceo_id = org_test_setup["ceo_id"]
    res_id = org_test_setup["res_id"]
    wri_id = org_test_setup["wri_id"]

    # Create parent workflow
    wf_id = f"wf-crash-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="Crash Test Workflow",
        description="Testing recovery preservation",
        assigned_agent_id=ceo_id,
        status="running",
    )
    # Subtask 1: COMPLETED
    st1 = TaskModel(
        id=f"st-done-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_id,
        organization_id=org_id,
        task_type="subtask",
        title="Completed Subtask",
        description="Done",
        assigned_agent_id=res_id,
        status="completed",
        result_summary="Completed successfully prior to crash",
    )
    # Subtask 2: RUNNING (interrupted by server restart)
    st2 = TaskModel(
        id=f"st-interrupted-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_id,
        organization_id=org_id,
        task_type="subtask",
        title="Interrupted Subtask",
        description="Interrupted",
        assigned_agent_id=wri_id,
        status="running",
        retry_count=0,
        max_retries=2,
    )
    db.add(wf)
    db.add(st1)
    db.add(st2)

    # Set agents to working
    ag_res = db.query(AgentModel).filter(AgentModel.id == res_id).first()
    ag_wri = db.query(AgentModel).filter(AgentModel.id == wri_id).first()
    ag_res.status = "working"
    ag_res.behavioral_state = "WORKING"
    ag_wri.status = "working"
    ag_wri.behavioral_state = "WORKING"
    ag_wri.current_task_id = st2.id
    db.commit()

    # Run crash recovery
    recovered_count = recover_abandoned_tasks(db, auto_retry=True)
    assert recovered_count >= 1

    db.expire_all()
    # Check that completed subtask is PRESERVED
    st1_check = db.query(TaskModel).filter(TaskModel.id == st1.id).first()
    assert st1_check.status == "completed"

    # Check that interrupted subtask is RE-QUEUED for retry
    st2_check = db.query(TaskModel).filter(TaskModel.id == st2.id).first()
    assert st2_check.status == "queued"
    assert st2_check.retry_count == 1

    # Check that parent workflow is re-queued to resume
    wf_check = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert wf_check.status == "queued"

    # Check that agents are safely reconciled to IDLE
    ag_wri_check = db.query(AgentModel).filter(AgentModel.id == wri_id).first()
    assert ag_wri_check.status == "idle"
    assert ag_wri_check.behavioral_state == "IDLE"


def test_7_stale_lease_detection_and_reclamation(org_test_setup):
    """7. Verifies that stale execution leases are detected and reclaimed after timeout."""
    db = org_test_setup["db"]
    org_id = org_test_setup["org_id"]
    agent_id = org_test_setup["res_id"]

    # Create task with stale updated_at timestamp (10 minutes ago)
    stale_time = datetime(2020, 1, 1, 0, 0, 0)
    task = TaskModel(
        id=f"task-stale-{uuid.uuid4().hex[:8]}",
        organization_id=org_id,
        title="Stale Leased Task",
        description="Testing lease timeout",
        assigned_agent_id=agent_id,
        status="running",
        retry_count=0,
        max_retries=2,
        updated_at=stale_time,
    )
    db.add(task)
    db.commit()

    reclaimed = detect_and_reclaim_stale_leases(db, lease_timeout_seconds=300.0)
    assert reclaimed >= 1

    db.refresh(task)
    assert task.status == "queued"
    assert task.retry_count == 1


def test_8_submission_idempotency_prevents_duplicate_tasks(org_test_setup):
    """8. Verifies task submission idempotency prevents duplicate task creation."""
    db = org_test_setup["db"]
    org_id = org_test_setup["org_id"]
    agent_id = org_test_setup["res_id"]
    fixed_id = f"task-idempotent-{uuid.uuid4().hex[:8]}"

    from backend.app.schemas.task import TaskCreate
    task_in = TaskCreate(
        id=fixed_id,
        title="Idempotent Mission",
        description="Testing idempotency duplicate submission",
        assigned_agent_id=agent_id,
        priority="normal",
    )

    # First submission
    task1 = task_service.create_task(db, task_in, organization_id=org_id)
    assert task1.id == fixed_id

    # Duplicate submission with same ID
    task2 = task_service.create_task(db, task_in, organization_id=org_id)
    assert task2.id == fixed_id

    # Confirm only 1 record exists in DB
    count = db.query(TaskModel).filter(TaskModel.id == fixed_id).count()
    assert count == 1


def test_9_multi_tenant_isolation_enforcement(org_test_setup):
    """9. Verifies cross-tenant boundaries prevent tenant A from reading or modifying tenant B tasks/deliverables."""
    db = org_test_setup["db"]
    org_a = org_test_setup["org_id"]
    org_b = org_test_setup["org_b_id"]
    agent_a = org_test_setup["res_id"]
    agent_b = org_test_setup["b_agent_id"]

    task_b = TaskModel(
        id=f"task-tenant-b-{uuid.uuid4().hex[:8]}",
        organization_id=org_b,
        title="Tenant B Secret Task",
        description="Proprietary data",
        assigned_agent_id=agent_b,
        status="completed",
        output_data_json={
            "deliverable": {
                "deliverable_id": "deliv_b_001",
                "result_summary": "Tenant B Proprietary Output",
                "verification_status": "VERIFIED",
            }
        },
    )
    db.add(task_b)
    db.commit()

    # Tenant A attempts to access Tenant B's task -> must raise NotFoundError
    from backend.app.core.errors import NotFoundError
    with pytest.raises(NotFoundError):
        task_service.get_task_by_id(db, task_b.id, organization_id=org_a)

    with pytest.raises(NotFoundError):
        task_service.get_task_deliverable(db, task_b.id, organization_id=org_a)

    # Tenant A attempts cross-tenant assignment
    from backend.app.schemas.task import TaskCreate
    cross_in = TaskCreate(
        title="Cross Tenant Attempt",
        description="Assigned to agent in Org B",
        assigned_agent_id=agent_b,  # Belongs to Org B
    )
    with pytest.raises(ValidationError) as cross_err:
        task_service.create_task(db, cross_in, organization_id=org_a)
    assert "Cross-tenant assignment denied" in str(cross_err.value)


@pytest.mark.asyncio
async def test_10_concurrent_independent_subtasks_execution(org_test_setup):
    """10. Verifies MultiAgentOrchestrator executes independent subtasks concurrently without deadlock."""
    db = org_test_setup["db"]
    org_id = org_test_setup["org_id"]
    ceo_id = org_test_setup["ceo_id"]
    res_id = org_test_setup["res_id"]
    wri_id = org_test_setup["wri_id"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-concurrent-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="Concurrent Independence Test",
        description="Two independent subtasks executed simultaneously",
        assigned_agent_id=ceo_id,
        status="queued",
    )
    # Subtask A (independent)
    st_a = TaskModel(
        id=f"st-indep-a-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_id,
        organization_id=org_id,
        task_type="subtask",
        agent_type="research",
        assigned_agent_id=res_id,
        title="Independent Task A",
        description="Executes without dependencies",
        status="queued",
        dependencies_json=[],
        input_data_json={"subtask_key": "task_a"},
    )
    # Subtask B (independent)
    st_b = TaskModel(
        id=f"st-indep-b-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_id,
        organization_id=org_id,
        task_type="subtask",
        agent_type="writer",
        assigned_agent_id=wri_id,
        title="Independent Task B",
        description="Executes without dependencies",
        status="queued",
        dependencies_json=[],
        input_data_json={"subtask_key": "task_b"},
    )
    db.add(wf)
    db.add(st_a)
    db.add(st_b)
    db.commit()

    token = CancellationToken()
    # Execute workflow through orchestrator
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db)

    db.expire_all()
    final_wf = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    subtasks = db.query(TaskModel).filter(TaskModel.parent_task_id == wf_id).all()

    assert final_wf.status == "completed"
    assert len(subtasks) == 2
    assert all(st.status == "completed" for st in subtasks)


def test_11_event_persistence_and_monotonicity(org_test_setup):
    """11. Verifies that lifecycle and deliverable operational events are persisted with monotonic sequence IDs."""
    db = org_test_setup["db"]
    org_id = org_test_setup["org_id"]
    agent_id = org_test_setup["res_id"]

    ev1 = event_service.create_event(
        db=db,
        event_type="specialist.assigned",
        agent_id=agent_id,
        organization_id=org_id,
        payload={"role": "Research Specialist"},
    )
    ev2 = event_service.create_event(
        db=db,
        event_type="deliverable.submitted",
        agent_id=agent_id,
        organization_id=org_id,
        payload={"deliverable_id": "deliv_001"},
    )
    ev3 = event_service.create_event(
        db=db,
        event_type="ceo.review_completed",
        agent_id=agent_id,
        organization_id=org_id,
        payload={"verdict": "APPROVED"},
    )

    assert ev1.sequence_id is not None
    assert ev2.sequence_id is not None
    assert ev3.sequence_id is not None
    assert ev1.sequence_id < ev2.sequence_id < ev3.sequence_id

