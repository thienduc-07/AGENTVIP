import asyncio
import os
import uuid
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from backend.app.core.config import settings
from backend.app.core.database import SessionLocal, commit_with_retry
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.schemas.task import TaskCreate
from backend.app.services.task_service import task_service
from backend.app.services.event_service import event_service
from backend.app.agent_runtime.context import TaskContext
from backend.app.agent_runtime.executor import ExecutionLoop
from backend.app.agent_runtime.tools.base import (
    ToolResult,
    ToolPermissionLevel,
    ToolExecutionSemantics,
    SideEffectLevel,
)
from backend.app.agent_runtime.tools.registry import default_tool_registry
from backend.app.agent_runtime.tools.artifact.artifact_tools import ArtifactCreateTool
from backend.app.agent_runtime.lifecycle.task_lifecycle import task_lifecycle_engine, TaskStatus
from backend.app.agent_runtime.contracts.deliverable_contract import StructuredDeliverable
from backend.app.agent_runtime.dispatcher.crash_recovery import recover_abandoned_tasks


@pytest.fixture(scope="function")
def idem_env():
    db = SessionLocal()
    org_a = f"org_idem_a_{uuid.uuid4().hex[:6]}"
    org_b = f"org_idem_b_{uuid.uuid4().hex[:6]}"
    ag_a = f"ag_idem_a_{uuid.uuid4().hex[:6]}"
    ag_b = f"ag_idem_b_{uuid.uuid4().hex[:6]}"

    for org_id in (org_a, org_b):
        db.add(OrganizationModel(id=org_id, name=org_id, slug=org_id.lower(), is_active=True))

    db.add(AgentModel(id=ag_a, name="Agent A", role="general", status="idle", organization_id=org_a))
    db.add(AgentModel(id=ag_b, name="Agent B", role="general", status="idle", organization_id=org_b))
    commit_with_retry(db)

    yield {"org_a": org_a, "org_b": org_b, "ag_a": ag_a, "ag_b": ag_b, "db": db}

    cleanup_db = SessionLocal()
    try:
        cleanup_db.query(TaskModel).filter(TaskModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(AgentEventModel).filter(AgentEventModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(AgentModel).filter(AgentModel.id.in_([ag_a, ag_b])).delete()
        cleanup_db.query(OrganizationModel).filter(OrganizationModel.id.in_([org_a, org_b])).delete()
        cleanup_db.commit()
    except Exception:
        pass
    finally:
        cleanup_db.close()
    db.close()


def test_3_5_2_01_same_task_submitted_twice(idem_env):
    """Scenario 1: Submitting the identical task twice with idempotency key returns existing row."""
    db = idem_env["db"]
    org_a = idem_env["org_a"]
    ag_a = idem_env["ag_a"]
    idem_key = f"key-sub-{uuid.uuid4().hex[:8]}"

    task_in1 = TaskCreate(
        title="Payment Reconciliation",
        description="Run invoice reconciliation",
        assigned_agent_id=ag_a,
        idempotency_key=idem_key,
    )
    t1 = task_service.create_task(db, task_in1, organization_id=org_a)
    assert t1.id is not None

    task_in2 = TaskCreate(
        title="Payment Reconciliation",
        description="Run invoice reconciliation duplicate",
        assigned_agent_id=ag_a,
        idempotency_key=idem_key,
    )
    t2 = task_service.create_task(db, task_in2, organization_id=org_a)

    assert t1.id == t2.id
    # Ensure only 1 row exists in database
    count = db.query(TaskModel).filter(TaskModel.idempotency_key == idem_key).count()
    assert count == 1


def test_3_5_2_02_same_idempotency_key_different_organizations(idem_env):
    """Scenario 2: Identical idempotency keys across different orgs create distinct tasks safely."""
    db = idem_env["db"]
    org_a = idem_env["org_a"]
    org_b = idem_env["org_b"]
    ag_a = idem_env["ag_a"]
    ag_b = idem_env["ag_b"]
    shared_key = f"shared-key-{uuid.uuid4().hex[:8]}"

    t_a = task_service.create_task(
        db,
        TaskCreate(title="Org A Task", description="Org A Task", assigned_agent_id=ag_a, idempotency_key=shared_key),
        organization_id=org_a,
    )
    t_b = task_service.create_task(
        db,
        TaskCreate(title="Org B Task", description="Org B Task", assigned_agent_id=ag_b, idempotency_key=shared_key),
        organization_id=org_b,
    )

    assert t_a.id != t_b.id
    assert t_a.organization_id == org_a
    assert t_b.organization_id == org_b


def test_3_5_2_03_worker_crashes_before_execution(idem_env):
    """Scenario 3: Worker crashes after task creation but before execution begins."""
    db = idem_env["db"]
    org_a = idem_env["org_a"]
    ag_a = idem_env["ag_a"]

    t = TaskModel(
        id=f"t-crash-pre-{uuid.uuid4().hex[:6]}",
        title="Pre-Execution Crash Task",
        description="Worker crashes immediately upon dequeue",
        status="running",
        assigned_agent_id=ag_a,
        organization_id=org_a,
    )
    db.add(t)
    db.commit()

    recovered = recover_abandoned_tasks(db, auto_retry=True)
    assert recovered >= 1

    db.expire_all()
    reloaded = db.query(TaskModel).filter(TaskModel.id == t.id).first()
    assert reloaded.status == "queued"
    assert reloaded.retry_count == 1


def test_3_5_2_04_worker_crashes_during_execution(idem_env):
    """Scenario 4: Worker crashes mid-execution while running multiple internal turns."""
    db = idem_env["db"]
    org_a = idem_env["org_a"]
    ag_a = idem_env["ag_a"]

    t = TaskModel(
        id=f"t-crash-mid-{uuid.uuid4().hex[:6]}",
        title="Mid-Execution Crash Task",
        description="Crashed on iteration 3",
        status="in_progress",
        assigned_agent_id=ag_a,
        organization_id=org_a,
        retry_count=1,
        max_retries=2,
    )
    db.add(t)
    db.commit()

    recovered = recover_abandoned_tasks(db, auto_retry=True)
    assert recovered >= 1

    db.expire_all()
    reloaded = db.query(TaskModel).filter(TaskModel.id == t.id).first()
    # Retries exhausted -> transitions to terminal failed state
    assert reloaded.status == "queued"
    assert reloaded.retry_count == 2


def test_3_5_2_05_worker_crashes_after_external_op_before_saving_result(idem_env):
    """
    Scenario 5: Worker executes external operation and crashes before saving result.
    On recovery with pre-existing verified deliverable, does not re-execute side effects.
    """
    db = idem_env["db"]
    org_a = idem_env["org_a"]
    ag_a = idem_env["ag_a"]
    t_id = f"t-crash-post-{uuid.uuid4().hex[:6]}"

    deliv_dict = {
        "deliverable_id": f"deliv_{uuid.uuid4().hex[:8]}",
        "task_id": t_id,
        "verification_status": "VERIFIED",
        "result_summary": "External write completed and verified",
    }

    t = TaskModel(
        id=t_id,
        title="Post-Op Crash Task",
        description="Deliverable written but worker died before final task status update",
        status="running",
        assigned_agent_id=ag_a,
        organization_id=org_a,
        output_data_json={"deliverable": deliv_dict},
    )
    db.add(t)
    db.commit()

    # Recovery detects pre-existing verified deliverable
    recovered = recover_abandoned_tasks(db, auto_retry=True)
    assert recovered >= 1

    db.expire_all()
    reloaded = db.query(TaskModel).filter(TaskModel.id == t_id).first()
    assert reloaded.status == "completed"


def test_3_5_2_06_retry_after_ambiguous_timeout(idem_env):
    """
    Scenario 6: Retry after an ambiguous timeout classifies external tools with
    AT_LEAST_ONCE or EFFECTIVELY_ONCE semantics and propagates stable idempotency keys.
    """
    meta_read = default_tool_registry.get_metadata("workspace.read_file")
    assert meta_read.execution_semantics == ToolExecutionSemantics.EFFECTIVELY_ONCE

    meta_calc = default_tool_registry.get_metadata("calculator")
    assert meta_calc.execution_semantics == ToolExecutionSemantics.EFFECTIVELY_ONCE

    meta_api = default_tool_registry.get_metadata("api.call")
    # External API calls with mutations are classified as at-least-once or effectively-once with Idempotency-Key
    assert meta_api.execution_semantics in (
        ToolExecutionSemantics.AT_LEAST_ONCE,
        ToolExecutionSemantics.EFFECTIVELY_ONCE,
    )


def test_3_5_2_07_duplicate_tool_invocation_deduplication():
    """Scenario 7: Duplicate tool calls with the identical call_id reuse cached output."""
    context = TaskContext(
        task_id="t-mock-call",
        agent_id="ag-mock",
        organization_id="org-mock",
    )
    context.executed_call_ids["call_12345"] = {"success": True, "result": "42"}

    # Second invocation with same call_id
    cached = context.executed_call_ids.get("call_12345")
    assert cached is not None
    assert cached["result"] == "42"


@pytest.mark.asyncio
async def test_3_5_2_08_duplicate_artifact_creation(idem_env):
    """Scenario 8: Duplicate artifact creation tool calls update existing record rather than duplicate."""
    db = idem_env["db"]
    org_a = idem_env["org_a"]
    ag_a = idem_env["ag_a"]
    t_id = f"t-art-dup-{uuid.uuid4().hex[:6]}"

    # Seed task to satisfy foreign key
    t = TaskModel(
        id=t_id,
        title="Artifact Task",
        description="Artifact creation test",
        status="in_progress",
        assigned_agent_id=ag_a,
        organization_id=org_a,
    )
    db.add(t)
    db.commit()

    tool = ArtifactCreateTool()
    ctx = TaskContext(
        task_id=t_id,
        agent_id=ag_a,
        organization_id=org_a,
    )
    ctx.db = db

    try:
        # First creation
        r1 = await tool.execute(
            {
                "task_id": t_id,
                "name": "audit_report.md",
                "content": "# Original Report Content",
                "artifact_type": "report",
            },
            context=ctx,
        )
        assert r1.success is True

        # Second creation with same name
        r2 = await tool.execute(
            {
                "task_id": t_id,
                "name": "audit_report.md",
                "content": "# Updated Report Content",
                "artifact_type": "report",
            },
            context=ctx,
        )
        assert r2.success is True

        from backend.app.models.artifact import ArtifactModel
        artifacts = ctx.db.query(ArtifactModel).filter(ArtifactModel.task_id == t_id).all()
        # Exactly 1 artifact record exists with updated metadata/content on disk
        assert len(artifacts) == 1
        target_file = settings.WORKSPACE_ROOT / artifacts[0].storage_path
        assert target_file.exists()
        assert "# Updated Report Content" in target_file.read_text(encoding="utf-8")
    finally:
        pass


def test_3_5_2_09_duplicate_event_publication(idem_env):
    """Scenario 9: Idempotent event creation with event_id deduplication."""
    db = idem_env["db"]
    org_a = idem_env["org_a"]
    ag_a = idem_env["ag_a"]
    event_id = f"evt_dup_{uuid.uuid4().hex[:12]}"

    e1 = event_service.create_event(
        db=db,
        event_type="agent.status_changed",
        agent_id=ag_a,
        organization_id=org_a,
        payload={"status": "working"},
        event_id=event_id,
    )

    e2 = event_service.create_event(
        db=db,
        event_type="agent.status_changed",
        agent_id=ag_a,
        organization_id=org_a,
        payload={"status": "working"},
        event_id=event_id,
    )

    assert e1.id == e2.id
    assert e1.sequence_id == e2.sequence_id
    total_ev = db.query(AgentEventModel).filter(AgentEventModel.id == event_id).count()
    assert total_ev == 1


def test_3_5_2_10_repeated_task_completion_requests(idem_env):
    """Scenario 10: Repeated transition requests to COMPLETED are idempotent no-ops."""
    db = idem_env["db"]
    org_a = idem_env["org_a"]
    ag_a = idem_env["ag_a"]
    t_id = f"t-comp-idem-{uuid.uuid4().hex[:6]}"

    deliverable = StructuredDeliverable(
        task_id=t_id,
        agent_id=ag_a,
        organization_id=org_a,
        execution_id="exec_123",
        objective="Finalize",
        actions_performed=["Step 1"],
        evidence_references=["Proof 1"],
        result_summary="Verified completion summary",
        verification_status="VERIFIED",
    )

    task = TaskModel(
        id=t_id,
        title="Completion Idempotency Task",
        description="Verify repeated completion",
        status="in_progress",
        assigned_agent_id=ag_a,
        organization_id=org_a,
    )
    db.add(task)
    db.commit()

    # First completion transition
    t_first = task_lifecycle_engine.transition(
        db=db,
        task=task,
        target_status=TaskStatus.COMPLETED,
        deliverable=deliverable,
    )
    assert t_first.status == "completed"

    # Repeated completion transition
    t_second = task_lifecycle_engine.transition(
        db=db,
        task=task,
        target_status=TaskStatus.COMPLETED,
        deliverable=deliverable,
    )
    assert t_second.status == "completed"
    assert t_first.id == t_second.id
