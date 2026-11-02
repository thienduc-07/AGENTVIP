"""
PROVIPAGENT Phase 4.3.7: Execution Concurrency, Isolation & Stress Test Suite
Evaluates concurrent execution integrity, parallel terminal appending,
strictly ordered monotonic sequence allocation, idempotent cancellation,
and crash recovery under multithreaded load.
"""
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import pytest
from sqlalchemy.orm import Session

from backend.app.core.database import SessionLocal
from backend.app.models.auth import OrganizationModel
from backend.app.models.agent import AgentModel
from backend.app.models.execution import ExecutionModel, TerminalLineModel
from backend.app.services.workstation_execution_service import (
    WorkstationExecutionService,
    workstation_execution_service,
)
from backend.app.services.event_service import event_service
from backend.app.agent_runtime.dispatcher.crash_recovery import recover_abandoned_executions


@pytest.fixture
def stress_setup():
    """Sets up organizations and agents for concurrency testing in persistent engine."""
    db = SessionLocal()
    try:
        org = db.query(OrganizationModel).filter(OrganizationModel.id == "org_stress_test").first()
        if not org:
            org = OrganizationModel(id="org_stress_test", name="Stress Corp", slug="stress-corp", is_active=True)
            db.add(org)

        for i in range(30):
            agent_id = f"agt_stress_{i:02d}"
            agent = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
            if not agent:
                agent = AgentModel(
                    id=agent_id,
                    organization_id="org_stress_test",
                    name=f"Stress Agent {i}",
                    role="Worker",
                    description="Concurrency testing",
                    status="idle",
                    behavioral_state="IDLE",
                )
                db.add(agent)
        db.commit()
    finally:
        db.close()

    yield {"org_id": "org_stress_test"}


def test_10_concurrent_executions_isolation(stress_setup):
    """
    10 concurrent agent executions running in parallel threads:
    - Appending terminal lines concurrently.
    - Verifies strictly contiguous line numbering per execution.
    - Verifies total_lines matches terminal_lines count.
    - Verifies zero cross-execution terminal contamination.
    """
    num_executions = 10
    lines_per_exec = 8

    def _run_worker(idx: int):
        db = SessionLocal()
        try:
            agent_id = f"agt_stress_{idx:02d}"
            exec_model = WorkstationExecutionService.start_execution(
                db=db,
                agent_id=agent_id,
                organization_id=stress_setup["org_id"],
                correlation_id=f"corr_{idx}",
            )
            exec_id = exec_model.id

            for line_idx in range(lines_per_exec):
                WorkstationExecutionService.append_terminal_line(
                    db=db,
                    execution_id=exec_id,
                    stream="stdout",
                    content=f"EXEC_{idx:02d} PAYLOAD LINE {line_idx:02d}",
                    metadata={"exec_idx": idx, "line_idx": line_idx},
                    broadcast=False,
                )

            # Record a tool call
            WorkstationExecutionService.record_tool_call_started(
                db=db,
                execution_id=exec_id,
                tool_name="stress_probe",
                arguments={"worker": idx},
                call_id=f"call_{idx}",
            )
            WorkstationExecutionService.record_tool_call_completed(
                db=db,
                execution_id=exec_id,
                tool_name="stress_probe",
                duration_ms=42,
                output_summary=f"Worker {idx} success",
                call_id=f"call_{idx}",
            )

            completed = WorkstationExecutionService.complete_execution(
                db=db,
                execution_id=exec_id,
                status="completed",
                summary=f"Worker {idx} finished cleanly",
            )
            return exec_id, idx
        finally:
            db.close()

    results = []
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(_run_worker, i) for i in range(num_executions)]
        for fut in as_completed(futures):
            results.append(fut.result())

    assert len(results) == num_executions

    # Verify database integrity across all executions
    verify_db = SessionLocal()
    try:
        for exec_id, idx in results:
            execution = verify_db.query(ExecutionModel).filter(ExecutionModel.id == exec_id).first()
            assert execution is not None
            assert execution.status == "completed"

            lines = (
                verify_db.query(TerminalLineModel)
                .filter(TerminalLineModel.execution_id == exec_id)
                .order_by(TerminalLineModel.line_number.asc())
                .all()
            )
            # Expect: 1 (start system line) + lines_per_exec + 1 (tool start) + 1 (tool done) + 1 (complete system line)
            expected_min_lines = 1 + lines_per_exec + 3
            assert len(lines) == expected_min_lines
            assert execution.total_lines == expected_min_lines

            # Contiguous line numbering 1..N
            line_numbers = [l.line_number for l in lines]
            assert line_numbers == list(range(1, expected_min_lines + 1))

            # No contamination: lines belonging to this execution must not have other exec tags
            for l in lines:
                assert l.execution_id == exec_id
                assert l.agent_id == f"agt_stress_{idx:02d}"
                for other_idx in range(num_executions):
                    if other_idx != idx:
                        assert f"EXEC_{other_idx:02d}" not in l.content
    finally:
        verify_db.close()


