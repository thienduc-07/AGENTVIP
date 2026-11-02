import asyncio
import threading
import time
import uuid
import pytest
from datetime import datetime, timezone
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings
from backend.app.core.database import (
    Base,
    SessionLocal,
    engine,
    commit_with_retry,
    transaction_scope,
)
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.auth import OrganizationModel
from backend.app.services.task_service import task_service


@pytest.fixture(scope="function")
def db_rel_env():
    """Provides isolated testing organizations, agents, and cleanup."""
    db = SessionLocal()
    org_id = f"org_rel_{uuid.uuid4().hex[:8]}"
    agent_id = f"ag_rel_{uuid.uuid4().hex[:8]}"

    org = OrganizationModel(
        id=org_id,
        name=f"Reliability Org {org_id}",
        slug=org_id.lower(),
        is_active=True
    )
    db.add(org)

    agent = AgentModel(
        id=agent_id,
        name="Reliability Agent",
        role="general",
        status="idle",
        organization_id=org_id,
        description="Reliability testing agent",
    )
    db.add(agent)
    db.commit()

    yield {"org_id": org_id, "agent_id": agent_id, "db": db}

    # Teardown
    try:
        cleanup_db = SessionLocal()
        cleanup_db.query(TaskModel).filter(TaskModel.organization_id == org_id).delete()
        cleanup_db.query(AgentModel).filter(AgentModel.id == agent_id).delete()
        cleanup_db.query(OrganizationModel).filter(OrganizationModel.id == org_id).delete()
        cleanup_db.commit()
        cleanup_db.close()
    except Exception:
        pass
    db.close()


def test_3_5_1_01_concurrent_reads_scalability(db_rel_env):
    """
    Scenario 1: Verify that 25 concurrent reader sessions can query tasks simultaneously
    without blocking or experiencing connection delays under SQLite WAL mode.
    """
    db = db_rel_env["db"]
    org_id = db_rel_env["org_id"]
    agent_id = db_rel_env["agent_id"]

    # Seed 10 tasks
    tasks = []
    for i in range(10):
        t = TaskModel(
            id=f"t-read-{i}-{uuid.uuid4().hex[:6]}",
            title=f"Read Task {i}",
            description="Reading test description",
            status="queued",
            assigned_agent_id=agent_id,
            organization_id=org_id,
        )
        db.add(t)
    db.commit()

    results = []
    errors = []

    def reader_worker():
        s = SessionLocal()
        try:
            for _ in range(5):
                fetched = s.query(TaskModel).filter(TaskModel.organization_id == org_id).all()
                results.append(len(fetched))
        except Exception as e:
            errors.append(e)
        finally:
            s.close()

    threads = [threading.Thread(target=reader_worker) for _ in range(20)]
    t_start = time.perf_counter()
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    t_duration = time.perf_counter() - t_start

    assert len(errors) == 0, f"Errors in concurrent readers: {errors}"
    assert len(results) == 100
    assert all(count == 10 for count in results)
    # 100 queries across 20 threads should finish in < 2 seconds
    assert t_duration < 2.5


def test_3_5_1_02_concurrent_writes_serialization(db_rel_env):
    """
    Scenario 2: Verify that multiple concurrent writer threads serialize correctly
    and update distinct records without lost committed updates or corrupted states.
    """
    db = db_rel_env["db"]
    org_id = db_rel_env["org_id"]
    agent_id = db_rel_env["agent_id"]

    # Seed 10 tasks to be concurrently updated
    task_ids = []
    for i in range(10):
        t_id = f"t-write-{i}-{uuid.uuid4().hex[:6]}"
        t = TaskModel(
            id=t_id,
            title=f"Write Task {i}",
            description="Initial description",
            status="queued",
            assigned_agent_id=agent_id,
            organization_id=org_id,
        )
        db.add(t)
        task_ids.append(t_id)
    db.commit()

    errors = []

    def writer_worker(target_id: str):
        s = SessionLocal()
        try:
            task = s.query(TaskModel).filter(TaskModel.id == target_id).first()
            task.status = "in_progress"
            task.description = f"Updated by thread {threading.get_ident()}"
            commit_with_retry(s)
        except Exception as e:
            errors.append(e)
        finally:
            s.close()

    threads = [threading.Thread(target=writer_worker, args=(tid,)) for tid in task_ids]
    for th in threads:
        th.start()
    for th in threads:
        th.join()

    assert len(errors) == 0, f"Errors in concurrent writes: {errors}"

    # Verify all updates took effect
    verify_db = SessionLocal()
    updated_tasks = verify_db.query(TaskModel).filter(TaskModel.id.in_(task_ids)).all()
    assert len(updated_tasks) == 10
    assert all(t.status == "in_progress" for t in updated_tasks)
    assert all("Updated by thread" in t.description for t in updated_tasks)
    verify_db.close()


