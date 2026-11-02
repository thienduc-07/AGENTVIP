import uuid
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from backend.app.core.database import SessionLocal
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.task_step import TaskStepModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.agent_runtime.lifecycle.task_lifecycle import (
    task_lifecycle_engine,
    TaskStatus,
    InvalidTaskTransitionError,
)
from backend.app.agent_runtime.cancellation import (
    CancellationToken,
    TaskPausedException,
    TaskCancelledException,
)
from backend.app.agent_runtime.dispatcher.dispatcher import task_dispatcher
from backend.app.agent_runtime.dispatcher.crash_recovery import recover_abandoned_tasks
from backend.app.agent_runtime import agent_runtime


def test_pause_queued_task_lifecycle(auth_client, seed_test_agent, db_session):
    """Test pausing a queued task via REST API."""
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Queued Task To Pause",
        "description": "Testing pause on queued task",
        "assigned_agent_id": seed_test_agent.id,
        "priority": "normal"
    })
    assert create_res.status_code == 201
    task_id = create_res.json()["id"]

    # Pause the task
    pause_res = auth_client.post(
        f"/api/v1/tasks/{task_id}/pause",
        json={"reason": "Operator paused for inspection"}
    )
    assert pause_res.status_code == 200
    pdata = pause_res.json()
    assert pdata["id"] == task_id
    assert pdata["status"] == "paused"
    assert pdata["is_paused"] is True
    assert pdata["message"] == "Task successfully paused"
    assert "paused_at" in pdata

    # Verify task in DB
    db_session.expire_all()
    task = db_session.query(TaskModel).filter(TaskModel.id == task_id).first()
    assert task is not None
    assert task.status == "paused"
    assert task.output_data_json is not None
    assert "paused_at" in task.output_data_json
    assert task.output_data_json.get("pause_reason") == "Operator paused for inspection"

    # Verify audit event in DB
    ev = (
        db_session.query(AgentEventModel)
        .filter(AgentEventModel.task_id == task_id, AgentEventModel.event_type == "task.paused")
        .first()
    )
    assert ev is not None
    assert (ev.payload_json or {}).get("status") == "paused"


def test_pause_in_progress_task_releases_agent(auth_client, seed_test_agent, db_session):
    """Test pausing an active task frees the assigned agent and sets behavioral state to IDLE."""
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Active Task To Pause",
        "description": "Testing pause on active task",
        "assigned_agent_id": seed_test_agent.id,
        "priority": "high"
    })
    task_id = create_res.json()["id"]

    # Simulate task being actively worked on by agent
    task = db_session.query(TaskModel).filter(TaskModel.id == task_id).first()
    task.status = "in_progress"
    seed_test_agent.status = "working"
    seed_test_agent.behavioral_state = "WORKING"
    seed_test_agent.current_task_id = task.id
    db_session.commit()

    # Pause active task
    pause_res = auth_client.post(
        f"/api/v1/tasks/{task_id}/pause",
        json={"reason": "Human operator intervention"}
    )
    assert pause_res.status_code == 200

    # Verify agent is released
    db_session.expire_all()
    agent = db_session.query(AgentModel).filter(AgentModel.id == seed_test_agent.id).first()
    assert agent.status == "idle"
    assert agent.behavioral_state == "IDLE"
    assert agent.current_task_id is None


def test_pause_idempotency(auth_client, seed_test_agent, db_session):
    """Calling pause on an already paused task returns 200 idempotently."""
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Double Pause Task",
        "description": "Verify idempotency",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    # First pause
    res1 = auth_client.post(f"/api/v1/tasks/{task_id}/pause")
    assert res1.status_code == 200
    assert res1.json()["status"] == "paused"

    # Second pause must succeed idempotently
    res2 = auth_client.post(f"/api/v1/tasks/{task_id}/pause")
    assert res2.status_code == 200
    assert res2.json()["status"] == "paused"
    assert res2.json()["message"] == "Task is already paused"