def test_25_concurrent_executions_stress(stress_setup):
    """
    25 concurrent executions executed under heavy multithreaded pool.
    Verifies that SQLite write retry mechanism operates reliably without lock errors.
    """
    num_executions = 25

    def _stress_worker(idx: int):
        db = SessionLocal()
        try:
            agent_id = f"agt_stress_{idx:02d}"
            exec_model = WorkstationExecutionService.start_execution(
                db=db,
                agent_id=agent_id,
                organization_id=stress_setup["org_id"],
            )
            exec_id = exec_model.id

            for l in range(4):
                WorkstationExecutionService.append_terminal_line(
                    db=db,
                    execution_id=exec_id,
                    stream="stdout",
                    content=f"Stress worker {idx} line {l}",
                    broadcast=False,
                )

            WorkstationExecutionService.complete_execution(
                db=db,
                execution_id=exec_id,
                status="completed",
                summary="Stress success",
            )
            return exec_id
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = [executor.submit(_stress_worker, i) for i in range(num_executions)]
        completed_ids = [fut.result() for fut in as_completed(futures)]

    assert len(completed_ids) == num_executions

    verify_db = SessionLocal()
    try:
        completed_records = (
            verify_db.query(ExecutionModel)
            .filter(ExecutionModel.id.in_(completed_ids))
            .all()
        )
        assert len(completed_records) == num_executions
        for rec in completed_records:
            assert rec.status == "completed"
            assert rec.total_lines >= 6
    finally:
        verify_db.close()


def test_ordered_unique_event_sequence_allocation(stress_setup):
    """
    Emits events concurrently and verifies sequence numbers are strictly unique and positive.
    """
    event_count = 30

    def _emit_event(idx: int):
        db = SessionLocal()
        try:
            ev = event_service.create_event(
                db=db,
                event_type="stress.benchmark.ping",
                agent_id="agt_stress_00",
                organization_id=stress_setup["org_id"],
                payload={"index": idx},
                commit=True,
            )
            return ev.sequence_id
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(_emit_event, i) for i in range(event_count)]
        seq_ids = [fut.result() for fut in as_completed(futures)]

    assert len(seq_ids) == event_count
    # All sequence IDs must be integers > 0
    assert all(isinstance(s, int) and s > 0 for s in seq_ids)
    # All sequence IDs must be strictly unique (no duplicate sequence collision)
    assert len(set(seq_ids)) == event_count