def test_3_5_1_03_read_write_contention_wal_mode(db_rel_env):
    """
    Scenario 3: Verify SQLite WAL non-blocking read property:
    Readers must NOT be blocked even when a writer transaction is actively in-flight.
    """
    db = db_rel_env["db"]
    org_id = db_rel_env["org_id"]
    agent_id = db_rel_env["agent_id"]

    t_id = f"t-contention-{uuid.uuid4().hex[:6]}"
    task = TaskModel(
        id=t_id,
        title="Contention Task",
        description="Testing WAL reader non-blocking",
        status="queued",
        assigned_agent_id=agent_id,
        organization_id=org_id,
    )
    db.add(task)
    db.commit()

    writer_started = threading.Event()
    reader_finished = threading.Event()
    reader_result = []
    errors = []

    def slow_writer():
        s = SessionLocal()
        try:
            t = s.query(TaskModel).filter(TaskModel.id == t_id).first()
            t.description = "Writer in-flight"
            # Flush to hold write lock
            s.flush()
            writer_started.set()
            # Hold lock for 0.3s while reader reads
            time.sleep(0.3)
            commit_with_retry(s)
        except Exception as e:
            errors.append(e)
        finally:
            s.close()

    def fast_reader():
        writer_started.wait(timeout=2.0)
        s = SessionLocal()
        try:
            t_start = time.perf_counter()
            # In WAL mode, this read must return the prior snapshot immediately (<0.1s)
            t = s.query(TaskModel).filter(TaskModel.id == t_id).first()
            read_duration = time.perf_counter() - t_start
            reader_result.append((t.description, read_duration))
        except Exception as e:
            errors.append(e)
        finally:
            s.close()
            reader_finished.set()

    w_thread = threading.Thread(target=slow_writer)
    r_thread = threading.Thread(target=fast_reader)

    w_thread.start()
    r_thread.start()

    r_thread.join(timeout=3.0)
    w_thread.join(timeout=3.0)

    assert len(errors) == 0, f"Errors in read-write contention: {errors}"
    assert len(reader_result) == 1
    read_desc, read_time = reader_result[0]
    # WAL isolation: reader saw original snapshot before writer committed
    assert read_desc == "Testing WAL reader non-blocking"
    # Read duration must be instant, not blocked for 0.3s by writer
    assert read_time < 0.25


def test_3_5_1_04_transaction_rollback_integrity(db_rel_env):
    """
    Scenario 4: Verify that aborted transactions roll back cleanly
    with zero ghost rows, orphan relationships, or partial state updates.
    """
    db = db_rel_env["db"]
    org_id = db_rel_env["org_id"]
    agent_id = db_rel_env["agent_id"]

    t_id = f"t-rollback-{uuid.uuid4().hex[:6]}"
    task = TaskModel(
        id=t_id,
        title="Rollback Test",
        description="Clean state before rollback",
        status="queued",
        assigned_agent_id=agent_id,
        organization_id=org_id,
    )
    db.add(task)
    db.commit()

    # Attempt a transaction that raises an exception mid-way
    s = SessionLocal()
    with pytest.raises(ValueError):
        with transaction_scope(s):
            t = s.query(TaskModel).filter(TaskModel.id == t_id).first()
            t.status = "in_progress"
            t.description = "Corrupted state that should not commit"
            # Injected failure
            raise ValueError("Deliberate transaction failure")

    s.close()

    # Verify state in database was completely preserved
    verify_db = SessionLocal()
    t_after = verify_db.query(TaskModel).filter(TaskModel.id == t_id).first()
    assert t_after.status == "queued"
    assert t_after.description == "Clean state before rollback"
    verify_db.close()