def test_resume_paused_task_lifecycle(auth_client, seed_test_agent, db_session):
    """Test resuming a paused task injects operator guidance and transitions back to queued."""
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Task To Resume",
        "description": "Testing resume flow",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    # Pause first
    auth_client.post(f"/api/v1/tasks/{task_id}/pause")

    # Resume with guidance
    guidance_text = "Prioritize unit tests and verify all mock expectations."
    resume_res = auth_client.post(
        f"/api/v1/tasks/{task_id}/resume",
        json={"guidance": guidance_text}
    )
    assert resume_res.status_code == 200
    rdata = resume_res.json()
    assert rdata["id"] == task_id
    assert rdata["status"] == "queued"
    assert rdata["is_paused"] is False
    assert rdata["message"] == "Task successfully resumed"
    assert "resumed_at" in rdata

    # Verify task in DB
    db_session.expire_all()
    task = db_session.query(TaskModel).filter(TaskModel.id == task_id).first()
    assert task.status == "queued"
    assert task.output_data_json.get("operator_guidance") == guidance_text

    # Verify execution step injected
    step = (
        db_session.query(TaskStepModel)
        .filter(TaskStepModel.task_id == task_id, TaskStepModel.title == "Operator Guidance Injected")
        .first()
    )
    assert step is not None
    assert step.description == guidance_text

    # Verify audit event in DB
    ev = (
        db_session.query(AgentEventModel)
        .filter(AgentEventModel.task_id == task_id, AgentEventModel.event_type == "task.resumed")
        .first()
    )
    assert ev is not None
    assert (ev.payload_json or {}).get("guidance") == guidance_text


def test_cancel_while_paused(auth_client, seed_test_agent, db_session):
    """A paused task can be cancelled cleanly by human operator."""
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Pause Then Cancel",
        "description": "Verify cancel from paused state",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    # Pause first
    auth_client.post(f"/api/v1/tasks/{task_id}/pause")

    # Cancel
    cancel_res = auth_client.post(f"/api/v1/tasks/{task_id}/cancel")
    assert cancel_res.status_code == 200
    cdata = cancel_res.json()
    assert cdata["id"] == task_id
    assert cdata["status"] == "cancelled"

    # Verify DB
    db_session.expire_all()
    task = db_session.query(TaskModel).filter(TaskModel.id == task_id).first()
    assert task.status == "cancelled"


def test_cannot_resurrect_cancelled_task(auth_client, seed_test_agent, db_session):
    """A cancelled task cannot be resumed, paused, or transitioned to any other state."""
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Terminal Cancel Task",
        "description": "Verify resurrection prevention",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    # Cancel task
    auth_client.post(f"/api/v1/tasks/{task_id}/cancel")

    # Attempt to resume cancelled task -> must 409 Conflict
    resume_res = auth_client.post(f"/api/v1/tasks/{task_id}/resume")
    assert resume_res.status_code == 409
    assert resume_res.json()["error"]["code"] == "TASK_ALREADY_CANCELLED"

    # Attempt to pause cancelled task -> must 409 Conflict
    pause_res = auth_client.post(f"/api/v1/tasks/{task_id}/pause")
    assert pause_res.status_code == 409
    assert pause_res.json()["error"]["code"] == "TASK_ALREADY_CANCELLED"

    # Direct state machine check
    db_session.expire_all()
    task = db_session.query(TaskModel).filter(TaskModel.id == task_id).first()
    with pytest.raises(InvalidTaskTransitionError):
        task_lifecycle_engine.transition(db_session, task, TaskStatus.QUEUED)

    with pytest.raises(InvalidTaskTransitionError):
        task_lifecycle_engine.transition(db_session, task, TaskStatus.PAUSED)


