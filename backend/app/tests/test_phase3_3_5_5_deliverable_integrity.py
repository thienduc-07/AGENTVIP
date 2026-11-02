import asyncio
import hashlib
import os
import uuid
import pytest
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.core.database import SessionLocal
from backend.app.core.config import settings
from backend.app.models.agent import AgentModel
from backend.app.models.auth import OrganizationModel, UserModel
from backend.app.models.task import TaskModel
from backend.app.models.artifact import ArtifactModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.agent_runtime.contracts.deliverable_contract import StructuredDeliverable
from backend.app.agent_runtime.verifier import ResultVerifier, VerificationOutcome
from backend.app.agent_runtime.lifecycle.task_lifecycle import task_lifecycle_engine, TaskStatus
from backend.app.agent_runtime.tools.workspace.workspace_write import WorkspaceWriteTool
from backend.app.agent_runtime.tools.security import safe_resolve_path, PathSecurityError
from backend.app.core.auth import get_current_user, get_current_tenant_org, UserContext


@pytest.fixture
def deliverable_env():
    db = SessionLocal()
    u_tag = uuid.uuid4().hex[:8]
    org_id = f"org_deliv_{u_tag}"
    org = OrganizationModel(id=org_id, name="Deliverable Test Org", slug=org_id.lower(), is_active=True)
    db.add(org)

    agent = AgentModel(
        id=f"ag_deliv_{u_tag}",
        name="Deliverable Specialist",
        role="Specialist",
        organization_id=org_id,
        status="idle",
        behavioral_state="IDLE",
    )
    db.add(agent)
    db.commit()

    yield {
        "db": db,
        "org_id": org_id,
        "agent": agent,
        "u_tag": u_tag,
    }

    try:
        db.query(ArtifactModel).filter(ArtifactModel.task_id.like(f"%{u_tag}%")).delete(synchronize_session=False)
        db.query(TaskModel).filter(TaskModel.organization_id == org_id).delete(synchronize_session=False)
        db.query(AgentEventModel).filter(AgentEventModel.organization_id == org_id).delete(synchronize_session=False)
        db.query(AgentModel).filter(AgentModel.organization_id == org_id).delete(synchronize_session=False)
        db.query(OrganizationModel).filter(OrganizationModel.id == org_id).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
    db.close()


@pytest.mark.asyncio
async def test_3_3_5_5_01_deliverable_file_exists_and_sha256_matches(deliverable_env):
    """1. Deliverable file exists on disk at referenced path: SHA-256 matches recorded hash."""
    u_tag = deliverable_env["u_tag"]
    tool = WorkspaceWriteTool()
    rel_path = f"artifacts/verified_report_{u_tag}.md"
    content = "# Certified Executive Report\nAll metrics verified authentically."

    res = await tool.execute({"filepath": rel_path, "content": content, "overwrite": True})
    assert res.success is True

    disk_file = settings.SANDBOX_DIR / rel_path
    assert disk_file.exists()
    computed_hash = hashlib.sha256(disk_file.read_bytes()).hexdigest()

    deliv_dict = {
        "artifact_paths": [str(disk_file.relative_to(settings.WORKSPACE_ROOT))],
        "artifact_hashes": {str(disk_file.relative_to(settings.WORKSPACE_ROOT)): computed_hash},
    }
    outcome = ResultVerifier.verify_deliverable_integrity(deliv_dict)
    assert outcome.passed is True

    # Cleanup
    if disk_file.exists():
        disk_file.unlink()