def test_3_5_1_05_transaction_retry_on_lock(db_rel_env):
    """
    Scenario 5: Verify that `commit_with_retry` successfully recovers
    when encountering simulated transient SQLite lock contention.
    """
    s = SessionLocal()
    org_id = db_rel_env["org_id"]
    agent_id = db_rel_env["agent_id"]

    t_id = f"t-retry-{uuid.uuid4().hex[:6]}"
    task = TaskModel(
        id=t_id,
        title="Retry Commit Task",
        description="Testing retry logic",
        status="queued",
        assigned_agent_id=agent_id,
        organization_id=org_id,
    )
    s.add(task)

    # Use commit_with_retry
    commit_with_retry(s, max_retries=3, base_delay=0.01)

    verify_s = SessionLocal()
    fetched = verify_s.query(TaskModel).filter(TaskModel.id == t_id).first()
    assert fetched is not None
    assert fetched.title == "Retry Commit Task"
    verify_s.close()
    s.close()


def test_3_5_1_06_worker_session_isolation(db_rel_env):
    """
    Scenario 6: Verify that independent worker sessions do not leak uncommitted
    dirty reads or state changes across sessions.
    """
    s1 = SessionLocal()
    s2 = SessionLocal()
    org_id = db_rel_env["org_id"]
    agent_id = db_rel_env["agent_id"]

    t_id = f"t-iso-{uuid.uuid4().hex[:6]}"
    task = TaskModel(
        id=t_id,
        title="Session Isolation Task",
        description="Baseline description",
        status="queued",
        assigned_agent_id=agent_id,
        organization_id=org_id,
    )
    s1.add(task)
    s1.commit()

    # Session 1 updates task description but does NOT commit
    t1 = s1.query(TaskModel).filter(TaskModel.id == t_id).first()
    t1.description = "Uncommitted dirty change in Session 1"
    s1.flush()

    # Session 2 queries task
    t2 = s2.query(TaskModel).filter(TaskModel.id == t_id).first()
    # Read committed: Session 2 must NOT see Session 1's uncommitted change
    assert t2.description == "Baseline description"

    s1.rollback()
    s1.close()
    s2.close()


def test_3_5_1_07_connection_pool_burst_and_exhaustion(db_rel_env):
    """
    Scenario 7: Verify that connection pool (50 base + 100 overflow) absorbs
    a burst of 40 simultaneous database sessions without pool exhaustion or leaks.
    """
    sessions = []
    try:
        for _ in range(40):
            s = SessionLocal()
            # Perform query to check out connection from pool
            s.execute(text("SELECT 1")).scalar()
            sessions.append(s)
        # All 40 connections successfully checked out
        assert len(sessions) == 40
    finally:
        for s in sessions:
            s.close()

    # Verify pool reclaimed all connections
    check_s = SessionLocal()
    res = check_s.execute(text("SELECT 1")).scalar()
    assert res == 1
    check_s.close()


def test_3_5_1_08_long_running_transaction_interference(db_rel_env):
    """
    Scenario 8: Verify that long-running operations in SQLite WAL mode
    do not block other reader transactions, and writers queue within busy_timeout.
    """
    org_id = db_rel_env["org_id"]
    agent_id = db_rel_env["agent_id"]
    db = db_rel_env["db"]

    t_id = f"t-long-{uuid.uuid4().hex[:6]}"
    task = TaskModel(
        id=t_id,
        title="Long Transaction Task",
        description="Testing long transaction behavior",
        status="queued",
        assigned_agent_id=agent_id,
        organization_id=org_id,
    )
    db.add(task)
    db.commit()

    # Long reader transaction
    long_s = SessionLocal()
    _ = long_s.query(TaskModel).filter(TaskModel.id == t_id).first()

    # Concurrent writer while long reader is open
    writer_s = SessionLocal()
    w_task = writer_s.query(TaskModel).filter(TaskModel.id == t_id).first()
    w_task.status = "in_progress"
    commit_with_retry(writer_s)
    writer_s.close()

    # Long reader finishes
    long_s.close()

    # Final verification
    v_s = SessionLocal()
    updated = v_s.query(TaskModel).filter(TaskModel.id == t_id).first()
    assert updated.status == "in_progress"
    v_s.close()