def test_cannot_pause_completed_or_failed_task(auth_client, seed_test_agent, db_session):
    """Tasks in terminal states (completed or failed) cannot be paused."""
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Completed Task",
        "description": "Verify pause guard on completed task",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    task = db_session.query(TaskModel).filter(TaskModel.id == task_id).first()
    task.status = "completed"
    db_session.commit()

    pause_res = auth_client.post(f"/api/v1/tasks/{task_id}/pause")
    assert pause_res.status_code == 409
    assert pause_res.json()["error"]["code"] == "TASK_ALREADY_COMPLETED"

    # Test failed state
    task.status = "failed"
    db_session.commit()

    pause_res2 = auth_client.post(f"/api/v1/tasks/{task_id}/pause")
    assert pause_res2.status_code == 409
    assert pause_res2.json()["error"]["code"] == "TASK_ALREADY_FAILED"


def test_cannot_resume_non_paused_task(auth_client, seed_test_agent, db_session):
    """Only paused tasks can be resumed; active/queued tasks raise 409."""
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Queued Task Not Paused",
        "description": "Attempt to resume non-paused task",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    resume_res = auth_client.post(f"/api/v1/tasks/{task_id}/resume")
    assert resume_res.status_code == 409
    assert resume_res.json()["error"]["code"] == "TASK_NOT_PAUSED"


def test_active_worker_pause_interruption():
    """Verify active worker CancellationToken pause mechanism and exception raising."""
    token = CancellationToken()
    task_id = f"test-pause-int-{uuid.uuid4().hex[:6]}"

    task_dispatcher._active_cancellations[task_id] = token
    try:
        assert not token.is_paused
        assert not token.is_cancelled

        # Signal pause via runtime
        signaled = agent_runtime.pause_task(task_id, reason="Operator paused execution")
        assert signaled is True
        assert token.is_paused is True
        assert "Operator paused execution" in token.reason

        # Next check() raises TaskPausedException
        with pytest.raises(TaskPausedException) as exc_info:
            token.check()
        assert "Operator paused execution" in str(exc_info.value)
    finally:
        task_dispatcher._active_cancellations.pop(task_id, None)


def test_dispatcher_ignores_paused_and_cancelled_tasks(seed_test_agent, db_session):
    """TaskDispatcher._claim_next_task() must strictly ignore paused and cancelled tasks."""
    org_id = "org_default_company"

    paused_id = f"t-paused-{uuid.uuid4().hex[:6]}"
    cancelled_id = f"t-cancelled-{uuid.uuid4().hex[:6]}"

    # Create paused task
    t_paused = TaskModel(
        id=paused_id,
        title="Paused Task",
        description="Must be ignored by dispatcher",
        status="paused",
        assigned_agent_id=seed_test_agent.id,
        organization_id=org_id,
    )
    # Create cancelled task
    t_cancelled = TaskModel(
        id=cancelled_id,
        title="Cancelled Task",
        description="Must be ignored by dispatcher",
        status="cancelled",
        assigned_agent_id=seed_test_agent.id,
        organization_id=org_id,
    )
    db_session.add(t_paused)
    db_session.add(t_cancelled)
    db_session.commit()

    class NonClosingSession:
        def __init__(self, session):
            self._session = session
        def close(self):
            pass
        def __getattr__(self, name):
            return getattr(self._session, name)

    with patch("backend.app.agent_runtime.dispatcher.dispatcher.SessionLocal", side_effect=lambda: NonClosingSession(db_session)):
        claimed = task_dispatcher._claim_next_task()
        # The claimed task must not be either paused or cancelled
        assert claimed != paused_id
        assert claimed != cancelled_id

    # Now resume the paused task
    from backend.app.services.task_service import task_service
    task_service.resume_task(db_session, paused_id, guidance="Resume now", organization_id=org_id)
    db_session.expire_all()
    resumed_task = db_session.query(TaskModel).filter(TaskModel.id == paused_id).first()
    assert resumed_task.status == "queued"

    with patch("backend.app.agent_runtime.dispatcher.dispatcher.SessionLocal", side_effect=lambda: NonClosingSession(db_session)):
        claimed_after = task_dispatcher._claim_next_task()
        assert claimed_after == paused_id


