import uuid
import pytest
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

from backend.app.core.database import SessionLocal
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.services.event_service import event_service


@pytest.fixture(scope="function")
def event_env():
    db = SessionLocal()
    org_a = f"org_ev_a_{uuid.uuid4().hex[:6]}"
    org_b = f"org_ev_b_{uuid.uuid4().hex[:6]}"

    db.add(OrganizationModel(id=org_a, name="Event Org A", slug=org_a.lower(), is_active=True))
    db.add(OrganizationModel(id=org_b, name="Event Org B", slug=org_b.lower(), is_active=True))

    ag_a_id = f"ag_ev_a_{uuid.uuid4().hex[:6]}"
    ag_b_id = f"ag_ev_b_{uuid.uuid4().hex[:6]}"
    db.add(AgentModel(id=ag_a_id, name="Agent Ev A", role="analyst", status="idle", organization_id=org_a))
    db.add(AgentModel(id=ag_b_id, name="Agent Ev B", role="analyst", status="idle", organization_id=org_b))

    t_a_id = f"t_ev_a_{uuid.uuid4().hex[:6]}"
    t_b_id = f"t_ev_b_{uuid.uuid4().hex[:6]}"
    db.add(TaskModel(id=t_a_id, title="Task Ev A", description="Desc A", status="queued", assigned_agent_id=ag_a_id, organization_id=org_a))
    db.add(TaskModel(id=t_b_id, title="Task Ev B", description="Desc B", status="queued", assigned_agent_id=ag_b_id, organization_id=org_b))

    db.commit()

    yield {
        "org_a": org_a,
        "org_b": org_b,
        "ag_a": ag_a_id,
        "ag_b": ag_b_id,
        "t_a": t_a_id,
        "t_b": t_b_id,
        "db": db,
    }

    cleanup_db = SessionLocal()
    try:
        cleanup_db.query(AgentEventModel).filter(AgentEventModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(TaskModel).filter(TaskModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(AgentModel).filter(AgentModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(OrganizationModel).filter(OrganizationModel.id.in_([org_a, org_b])).delete()
        cleanup_db.commit()
    except Exception:
        pass
    finally:
        cleanup_db.close()
    db.close()


def test_3_5_7_01_event_schema_adherence(event_env):
    """Scenario 1: Event envelope strictly conforms to Milestone 5 schema specification."""
    db = event_env["db"]
    ev = event_service.create_event(
        db=db,
        event_type="task.started",
        agent_id=event_env["ag_a"],
        task_id=event_env["t_a"],
        organization_id=event_env["org_a"],
        payload={"step": 1, "note": "Executing market research"},
    )
    envelope = ev.to_envelope()

    assert envelope["schema_version"] == 1
    assert envelope["event_id"] == ev.id
    assert envelope["event_type"] == "task.started"
    assert envelope["occurred_at"].endswith("Z")
    assert isinstance(envelope["sequence_id"], int)
    assert envelope["sequence_id"] > 0
    assert envelope["agent_id"] == event_env["ag_a"]
    assert envelope["task_id"] == event_env["t_a"]
    assert envelope["organization_id"] == event_env["org_a"]
    assert envelope["payload"]["step"] == 1


def test_3_5_7_02_correlation_and_causation_id_propagation(event_env):
    """Scenario 2: Causation and correlation IDs propagate through multi-step agent flow."""
    db = event_env["db"]
    root_task_id = event_env["t_a"]

    # 1. Root task event
    e1 = event_service.create_event(
        db=db,
        event_type="task.created",
        task_id=root_task_id,
        organization_id=event_env["org_a"],
        correlation_id=root_task_id,
        causation_id=None,
    )
    env1 = e1.to_envelope()
    assert env1["correlation_id"] == root_task_id
    assert env1["causation_id"] == e1.id

    # 2. Subtask assignment caused by root event
    e2 = event_service.create_event(
        db=db,
        event_type="subtask.assigned",
        agent_id=event_env["ag_a"],
        task_id=root_task_id,
        organization_id=event_env["org_a"],
        correlation_id=root_task_id,
        causation_id=e1.id,
    )
    env2 = e2.to_envelope()
    assert env2["correlation_id"] == root_task_id
    assert env2["causation_id"] == e1.id

    # 3. Tool execution caused by subtask assignment
    e3 = event_service.create_event(
        db=db,
        event_type="tool.execution_completed",
        agent_id=event_env["ag_a"],
        task_id=root_task_id,
        organization_id=event_env["org_a"],
        correlation_id=root_task_id,
        causation_id=e2.id,
        payload={"tool_name": "web_search", "result": "found data"},
    )
    env3 = e3.to_envelope()
    assert env3["correlation_id"] == root_task_id
    assert env3["causation_id"] == e2.id


def test_3_5_7_03_snapshot_and_replay_reconciliation(event_env):
    """Scenario 3: Initial snapshot watermark + replay reproduces identical final state."""
    db = event_env["db"]
    org = event_env["org_a"]

    # Build snapshot before work begins
    snapshot = event_service.build_initial_snapshot(db=db, organization_id=org)
    watermark = snapshot["last_sequence_id"]

    # Emit series of state transition events
    ev1 = event_service.create_event(db=db, event_type="task.started", agent_id=event_env["ag_a"], task_id=event_env["t_a"], organization_id=org)
    ev2 = event_service.create_event(db=db, event_type="task.completed", agent_id=event_env["ag_a"], task_id=event_env["t_a"], organization_id=org)

    # Replay events strictly after snapshot watermark
    missed_events = event_service.get_events_after(db=db, organization_id=org, last_sequence_id=watermark)
    missed_types = [m.event_type for m in missed_events]

    assert "task.started" in missed_types
    assert "task.completed" in missed_types
    assert all(m.sequence_id > watermark for m in missed_events)


def test_3_5_7_04_event_sourced_state_projection(event_env):
    """Scenario 4: Replaying task events projects exact task lifecycle state."""
    db = event_env["db"]
    t_id = event_env["t_a"]
    ag_id = event_env["ag_a"]
    org = event_env["org_a"]

    # Sequence of lifecycle events
    event_service.create_event(db=db, event_type="task.created", task_id=t_id, organization_id=org)
    event_service.create_event(db=db, event_type="task.assigned", task_id=t_id, agent_id=ag_id, organization_id=org)
    event_service.create_event(db=db, event_type="task.started", task_id=t_id, agent_id=ag_id, organization_id=org)
    event_service.create_event(db=db, event_type="task.step.completed", task_id=t_id, agent_id=ag_id, organization_id=org)
    event_service.create_event(db=db, event_type="tool.execution_completed", task_id=t_id, agent_id=ag_id, organization_id=org, payload={"tool_name": "market_research"})
    event_service.create_event(db=db, event_type="artifact.created", task_id=t_id, agent_id=ag_id, organization_id=org, payload={"artifact_id": "art-market-report"})
    event_service.create_event(db=db, event_type="deliverable.verified", task_id=t_id, agent_id=ag_id, organization_id=org)
    event_service.create_event(db=db, event_type="task.completed", task_id=t_id, agent_id=ag_id, organization_id=org)

    # Project state from immutable event stream
    projected = event_service.replay_task_events(db=db, task_id=t_id)

    assert projected["task_id"] == t_id
    assert projected["status"] == "completed"
    assert projected["assigned_agent_id"] == ag_id
    assert projected["steps_count"] == 1
    assert "market_research" in projected["tools_executed"]
    assert "art-market-report" in projected["artifacts_created"]
    assert projected["deliverable_verified"] is True


def test_3_5_7_05_sequence_gap_detection(event_env):
    """Scenario 5: Sequence gap detector correctly identifies missing event IDs."""
    # Test contiguous stream
    contiguous = [
        AgentEventModel(sequence_id=10),
        AgentEventModel(sequence_id=11),
        AgentEventModel(sequence_id=12),
        AgentEventModel(sequence_id=13),
    ]
    assert event_service.detect_sequence_gaps(contiguous) == []

    # Test gapped stream (missing 14, 15 and 18, 19, 20)
    gapped = [
        AgentEventModel(sequence_id=13),
        AgentEventModel(sequence_id=16),
        AgentEventModel(sequence_id=17),
        AgentEventModel(sequence_id=21),
    ]
    gaps = event_service.detect_sequence_gaps(gapped)
    assert gaps == [(14, 15), (18, 20)]


def test_3_5_7_06_transactional_outbox_atomicity(event_env):
    """Scenario 6: Transactional outbox commits or rolls back event atomically with state changes."""
    db = event_env["db"]
    t_id = event_env["t_a"]
    org = event_env["org_a"]

    # 1. Failed transaction (e.g. crash before commit)
    try:
        task = db.query(TaskModel).filter(TaskModel.id == t_id).first()
        task.status = "running"
        # Create event with commit=False (same transaction)
        event_service.create_event(
            db=db,
            event_type="task.started",
            task_id=t_id,
            organization_id=org,
            commit=False,
        )
        # Simulate worker crash / unhandled error
        raise RuntimeError("Simulated crash before commit")
    except RuntimeError:
        db.rollback()

    # Verify both task mutation and event were rolled back
    reloaded_task = db.query(TaskModel).filter(TaskModel.id == t_id).first()
    assert reloaded_task.status == "queued"
    ev_count = db.query(AgentEventModel).filter(AgentEventModel.task_id == t_id, AgentEventModel.event_type == "task.started").count()
    assert ev_count == 0

    # 2. Successful transaction
    task.status = "running"
    event_service.create_event(
        db=db,
        event_type="task.started",
        task_id=t_id,
        organization_id=org,
        commit=False,
    )
    db.commit()

    # Verify both are persisted
    assert db.query(TaskModel).filter(TaskModel.id == t_id).first().status == "running"
    assert db.query(AgentEventModel).filter(AgentEventModel.task_id == t_id, AgentEventModel.event_type == "task.started").count() == 1


def test_3_5_7_07_idempotent_event_submission(event_env):
    """Scenario 7: Re-submitting the same event_id is idempotent with zero duplicates."""
    db = event_env["db"]
    fixed_event_id = f"evt_idempotent_{uuid.uuid4().hex[:8]}"

    ev1 = event_service.create_event(
        db=db,
        event_type="task.started",
        task_id=event_env["t_a"],
        organization_id=event_env["org_a"],
        event_id=fixed_event_id,
        payload={"attempt": 1},
    )

    ev2 = event_service.create_event(
        db=db,
        event_type="task.started",
        task_id=event_env["t_a"],
        organization_id=event_env["org_a"],
        event_id=fixed_event_id,
        payload={"attempt": 2},
    )

    assert ev1.id == ev2.id
    assert ev1.sequence_id == ev2.sequence_id

    # Verify database has exactly 1 row
    count = db.query(AgentEventModel).filter(AgentEventModel.id == fixed_event_id).count()
    assert count == 1


def test_3_5_7_08_multitenant_event_isolation_and_replay(event_env):
    """Scenario 8: Replay stream for Org A never leaks Org B events."""
    db = event_env["db"]
    org_a = event_env["org_a"]
    org_b = event_env["org_b"]

    base_seq = db.query(AgentEventModel.sequence_id).order_by(AgentEventModel.sequence_id.desc()).first()
    start_seq = (base_seq[0] if base_seq else 0)

    # Interleave events from both orgs
    event_service.create_event(db=db, event_type="task.started", task_id=event_env["t_a"], organization_id=org_a)
    event_service.create_event(db=db, event_type="task.started", task_id=event_env["t_b"], organization_id=org_b)
    event_service.create_event(db=db, event_type="task.completed", task_id=event_env["t_a"], organization_id=org_a)
    event_service.create_event(db=db, event_type="task.completed", task_id=event_env["t_b"], organization_id=org_b)

    # Fetch events for Org A only
    events_a = event_service.get_events_after(db=db, organization_id=org_a, last_sequence_id=start_seq)
    for ev in events_a:
        assert ev.organization_id == org_a
        assert ev.task_id == event_env["t_a"]

    # Fetch events for Org B only
    events_b = event_service.get_events_after(db=db, organization_id=org_b, last_sequence_id=start_seq)
    for ev in events_b:
        assert ev.organization_id == org_b
        assert ev.task_id == event_env["t_b"]


def test_3_5_7_09_watermark_boundary_guarantee(event_env):
    """Scenario 9: Snapshot watermark ensures zero event loss during connection handover."""
    db = event_env["db"]
    org = event_env["org_a"]

    # 1. Client connects and fetches initial snapshot
    snapshot = event_service.build_initial_snapshot(db=db, organization_id=org)
    watermark = snapshot["last_sequence_id"]

    # 2. Server creates event while client is processing snapshot
    new_ev = event_service.create_event(
        db=db,
        event_type="agent.status_changed",
        agent_id=event_env["ag_a"],
        organization_id=org,
        payload={"status": "busy"},
    )

    # 3. Client queries catch-up stream starting from watermark
    replay = event_service.get_events_after(db=db, organization_id=org, last_sequence_id=watermark)
    assert any(e.id == new_ev.id for e in replay)


def test_3_5_7_10_high_volume_event_sequencing(event_env):
    """Scenario 10: High-concurrency event generation produces strictly monotonic sequence IDs."""
    org = event_env["org_a"]
    t_id = event_env["t_a"]
    ag_id = event_env["ag_a"]

    def emit_event(i):
        local_db = SessionLocal()
        try:
            ev = event_service.create_event(
                db=local_db,
                event_type="agent.movement_progress",
                agent_id=ag_id,
                task_id=t_id,
                organization_id=org,
                payload={"tick": i},
            )
            return ev.sequence_id
        finally:
            local_db.close()

    with ThreadPoolExecutor(max_workers=5) as executor:
        sequence_ids = list(executor.map(emit_event, range(30)))

    # Verify all sequence IDs are unique and strictly monotonic
    assert len(sequence_ids) == 30
    assert len(set(sequence_ids)) == 30
    sorted_seqs = sorted(sequence_ids)
    for i in range(len(sorted_seqs) - 1):
        assert sorted_seqs[i + 1] == sorted_seqs[i] + 1