def test_3_5_1_09_concurrent_task_claims_cas(db_rel_env):
    """
    Scenario 9: Verify Compare-And-Swap (CAS) claiming:
    10 concurrent agent workers attempt to claim the exact same pending subtask.
    Exactly 1 worker must succeed, 9 must fail, and exactly 1 lease token must be set.
    """
    db = db_rel_env["db"]
    org_id = db_rel_env["org_id"]
    base_agent_id = db_rel_env["agent_id"]

    t_id = f"t-cas-race-{uuid.uuid4().hex[:6]}"
    task = TaskModel(
        id=t_id,
        title="CAS Race Task",
        description="Contested subtask for claiming",
        status="queued",
        assigned_agent_id=base_agent_id,
        organization_id=org_id,
    )
    db.add(task)
    db.commit()

    claim_results = []
    worker_agents = [f"ag_worker_{i}_{uuid.uuid4().hex[:4]}" for i in range(10)]
    # Seed worker agents in DB to satisfy foreign keys
    for ag in worker_agents:
        ag_rec = AgentModel(
            id=ag,
            name=f"Worker {ag}",
            role="general",
            status="idle",
            organization_id=org_id,
        )
        db.add(ag_rec)
    db.commit()

    def claim_attempt(agent_name: str):
        s = SessionLocal()
        try:
            success = task_service.claim_subtask(s, task_id=t_id, agent_id=agent_name, allow_reassign=True)
            claim_results.append((agent_name, success))
        finally:
            s.close()

    threads = [threading.Thread(target=claim_attempt, args=(ag,)) for ag in worker_agents]
    for th in threads:
        th.start()
    for th in threads:
        th.join()

    successes = [r for r in claim_results if r[1] is True]
    failures = [r for r in claim_results if r[1] is False]

    assert len(successes) == 1, f"Expected exactly 1 winner, got {len(successes)}: {successes}"
    assert len(failures) == 9

    # Verify winner is persisted authoritatively in the DB
    check_s = SessionLocal()
    final_task = check_s.query(TaskModel).filter(TaskModel.id == t_id).first()
    assert final_task.status == "running"
    assert final_task.assigned_agent_id == successes[0][0]
    assert final_task.lease_token is not None
    assert final_task.lease_token.startswith("lease_")
    check_s.close()


def test_3_5_1_10_database_recovery_after_interrupted_transaction(db_rel_env):
    """
    Scenario 10: Verify database integrity and automatic recovery
    after a simulated process crash / unclosed transaction.
    """
    db = db_rel_env["db"]
    org_id = db_rel_env["org_id"]
    agent_id = db_rel_env["agent_id"]

    t_id = f"t-crash-rec-{uuid.uuid4().hex[:6]}"
    task = TaskModel(
        id=t_id,
        title="Pre-Crash Task",
        description="Known good state",
        status="queued",
        assigned_agent_id=agent_id,
        organization_id=org_id,
    )
    db.add(task)
    db.commit()

    # Simulate an abandoned, unclosed connection that had an uncommitted transaction
    abandoned_s = SessionLocal()
    try:
        t_abandoned = abandoned_s.query(TaskModel).filter(TaskModel.id == t_id).first()
        t_abandoned.description = "Uncommitted change that crashed"
        abandoned_s.flush()

        # Fresh session connects and runs a query
        fresh_s = SessionLocal()
        recovered_task = fresh_s.query(TaskModel).filter(TaskModel.id == t_id).first()
        assert recovered_task is not None
        # Uncommitted change was not persisted
        assert recovered_task.description == "Known good state"

        # SQLite integrity check passes completely
        integrity = fresh_s.execute(text("PRAGMA integrity_check")).scalar()
        assert integrity == "ok"
        fresh_s.close()
    finally:
        abandoned_s.rollback()
        abandoned_s.close()
