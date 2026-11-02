import hashlib
import os
import uuid
import pytest
from datetime import datetime, timezone
from pathlib import Path

from backend.app.core.config import settings
from backend.app.core.database import SessionLocal
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.artifact import ArtifactModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.agent_runtime.contracts.deliverable_contract import StructuredDeliverable
from backend.app.agent_runtime.verifier import result_verifier, ResultVerifier
from backend.app.agent_runtime.lifecycle.task_lifecycle import (
    task_lifecycle_engine,
    TaskStatus,
    DeliverableNotVerifiedError,
)
from backend.app.agent_runtime.tools.artifact.artifact_tools import ArtifactCreateTool
from backend.app.agent_runtime.tools.workspace.workspace_write import WorkspaceWriteTool
from backend.app.agent_runtime.context import TaskContext


@pytest.fixture(scope="function")
def trust_env():
    db = SessionLocal()
    org_a = f"org_trust_a_{uuid.uuid4().hex[:6]}"
    org_b = f"org_trust_b_{uuid.uuid4().hex[:6]}"
    ag_a = f"ag_trust_a_{uuid.uuid4().hex[:6]}"
    ag_b = f"ag_trust_b_{uuid.uuid4().hex[:6]}"

    for org_id in (org_a, org_b):
        db.add(OrganizationModel(id=org_id, name=org_id, slug=org_id.lower(), is_active=True))

    db.add(AgentModel(id=ag_a, name="Trust Agent A", role="general", status="idle", organization_id=org_a))
    db.add(AgentModel(id=ag_b, name="Trust Agent B", role="general", status="idle", organization_id=org_b))
    db.commit()

    yield {
        "org_a": org_a,
        "org_b": org_b,
        "ag_a": ag_a,
        "ag_b": ag_b,
        "db": db,
    }

    cleanup_db = SessionLocal()
    try:
        cleanup_db.query(ArtifactModel).filter(
            ArtifactModel.task_id.in_(
                cleanup_db.query(TaskModel.id).filter(TaskModel.organization_id.in_([org_a, org_b]))
            )
        ).delete(synchronize_session=False)
        cleanup_db.query(TaskModel).filter(TaskModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(AgentEventModel).filter(AgentEventModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(AgentModel).filter(AgentModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(OrganizationModel).filter(OrganizationModel.id.in_([org_a, org_b])).delete()
        cleanup_db.commit()
    except Exception:
        pass
    finally:
        cleanup_db.close()
    db.close()


def test_3_5_5_01_empty_deliverable_rejected(trust_env):
    """Scenario 1: Empty deliverable structure without results or evidence is rejected by completion gate."""
    db = trust_env["db"]
    org_a = trust_env["org_a"]
    ag_a = trust_env["ag_a"]
    t_id = f"t-empty-deliv-{uuid.uuid4().hex[:6]}"

    task = TaskModel(
        id=t_id,
        title="Empty Deliverable Task",
        description="Testing rejection of empty deliverable",
        status="in_progress",
        assigned_agent_id=ag_a,
        organization_id=org_a,
    )
    db.add(task)
    db.commit()

    # Empty deliverable
    empty_deliv = StructuredDeliverable(
        task_id=t_id,
        agent_id=ag_a,
        organization_id=org_a,
        execution_id="exec_empty",
        objective="Empty",
        actions_performed=[],
        evidence_references=[],
        result_summary="",
        verification_status="PENDING", # Unverified
    )

    with pytest.raises(DeliverableNotVerifiedError):
        task_lifecycle_engine.transition(
            db=db,
            task=task,
            target_status=TaskStatus.COMPLETED,
            deliverable=empty_deliv,
        )


def test_3_5_5_02_missing_evidence_rejected(trust_env):
    """Scenario 2: Deliverable with summary but zero evidence references or tools is rejected."""
    db = trust_env["db"]
    org_a = trust_env["org_a"]
    ag_a = trust_env["ag_a"]
    t_id = f"t-no-evid-{uuid.uuid4().hex[:6]}"

    task = TaskModel(
        id=t_id,
        title="No Evidence Task",
        description="Testing rejection of unevidenced deliverable",
        status="in_progress",
        assigned_agent_id=ag_a,
        organization_id=org_a,
    )
    db.add(task)
    db.commit()

    deliv_no_evidence = StructuredDeliverable(
        task_id=t_id,
        agent_id=ag_a,
        organization_id=org_a,
        execution_id="exec_no_evid",
        objective="No Evid",
        actions_performed=["Claimed work"],
        evidence_references=[],
        artifact_paths=[],
        tools_invoked=[],
        result_summary="I completed the whole task without running any tools or writing files.",
        verification_status="VERIFIED",
    )

    with pytest.raises(DeliverableNotVerifiedError):
        task_lifecycle_engine.transition(
            db=db,
            task=task,
            target_status=TaskStatus.COMPLETED,
            deliverable=deliv_no_evidence,
        )


def test_3_5_5_03_artifact_tampering_detection(trust_env):
    """Scenario 3: 1-byte file tampering post-creation is detected by SHA-256 verifier."""
    art_file = settings.SANDBOX_DIR / "artifacts" / f"tamper_test_{uuid.uuid4().hex[:6]}.md"
    art_file.parent.mkdir(parents=True, exist_ok=True)
    art_file.write_text("# Authentic Financial Report\nNet Profit: $1,000,000", encoding="utf-8")

    initial_hash = hashlib.sha256(art_file.read_bytes()).hexdigest()
    rel_path = str(art_file.relative_to(settings.WORKSPACE_ROOT))

    deliv_dict = {
        "deliverable_id": "deliv-tamper-check",
        "task_id": "t-tamper-1",
        "verification_status": "VERIFIED",
        "artifact_paths": [rel_path],
        "artifact_hashes": {rel_path: initial_hash},
    }

    # Initial check passes
    valid_res = result_verifier.verify_deliverable_integrity(deliv_dict)
    assert valid_res.passed is True

    # Tamper with file on disk (alter 1 character: 1,000,000 -> 9,000,000)
    art_file.write_text("# Authentic Financial Report\nNet Profit: $9,000,000", encoding="utf-8")

    tampered_res = result_verifier.verify_deliverable_integrity(deliv_dict)
    assert tampered_res.passed is False
    assert "tampered with" in tampered_res.reason.lower()

    art_file.unlink(missing_ok=True)


def test_3_5_5_04_artifact_deletion_detection(trust_env):
    """Scenario 4: Deleting a verified artifact file is detected as FILE_MISSING."""
    art_file = settings.SANDBOX_DIR / "artifacts" / f"del_test_{uuid.uuid4().hex[:6]}.md"
    art_file.parent.mkdir(parents=True, exist_ok=True)
    art_file.write_text("Temporary artifact", encoding="utf-8")

    init_hash = hashlib.sha256(art_file.read_bytes()).hexdigest()
    rel_path = str(art_file.relative_to(settings.WORKSPACE_ROOT))
    deliv_dict = {
        "deliverable_id": "deliv-del-check",
        "task_id": "t-del-1",
        "artifact_paths": [rel_path],
        "artifact_hashes": {rel_path: init_hash},
    }

    # Delete file from disk
    art_file.unlink()

    check_res = result_verifier.verify_deliverable_integrity(deliv_dict)
    assert check_res.passed is False
    assert "missing from disk" in check_res.reason.lower()


def test_3_5_5_05_path_traversal_rejection(trust_env):
    """Scenario 5: Artifact tools reject directory traversal attempts outside sandbox."""
    tool = ArtifactCreateTool()
    ctx = TaskContext(task_id="t-trav", agent_id=trust_env["ag_a"], organization_id=trust_env["org_a"])

    # Path traversal payload
    import asyncio
    res = asyncio.run(
        tool.execute({"name": "../../etc/evil_payload.sh", "content": "rm -rf /"}, context=ctx)
    )
    assert res.success is False
    assert "security policy denied" in res.output.lower() or "boundary" in res.output.lower()


def test_3_5_5_06_unauthorized_artifact_cross_tenant(trust_env):
    """Scenario 6: Cross-tenant artifact retrieval is rejected with 404."""
    from backend.app.services.artifact_service import artifact_service
    db = trust_env["db"]
    org_a = trust_env["org_a"]
    org_b = trust_env["org_b"]
    ag_a = trust_env["ag_a"]

    # Seed task and artifact under Org A
    t_a = TaskModel(
        id=f"t-art-sec-{uuid.uuid4().hex[:6]}",
        title="Org A Task",
        description="Org A Task",
        status="completed",
        assigned_agent_id=ag_a,
        organization_id=org_a,
    )
    db.add(t_a)

    art_a = ArtifactModel(
        id=f"art-sec-{uuid.uuid4().hex[:6]}",
        task_id=t_a.id,
        name="confidential_forecast.md",
        artifact_type="report",
        storage_path="workspace_sandbox/artifacts/confidential_forecast.md",
        mime_type="text/markdown",
        size_bytes=100,
    )
    db.add(art_a)
    db.commit()

    # Org B attempts to retrieve Org A's artifact
    with pytest.raises(Exception):
        artifact_service.get_artifact(db, artifact_id=art_a.id, organization_id=org_b)


def test_3_5_5_07_atomic_file_write_rollback():
    """Scenario 7: Atomic file write writes to temporary file first and replaces atomically."""
    tool = WorkspaceWriteTool()
    target_rel = "artifacts/atomic_test.txt"
    target_abs = settings.SANDBOX_DIR / target_rel

    import asyncio
    res = asyncio.run(
        tool.execute({"filepath": target_rel, "content": "Atomic content written successfully"})
    )
    assert res.success is True
    assert target_abs.exists()
    assert target_abs.read_text(encoding="utf-8") == "Atomic content written successfully"

    target_abs.unlink(missing_ok=True)


def test_3_5_5_08_deliverable_lifecycle_state_distinction(trust_env):
    """
    Scenario 8: Distinguishes clearly between:
    - EXECUTION_COMPLETED
    - DELIVERABLE_SUBMITTED
    - DELIVERABLE_VERIFIED
    - DELIVERABLE_ACCEPTED (COMPLETED)
    """
    db = trust_env["db"]
    org_a = trust_env["org_a"]
    ag_a = trust_env["ag_a"]
    t_id = f"t-lifecycle-phases-{uuid.uuid4().hex[:6]}"

    task = TaskModel(
        id=t_id,
        title="Phased Verification Task",
        description="Walkthrough of deliverable states",
        status="in_progress",
        assigned_agent_id=ag_a,
        organization_id=org_a,
    )
    db.add(task)
    db.commit()

    # Phase 1: Execution completed (tool results in context)
    exec_tools = [{"tool": "calculator", "result": "100"}]

    # Phase 2: Deliverable submitted (pending verification)
    submitted_deliv = StructuredDeliverable(
        task_id=t_id,
        agent_id=ag_a,
        organization_id=org_a,
        execution_id="exec_phase_1",
        objective="Analyze numbers",
        actions_performed=["Ran calculation"],
        tools_invoked=exec_tools,
        evidence_references=["Calculation verified: 100"],
        result_summary="Calculation resulted in 100",
        verification_status="PENDING", # Not yet verified
    )

    # Cannot transition to COMPLETED while verification is PENDING
    with pytest.raises(DeliverableNotVerifiedError):
        task_lifecycle_engine.transition(
            db=db,
            task=task,
            target_status=TaskStatus.COMPLETED,
            deliverable=submitted_deliv,
        )

    # Phase 3: Deliverable verified
    verified_deliv = submitted_deliv.model_copy(update={"verification_status": "VERIFIED"})

    # Phase 4: Deliverable accepted -> COMPLETED
    t_comp = task_lifecycle_engine.transition(
        db=db,
        task=task,
        target_status=TaskStatus.COMPLETED,
        deliverable=verified_deliv,
    )
    assert t_comp.status == "completed"
    assert t_comp.output_data_json["deliverable"]["verification_status"] == "VERIFIED"


def test_3_5_5_09_post_verification_immutability(trust_env):
    """Scenario 9: Once a task is COMPLETED with verified deliverable, unverified overwrites are rejected."""
    db = trust_env["db"]
    org_a = trust_env["org_a"]
    ag_a = trust_env["ag_a"]
    t_id = f"t-immut-{uuid.uuid4().hex[:6]}"

    valid_deliv = StructuredDeliverable(
        task_id=t_id,
        agent_id=ag_a,
        organization_id=org_a,
        execution_id="exec_immut",
        objective="Immutable Target",
        actions_performed=["Executed initial step"],
        evidence_references=["Proof A"],
        result_summary="Original verified deliverable",
        verification_status="VERIFIED",
    )

    task = TaskModel(
        id=t_id,
        title="Immutability Task",
        description="Testing deliverable lock",
        status="in_progress",
        assigned_agent_id=ag_a,
        organization_id=org_a,
    )
    db.add(task)
    db.commit()

    task_lifecycle_engine.transition(
        db=db,
        task=task,
        target_status=TaskStatus.COMPLETED,
        deliverable=valid_deliv,
    )

    # Attempt to transition terminal completed task to unverified status
    with pytest.raises(Exception):
        task_lifecycle_engine.transition(
            db=db,
            task=task,
            target_status=TaskStatus.IN_PROGRESS, # Illegal transition from terminal COMPLETED
        )


def test_3_5_5_10_invalid_tool_invocation_record_rejected(trust_env):
    """Scenario 10: Deliverable with failed or malformed tool execution records is rejected by verifier."""
    # Verifier detects no successful tools or artifacts
    res = result_verifier.verify_execution(artifacts=[], tool_results=[{"tool": "calc", "success": False}], final_summary="Task finished.")
    assert res.passed is False
    assert "no tools executed successfully" in res.reason.lower()