@pytest.mark.asyncio
async def test_3_3_5_5_02_deliverable_file_tampered_hash_mismatch_fails(deliverable_env):
    """2. Deliverable file tampered with after creation: hash mismatch detected, verification fails."""
    u_tag = deliverable_env["u_tag"]
    tool = WorkspaceWriteTool()
    rel_path = f"artifacts/tamper_{u_tag}.md"
    original_content = "Original authentic financial projections."

    await tool.execute({"filepath": rel_path, "content": original_content, "overwrite": True})
    disk_file = settings.SANDBOX_DIR / rel_path
    original_hash = hashlib.sha256(disk_file.read_bytes()).hexdigest()

    # Tamper with file
    disk_file.write_text("TAMPERED CONTENT: Fraudulent financial figures injected.")

    deliv_dict = {
        "artifact_paths": [str(disk_file.relative_to(settings.WORKSPACE_ROOT))],
        "artifact_hashes": {str(disk_file.relative_to(settings.WORKSPACE_ROOT)): original_hash},
    }
    outcome = ResultVerifier.verify_deliverable_integrity(deliv_dict)
    assert outcome.passed is False
    assert "tampered with" in outcome.reason.lower()

    if disk_file.exists():
        disk_file.unlink()


def test_3_3_5_5_03_deliverable_file_deleted_fails(deliverable_env):
    """3. Deliverable file deleted after creation: missing file detected, verification fails."""
    ghost_path = f"artifacts/ghost_file_{uuid.uuid4().hex[:8]}.md"
    deliv_dict = {
        "artifact_paths": [ghost_path],
        "artifact_hashes": {ghost_path: "fakehash123"},
    }
    outcome = ResultVerifier.verify_deliverable_integrity(deliv_dict)
    assert outcome.passed is False
    assert "missing" in outcome.reason.lower()


def test_3_3_5_5_04_path_traversal_rejected(deliverable_env):
    """4. Deliverable referencing path outside allowed directory: path traversal rejected."""
    # 1. safe_resolve_path security test
    with pytest.raises(PathSecurityError):
        safe_resolve_path("../../etc/passwd", base_root=settings.SANDBOX_DIR, must_exist=False)

    # 2. ResultVerifier integrity check
    deliv_dict = {
        "artifact_paths": ["../../etc/passwd"],
        "artifact_hashes": {"../../etc/passwd": "abc"},
    }
    outcome = ResultVerifier.verify_deliverable_integrity(deliv_dict)
    assert outcome.passed is False
    assert "security violation" in outcome.reason.lower()


def test_3_3_5_5_05_empty_content_rejected(deliverable_env):
    """5. Deliverable with empty content: rejected as non-substantive."""
    u_tag = deliverable_env["u_tag"]
    empty_file = settings.SANDBOX_DIR / f"artifacts/empty_{u_tag}.txt"
    empty_file.parent.mkdir(parents=True, exist_ok=True)
    empty_file.write_text("")

    artifacts = [{
        "filepath": str(empty_file.relative_to(settings.WORKSPACE_ROOT)),
        "absolute_path": str(empty_file),
    }]
    outcome = ResultVerifier.verify_execution(
        artifacts=artifacts,
        tool_results=[{"tool": "write", "success": True}],
        final_summary="Finished with empty report.",
    )
    assert outcome.passed is False
    assert "empty (0 bytes)" in outcome.reason.lower()

    if empty_file.exists():
        empty_file.unlink()


def test_3_3_5_5_06_structured_deliverable_format_verification(deliverable_env):
    """6. Complete structured deliverable with title, summary, evidence, artifact_hashes: verified successfully."""
    agent = deliverable_env["agent"]
    deliv = StructuredDeliverable(
        deliverable_id=f"deliv-{uuid.uuid4().hex[:8]}",
        task_id=f"task-{uuid.uuid4().hex[:8]}",
        agent_id=agent.id,
        execution_id=f"exec-{uuid.uuid4().hex[:8]}",
        objective="Market Analysis Comprehensive Report",
        result_summary="Verified complete market analysis with competitive metrics.",
        evidence_references=["calc: 50 * 2 = 100", "web_search: 5 sources cited"],
        artifact_paths=["artifacts/summary.md"],
        artifact_hashes={"artifacts/summary.md": "a1b2c3d4e5f6"},
        verification_status="VERIFIED",
    )
    d_dict = deliv.to_dict()
    assert d_dict["verification_status"] == "VERIFIED"
    assert len(d_dict["evidence_references"]) == 2
    assert "artifacts/summary.md" in d_dict["artifact_hashes"]