def test_multi_tenant_isolation_on_pause_and_resume(auth_client, seed_test_agent, db_session):
    """Users cannot pause, resume, or cancel tasks belonging to another tenant."""
    # Create foreign organization
    foreign_org = OrganizationModel(
        id="org_foreign_corporation",
        name="Foreign Corporation",
        slug="foreign-corp",
        is_active=True
    )
    db_session.add(foreign_org)
    db_session.flush()

    foreign_agent = AgentModel(
        id="foreign-agent-01",
        name="Foreign Specialist",
        role="general",
        status="idle",
        organization_id=foreign_org.id
    )
    db_session.add(foreign_agent)
    db_session.flush()

    foreign_task = TaskModel(
        id=f"t-foreign-{uuid.uuid4().hex[:6]}",
        title="Foreign Secret Task",
        description="Belongs strictly to Foreign Corporation",
        status="queued",
        assigned_agent_id=foreign_agent.id,
        organization_id=foreign_org.id
    )
    db_session.add(foreign_task)
    db_session.commit()

    # auth_client belongs to org_default_company
    # Attempt pause on foreign task -> 404
    pause_res = auth_client.post(f"/api/v1/tasks/{foreign_task.id}/pause")
    assert pause_res.status_code == 404
    assert pause_res.json()["error"]["code"] == "TASK_NOT_FOUND"

    # Attempt resume on foreign task -> 404
    resume_res = auth_client.post(f"/api/v1/tasks/{foreign_task.id}/resume")
    assert resume_res.status_code == 404
    assert resume_res.json()["error"]["code"] == "TASK_NOT_FOUND"

    # Attempt cancel on foreign task -> 404
    cancel_res = auth_client.post(f"/api/v1/tasks/{foreign_task.id}/cancel")
    assert cancel_res.status_code == 404
    assert cancel_res.json()["error"]["code"] == "TASK_NOT_FOUND"


def test_crash_recovery_preserves_paused_and_cancelled_tasks(seed_test_agent, db_session):
    """recover_abandoned_tasks must preserve paused and cancelled tasks intact without failing them."""
    org_id = "org_default_company"

    p_id = f"t-rec-paused-{uuid.uuid4().hex[:6]}"
    c_id = f"t-rec-canc-{uuid.uuid4().hex[:6]}"
    r_id = f"t-rec-run-{uuid.uuid4().hex[:6]}"

    t_paused = TaskModel(
        id=p_id,
        title="Paused Preserved",
        description="Must stay paused after crash recovery",
        status="paused",
        assigned_agent_id=seed_test_agent.id,
        organization_id=org_id,
        output_data_json={"step_state": {"step_index": 2}}
    )
    t_cancelled = TaskModel(
        id=c_id,
        title="Cancelled Preserved",
        description="Must stay cancelled after crash recovery",
        status="cancelled",
        assigned_agent_id=seed_test_agent.id,
        organization_id=org_id,
    )
    t_running = TaskModel(
        id=r_id,
        title="Interrupted Task",
        description="Abandoned mid-execution",
        status="running",
        assigned_agent_id=seed_test_agent.id,
        organization_id=org_id,
    )
    db_session.add_all([t_paused, t_cancelled, t_running])
    db_session.commit()

    # Execute crash recovery
    recovered = recover_abandoned_tasks(db_session)
    assert recovered >= 1

    # Verify paused and cancelled tasks were untouched
    db_session.expire_all()
    paused_db = db_session.query(TaskModel).filter(TaskModel.id == p_id).first()
    assert paused_db.status == "paused"
    assert paused_db.output_data_json.get("step_state", {}).get("step_index") == 2

    cancelled_db = db_session.query(TaskModel).filter(TaskModel.id == c_id).first()
    assert cancelled_db.status == "cancelled"

    # Running task should have been resolved (failed or re-queued)
    running_db = db_session.query(TaskModel).filter(TaskModel.id == r_id).first()
    assert running_db.status in ("queued", "failed")