def test_idempotent_execution_cancellation(stress_setup):
    """
    Multiple concurrent cancellation requests for the same execution must resolve idempotently
    without corrupted state or repeated terminal noise.
    """
    db = SessionLocal()
    try:
        exec_model = WorkstationExecutionService.start_execution(
            db=db,
            agent_id="agt_stress_00",
            organization_id=stress_setup["org_id"],
        )
        exec_id = exec_model.id
    finally:
        db.close()

    def _cancel_attempt():
        thread_db = SessionLocal()
        try:
            return WorkstationExecutionService.complete_execution(
                db=thread_db,
                execution_id=exec_id,
                status="cancelled",
                summary="Cancelled by user",
            )
        finally:
            thread_db.close()

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(_cancel_attempt) for _ in range(5)]
        results = [fut.result() for fut in as_completed(futures)]

    assert all(r is not None for r in results)

    verify_db = SessionLocal()
    try:
        final_exec = verify_db.query(ExecutionModel).filter(ExecutionModel.id == exec_id).first()
        assert final_exec.status == "cancelled"
    finally:
        verify_db.close()


def test_partial_execution_crash_recovery(stress_setup):
    """
    Simulates abrupt system failure during active executions.
    recover_abandoned_executions must mark orphaned executions as failed with an audit trail.
    """
    db = SessionLocal()
    created_ids = []
    try:
        for i in range(4):
            exec_model = WorkstationExecutionService.start_execution(
                db=db,
                agent_id=f"agt_stress_{i:02d}",
                organization_id=stress_setup["org_id"],
            )
            created_ids.append(exec_model.id)
    finally:
        db.close()

    # Verify all 4 are running
    check_db = SessionLocal()
    try:
        running = check_db.query(ExecutionModel).filter(ExecutionModel.id.in_(created_ids)).all()
        assert len(running) == 4
        assert all(r.status == "running" for r in running)

        # Run recovery
        recovered_count = recover_abandoned_executions(check_db)
        assert recovered_count >= 4

        # Verify all are now marked failed
        recovered = check_db.query(ExecutionModel).filter(ExecutionModel.id.in_(created_ids)).all()
        for rec in recovered:
            assert rec.status == "failed"
            assert "interrupted" in rec.error_message.lower()

        # Idempotency check: running recovery again finds 0 running executions
        assert recover_abandoned_executions(check_db) == 0
    finally:
        check_db.close()


def test_no_cross_agent_terminal_or_event_contamination(stress_setup):
    """
    Verifies that get_terminal_history_for_agent and get_terminal_history_for_execution
    strictly isolate agent terminal output.
    """
    db = SessionLocal()
    try:
        agent_1 = "agt_stress_01"
        agent_2 = "agt_stress_02"

        e1 = WorkstationExecutionService.start_execution(db=db, agent_id=agent_1, organization_id=stress_setup["org_id"])
        e2 = WorkstationExecutionService.start_execution(db=db, agent_id=agent_2, organization_id=stress_setup["org_id"])

        WorkstationExecutionService.append_terminal_line(
            db=db, execution_id=e1.id, stream="stdout", content="SECRET_OF_AGENT_1"
        )
        WorkstationExecutionService.append_terminal_line(
            db=db, execution_id=e2.id, stream="stdout", content="SECRET_OF_AGENT_2"
        )

        WorkstationExecutionService.complete_execution(db=db, execution_id=e1.id, status="completed")
        WorkstationExecutionService.complete_execution(db=db, execution_id=e2.id, status="completed")

        history_1 = workstation_execution_service.get_terminal_history_for_agent(
            db=db, agent_id=agent_1, organization_id=stress_setup["org_id"]
        )
        history_2 = workstation_execution_service.get_terminal_history_for_agent(
            db=db, agent_id=agent_2, organization_id=stress_setup["org_id"]
        )

        content_1 = " ".join([l["content"] for l in history_1["lines"]])
        content_2 = " ".join([l["content"] for l in history_2["lines"]])

        assert "SECRET_OF_AGENT_1" in content_1
        assert "SECRET_OF_AGENT_2" not in content_1

        assert "SECRET_OF_AGENT_2" in content_2
        assert "SECRET_OF_AGENT_1" not in content_2
    finally:
        db.close()