@pytest.mark.asyncio
async def test_3_3_5_5_07_deliverable_and_artifact_api_retrieval(deliverable_env):
    """7. Deliverable retrieved through API endpoint: returns authentic content matching disk."""
    db = deliverable_env["db"]
    org_id = deliverable_env["org_id"]
    agent = deliverable_env["agent"]
    u_tag = deliverable_env["u_tag"]

    # 1. Create task with deliverable
    task_id = f"task-api-deliv-{u_tag}"
    deliv = StructuredDeliverable(
        deliverable_id=f"deliv-api-{u_tag}",
        task_id=task_id,
        agent_id=agent.id,
        execution_id=f"exec-api-{u_tag}",
        objective="Executive Audit Deliverable",
        result_summary="Verified audit data and financial charts.",
        evidence_references=["Verified 100% data fidelity"],
        artifact_paths=[f"artifacts/api_rep_{u_tag}.md"],
        artifact_hashes={f"artifacts/api_rep_{u_tag}.md": "hash123"},
        verification_status="VERIFIED",
    )
    task = TaskModel(
        id=task_id,
        organization_id=org_id,
        task_type="subtask",
        title="API Deliverable Task",
        description="Testing API endpoint retrieval",
        assigned_agent_id=agent.id,
        status="completed",
        output_data_json={"deliverable": deliv.to_dict()},
    )
    # Write artifact file
    art_file = settings.SANDBOX_DIR / f"artifacts/api_rep_{u_tag}.md"
    art_file.parent.mkdir(parents=True, exist_ok=True)
    art_content = "# Real Artifact Content for API Verification\nStatus: PASS."
    art_file.write_text(art_content, encoding="utf-8")

    artifact_id = f"art-api-{u_tag}"
    db_art = ArtifactModel(
        id=artifact_id,
        task_id=task_id,
        name=f"api_rep_{u_tag}.md",
        artifact_type="report",
        storage_path=str(art_file.relative_to(settings.WORKSPACE_ROOT)),
        mime_type="text/markdown",
        size_bytes=len(art_content.encode("utf-8")),
    )
    db.add(task)
    db.add(db_art)
    db.commit()

    # Create test client with tenant auth override
    app.dependency_overrides[get_current_tenant_org] = lambda: org_id
    app.dependency_overrides[get_current_user] = lambda: UserContext(user_id="test-user", email="test@provip.ai", is_superadmin=False, org_roles={org_id: "admin"})

    client = TestClient(app)

    # GET /api/v1/tasks/{task_id}/deliverable
    resp_deliv = client.get(f"/api/v1/tasks/{task_id}/deliverable")
    assert resp_deliv.status_code == 200
    deliv_data = resp_deliv.json()
    assert deliv_data["deliverable_id"] == f"deliv-api-{u_tag}"
    assert deliv_data["verification_status"] == "VERIFIED"

    # GET /api/v1/artifacts/{artifact_id}/content
    resp_art_content = client.get(f"/api/v1/artifacts/{artifact_id}/content")
    assert resp_art_content.status_code == 200
    assert resp_art_content.json()["content"] == art_content

    # Clean overrides & disk
    app.dependency_overrides.clear()
    if art_file.exists():
        art_file.unlink()


@pytest.mark.asyncio
async def test_3_3_5_5_08_concurrent_deliverable_verification(deliverable_env):
    """8. Concurrent deliverable verification: 10 deliverables verified simultaneously without race conditions."""
    u_tag = deliverable_env["u_tag"]
    created_files = []

    # Prepare 10 physical files
    deliv_dicts = []
    for i in range(10):
        f = settings.SANDBOX_DIR / f"artifacts/conc_deliv_{i}_{u_tag}.md"
        f.parent.mkdir(parents=True, exist_ok=True)
        txt = f"Concurrent artifact content {i}"
        f.write_text(txt, encoding="utf-8")
        created_files.append(f)
        h = hashlib.sha256(f.read_bytes()).hexdigest()
        rel = str(f.relative_to(settings.WORKSPACE_ROOT))
        deliv_dicts.append({
            "artifact_paths": [rel],
            "artifact_hashes": {rel: h},
        })

    # Concurrently verify all 10 deliverables
    loop = asyncio.get_event_loop()
    outcomes = await asyncio.gather(*[
        loop.run_in_executor(None, ResultVerifier.verify_deliverable_integrity, d)
        for d in deliv_dicts
    ])

    assert len(outcomes) == 10
    assert all(o.passed is True for o in outcomes)

    # Cleanup
    for f in created_files:
        if f.exists():
            f.unlink()