def test_websocket_broadcast_on_pause_and_resume(auth_client, seed_test_agent, db_session):
    """Authoritative WebSocket events (task.paused, task.resumed) are emitted via ws_manager."""
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "WebSocket Sync Task",
        "description": "Verify envelope broadcast",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    with patch("backend.app.websocket_manager.ws_manager.broadcast_sync") as mock_broadcast:
        # Pause task
        auth_client.post(f"/api/v1/tasks/{task_id}/pause", json={"reason": "Testing WS envelope"})

        # Check broadcast was called with task.paused
        assert mock_broadcast.called
        envelopes = [call.args[0] for call in mock_broadcast.call_args_list]
        pause_envelopes = [e for e in envelopes if e.get("event_type") == "task.paused"]
        assert len(pause_envelopes) >= 1
        assert pause_envelopes[0]["task_id"] == task_id

    with patch("backend.app.websocket_manager.ws_manager.broadcast_sync") as mock_broadcast:
        # Resume task
        auth_client.post(f"/api/v1/tasks/{task_id}/resume", json={"guidance": "Resume with WS"})

        assert mock_broadcast.called
        envelopes = [call.args[0] for call in mock_broadcast.call_args_list]
        resume_envelopes = [e for e in envelopes if e.get("event_type") == "task.resumed"]
        assert len(resume_envelopes) >= 1
        assert resume_envelopes[0]["task_id"] == task_id


def test_pause_waiting_and_review_states(auth_client, seed_test_agent, db_session):
    """Tasks in WAITING and REVIEW states can also be paused by operator."""
    # Test WAITING
    t1 = TaskModel(
        id=f"t-wait-{uuid.uuid4().hex[:6]}",
        title="Waiting Task",
        description="Task waiting for event",
        status="waiting",
        assigned_agent_id=seed_test_agent.id,
        organization_id="org_default_company",
    )
    # Test REVIEW
    t2 = TaskModel(
        id=f"t-rev-{uuid.uuid4().hex[:6]}",
        title="Review Task",
        description="Task under executive review",
        status="review",
        assigned_agent_id=seed_test_agent.id,
        organization_id="org_default_company",
    )
    db_session.add_all([t1, t2])
    db_session.commit()

    res1 = auth_client.post(f"/api/v1/tasks/{t1.id}/pause")
    assert res1.status_code == 200
    assert res1.json()["status"] == "paused"

    res2 = auth_client.post(f"/api/v1/tasks/{t2.id}/pause")
    assert res2.status_code == 200
    assert res2.json()["status"] == "paused"


def test_resume_without_guidance(auth_client, seed_test_agent, db_session):
    """Resuming without guidance transitions back to queued cleanly without creating an empty guidance step."""
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Resume Without Guidance",
        "description": "Verify resume with empty/null guidance",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    auth_client.post(f"/api/v1/tasks/{task_id}/pause")
    resume_res = auth_client.post(f"/api/v1/tasks/{task_id}/resume", json={})
    assert resume_res.status_code == 200
    assert resume_res.json()["status"] == "queued"

    db_session.expire_all()
    task = db_session.query(TaskModel).filter(TaskModel.id == task_id).first()
    assert task.status == "queued"
    # No extra guidance step created
    steps = db_session.query(TaskStepModel).filter(TaskStepModel.task_id == task_id).all()
    assert len(steps) == 1  # only initial queued step


def test_list_tasks_filtering_by_paused_status(auth_client, seed_test_agent, db_session):
    """GET /api/v1/tasks?status=paused returns paused tasks."""
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Filter Paused Task",
        "description": "Test query filter",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    auth_client.post(f"/api/v1/tasks/{task_id}/pause")

    list_res = auth_client.get("/api/v1/tasks?status=paused")
    assert list_res.status_code == 200
    tasks = list_res.json()
    assert any(t["id"] == task_id and t["status"] == "paused" for t in tasks)