def test_3_3_5_5_09_completed_deliverable_immutability(deliverable_env):
    """9. Deliverable immutability: completed task's deliverable cannot be silently overwritten."""
    db = deliverable_env["db"]
    org_id = deliverable_env["org_id"]
    agent = deliverable_env["agent"]

    initial_deliv = StructuredDeliverable(
        deliverable_id=f"deliv-orig-{uuid.uuid4().hex[:8]}",
        task_id=f"task-immut-{uuid.uuid4().hex[:8]}",
        agent_id=agent.id,
        execution_id="exec-1",
        objective="Permanent Deliverable",
        result_summary="Original verified summary.",
        evidence_references=["Proof 1"],
        verification_status="VERIFIED",
    )
    task = TaskModel(
        id=initial_deliv.task_id,
        organization_id=org_id,
        task_type="subtask",
        title="Immutable Task",
        description="Testing immutability",
        assigned_agent_id=agent.id,
        status="completed",
        output_data_json={"deliverable": initial_deliv.to_dict()},
    )
    db.add(task)
    db.commit()

    # Attempt to overwrite deliverable with unverified draft
    hostile_deliv = StructuredDeliverable(
        deliverable_id="deliv-hostile-overwrite",
        task_id=task.id,
        agent_id=agent.id,
        execution_id="exec-2",
        objective="Hostile Takeover",
        result_summary="Counterfeit summary.",
        evidence_references=[],
        verification_status="DRAFT",
    )
    # Transition engine should preserve original verified deliverable
    task_lifecycle_engine.transition(
        db=db,
        task=task,
        target_status=TaskStatus.COMPLETED,
        deliverable=hostile_deliv,
        commit=True,
    )

    db.expire_all()
    reloaded = db.query(TaskModel).filter(TaskModel.id == task.id).first()
    # Verified deliverable remains untouched
    assert reloaded.output_data_json["deliverable"]["deliverable_id"] == initial_deliv.deliverable_id
    assert reloaded.output_data_json["deliverable"]["verification_status"] == "VERIFIED"


def test_3_3_5_5_10_deliverable_audit_trail(deliverable_env):
    """10. Deliverable audit trail: deliverable submission and verification emit events with timestamps."""
    db = deliverable_env["db"]
    org_id = deliverable_env["org_id"]
    agent = deliverable_env["agent"]

    deliv_id = f"deliv-audit-{uuid.uuid4().hex[:8]}"
    task_id = f"task-audit-{uuid.uuid4().hex[:8]}"

    task = TaskModel(id=task_id, organization_id=org_id, task_type="subtask", title="Audit Task", description="Testing audit trail", assigned_agent_id=agent.id, status="running")
    db.add(task)
    db.commit()

    from backend.app.services.event_service import event_service, DELIVERABLE_SUBMITTED, DELIVERABLE_VERIFIED

    ev_sub = event_service.create_event(
        db=db,
        event_type=DELIVERABLE_SUBMITTED,
        agent_id=agent.id,
        task_id=task_id,
        organization_id=org_id,
        payload={"deliverable_id": deliv_id, "status": "submitted"},
    )
    ev_ver = event_service.create_event(
        db=db,
        event_type=DELIVERABLE_VERIFIED,
        agent_id=agent.id,
        task_id=task_id,
        organization_id=org_id,
        payload={"deliverable_id": deliv_id, "verification_status": "VERIFIED"},
    )

    assert ev_sub.id is not None
    assert ev_ver.id is not None
    assert ev_sub.sequence_id < ev_ver.sequence_id
    assert ev_sub.created_at <= ev_ver.created_at
