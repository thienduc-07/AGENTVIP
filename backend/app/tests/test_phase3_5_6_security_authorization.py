import threading
import uuid
import pytest
from datetime import datetime
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.core.database import SessionLocal
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.auth import OrganizationModel, UserModel, OrganizationMemberModel
from backend.app.models.artifact import ArtifactModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.specialist import SpecialistDefinitionModel
from backend.app.services.task_service import task_service
from backend.app.services.agent_service import agent_service
from backend.app.services.artifact_service import artifact_service
from backend.app.services.event_service import event_service
from backend.app.services.workstation_service import workstation_service
from backend.app.services.memory_service import memory_service
from backend.app.schemas.task import TaskCreate
from backend.app.schemas.memory import MemoryCreate
from backend.app.core.auth import create_access_token
from backend.app.core.errors import NotFoundError, ValidationError, ForbiddenError


@pytest.fixture(scope="function")
def sec_env():
    db = SessionLocal()
    org_a = f"org_sec_a_{uuid.uuid4().hex[:6]}"
    org_b = f"org_sec_b_{uuid.uuid4().hex[:6]}"

    # Seed Organizations
    o_a = OrganizationModel(id=org_a, name="Org A", slug=org_a.lower(), is_active=True)
    o_b = OrganizationModel(id=org_b, name="Org B", slug=org_b.lower(), is_active=True)
    db.add(o_a)
    db.add(o_b)

    # Seed Users
    user_a_id = f"usr_a_{uuid.uuid4().hex[:6]}"
    user_b_id = f"usr_b_{uuid.uuid4().hex[:6]}"
    u_a = UserModel(id=user_a_id, email=f"{user_a_id}@test.ai", full_name="User A", hashed_password="pw", is_active=True, is_superadmin=False)
    u_b = UserModel(id=user_b_id, email=f"{user_b_id}@test.ai", full_name="User B", hashed_password="pw", is_active=True, is_superadmin=False)
    db.add(u_a)
    db.add(u_b)

    # Org Memberships
    db.add(OrganizationMemberModel(id=f"uo_a_{uuid.uuid4().hex[:6]}", user_id=user_a_id, organization_id=org_a, role="ORGANIZATION_MEMBER"))
    db.add(OrganizationMemberModel(id=f"uo_b_{uuid.uuid4().hex[:6]}", user_id=user_b_id, organization_id=org_b, role="ORGANIZATION_MEMBER"))

    spec_def_id = f"spec_sec_{uuid.uuid4().hex[:6]}"
    spec_def = SpecialistDefinitionModel(
        id=spec_def_id,
        slug=f"spec-sec-{uuid.uuid4().hex[:6]}",
        name="Security Test Specialist",
        division="operations",
        department="analytics",
        role="Analyst",
        system_instructions="Secure instructions",
        content_hash=uuid.uuid4().hex,
        raw_content="Secure raw content",
        source_path="agents/test.md",
    )
    db.add(spec_def)

    # Seed Agents
    ag_a_id = f"ag_sec_a_{uuid.uuid4().hex[:6]}"
    ag_b_id = f"ag_sec_b_{uuid.uuid4().hex[:6]}"
    ag_a = AgentModel(id=ag_a_id, name="Agent A", role="analyst", status="idle", organization_id=org_a)
    ag_b = AgentModel(id=ag_b_id, name="Agent B", role="analyst", status="idle", organization_id=org_b)
    db.add(ag_a)
    db.add(ag_b)

    rec_a = RecruitmentRecordModel(
        id=f"rec_a_{uuid.uuid4().hex[:6]}",
        specialist_definition_id=spec_def_id,
        department="analytics",
        agent_id=ag_a_id,
        organization_id=org_a,
        lifecycle_state="ACTIVE",
    )
    rec_b = RecruitmentRecordModel(
        id=f"rec_b_{uuid.uuid4().hex[:6]}",
        specialist_definition_id=spec_def_id,
        department="analytics",
        agent_id=ag_b_id,
        organization_id=org_b,
        lifecycle_state="ACTIVE",
    )
    db.add(rec_a)
    db.add(rec_b)

    # Seed Tasks
    t_a_id = f"t_sec_a_{uuid.uuid4().hex[:6]}"
    t_b_id = f"t_sec_b_{uuid.uuid4().hex[:6]}"
    t_a = TaskModel(id=t_a_id, title="Task A", description="Confidential A", status="queued", assigned_agent_id=ag_a_id, organization_id=org_a)
    t_b = TaskModel(id=t_b_id, title="Task B", description="Confidential B", status="queued", assigned_agent_id=ag_b_id, organization_id=org_b)
    db.add(t_a)
    db.add(t_b)

    # Seed Artifact
    art_a_id = f"art_sec_a_{uuid.uuid4().hex[:6]}"
    art_a = ArtifactModel(
        id=art_a_id,
        task_id=t_a_id,
        name="secrets_a.md",
        artifact_type="report",
        storage_path="workspace_sandbox/artifacts/secrets_a.md",
        mime_type="text/markdown",
        size_bytes=42,
    )
    db.add(art_a)

    db.commit()

    # JWT Tokens
    token_a = create_access_token(user_id=user_a_id, email=f"{user_a_id}@test.ai")
    token_b = create_access_token(user_id=user_b_id, email=f"{user_b_id}@test.ai")

    yield {
        "org_a": org_a,
        "org_b": org_b,
        "u_a": user_a_id,
        "u_b": user_b_id,
        "ag_a": ag_a_id,
        "ag_b": ag_b_id,
        "t_a": t_a_id,
        "t_b": t_b_id,
        "art_a": art_a_id,
        "token_a": token_a,
        "token_b": token_b,
        "db": db,
    }

    cleanup_db = SessionLocal()
    try:
        cleanup_db.query(ArtifactModel).filter(ArtifactModel.id == art_a_id).delete()
        cleanup_db.query(TaskModel).filter(TaskModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(AgentEventModel).filter(AgentEventModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(SpecialistDefinitionModel).filter(SpecialistDefinitionModel.id == spec_def_id).delete()
        cleanup_db.query(AgentModel).filter(AgentModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(OrganizationMemberModel).filter(OrganizationMemberModel.organization_id.in_([org_a, org_b])).delete()
        cleanup_db.query(UserModel).filter(UserModel.id.in_([user_a_id, user_b_id])).delete()
        cleanup_db.query(OrganizationModel).filter(OrganizationModel.id.in_([org_a, org_b])).delete()
        cleanup_db.commit()
    except Exception:
        pass
    finally:
        cleanup_db.close()
    db.close()


def test_3_5_6_01_cross_organization_task_access(sec_env):
    """Scenario 1: Org B attempting to fetch Org A task receives HTTP 404."""
    client = TestClient(app)
    resp = client.get(f"/api/v1/tasks/{sec_env['t_a']}", headers={"Authorization": f"Bearer {sec_env['token_b']}"})
    assert resp.status_code == 404


def test_3_5_6_02_cross_organization_agent_access(sec_env):
    """Scenario 2: Org B querying Org A agent receives HTTP 404."""
    client = TestClient(app)
    resp = client.get(f"/api/v1/agents/{sec_env['ag_a']}", headers={"Authorization": f"Bearer {sec_env['token_b']}"})
    assert resp.status_code == 404


def test_3_5_6_03_cross_organization_specialist_access(sec_env):
    """Scenario 3: Service layer denies fetching agent from another org."""
    db = sec_env["db"]
    with pytest.raises(NotFoundError):
        agent_service.get_agent_by_id(db, agent_id=sec_env["ag_a"], organization_id=sec_env["org_b"])


def test_3_5_6_04_cross_organization_artifact_access(sec_env):
    """Scenario 4: Org B accessing Org A artifact receives HTTP 404."""
    client = TestClient(app)
    resp = client.get(f"/api/v1/artifacts/{sec_env['art_a']}", headers={"Authorization": f"Bearer {sec_env['token_b']}"})
    assert resp.status_code == 404


def test_3_5_6_05_cross_organization_event_access(sec_env):
    """Scenario 5: Org B querying /api/v1/events sees 0 Org A events."""
    db = sec_env["db"]
    event_service.create_event(db=db, event_type="task.started", agent_id=sec_env["ag_a"], task_id=sec_env["t_a"], organization_id=sec_env["org_a"])
    event_service.create_event(db=db, event_type="task.started", agent_id=sec_env["ag_b"], task_id=sec_env["t_b"], organization_id=sec_env["org_b"])

    client = TestClient(app)
    resp = client.get("/api/v1/events", headers={"Authorization": f"Bearer {sec_env['token_b']}"})
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) >= 1
    for ev in events:
        assert ev.get("task_id") != sec_env["t_a"]
        assert ev.get("agent_id") != sec_env["ag_a"]


def test_3_5_6_06_cross_organization_memory_access(sec_env):
    """Scenario 6: Memory search is strictly tenant-scoped."""
    db = sec_env["db"]
    org_a = sec_env["org_a"]
    org_b = sec_env["org_b"]

    # Org A creates confidential memory
    mem_in = MemoryCreate(
        title="Project Apollo Secret Specs",
        content="Rocket blueprint details",
        scope_type="shared",
        scope_id=org_a,
    )
    memory_service.create_memory(
        db=db,
        data=mem_in,
        auto_activate=True,
        organization_id=org_a,
    )

    # Org B searches for Apollo
    results = memory_service.search_memories(db=db, query="Apollo Rocket", organization_id=org_b)
    assert results.total == 0


def test_3_5_6_07_unauthorized_task_cancellation(sec_env):
    """Scenario 7: Org B cannot cancel Org A's task."""
    client = TestClient(app)
    resp = client.post(f"/api/v1/tasks/{sec_env['t_a']}/cancel", headers={"Authorization": f"Bearer {sec_env['token_b']}"})
    assert resp.status_code == 404

    # Verify task remains queued
    db = sec_env["db"]
    reloaded = db.query(TaskModel).filter(TaskModel.id == sec_env["t_a"]).first()
    assert reloaded.status == "queued"


def test_3_5_6_08_unauthorized_agent_assignment(sec_env):
    """Scenario 8: Org B cannot assign Org A's agent to a new task."""
    db = sec_env["db"]
    task_in = TaskCreate(
        title="Malicious Cross-Tenant Task",
        description="Exploit test",
        assigned_agent_id=sec_env["ag_a"], # Belongs to Org A
    )
    with pytest.raises(ValidationError) as exc:
        task_service.create_task(db=db, task_in=task_in, organization_id=sec_env["org_b"])
    assert "cross-tenant" in str(exc.value).lower()


def test_3_5_6_09_unauthorized_workstation_access(sec_env):
    """Scenario 9: Workstation listing is isolated to user's organization."""
    db = sec_env["db"]
    org_a = sec_env["org_a"]
    org_b = sec_env["org_b"]

    ws_a = workstation_service.list_workstations_for_org(db, organization_id=org_a)
    ws_b = workstation_service.list_workstations_for_org(db, organization_id=org_b)

    # Desks allocated to Org A are not present in Org B
    desks_a = {d.get("desk_id") for d in ws_a}
    desks_b = {d.get("desk_id") for d in ws_b}
    assert desks_a.isdisjoint(desks_b)


def test_3_5_6_10_organization_membership_revocation(sec_env):
    """Scenario 10: Inactive or suspended organization access is denied."""
    db = sec_env["db"]
    org_b_rec = db.query(OrganizationModel).filter(OrganizationModel.id == sec_env["org_b"]).first()
    org_b_rec.is_active = False
    db.commit()

    # User B should be blocked because their organization is deactivated
    client = TestClient(app)
    resp = client.get("/api/v1/tasks", headers={"Authorization": f"Bearer {sec_env['token_b']}"})
    assert resp.status_code in (401, 403, 404)


def test_3_5_6_11_privilege_escalation_denied(sec_env):
    """Scenario 11: Non-superadmin user attempting superadmin cross-tenant operations is denied."""
    client = TestClient(app)
    # User A tries to pass organization_id=org_b as query param to view Org B tasks
    resp = client.get(f"/api/v1/tasks?organization_id={sec_env['org_b']}", headers={"Authorization": f"Bearer {sec_env['token_a']}"})
    # Server enforces authenticated tenant scope; explicitly returns HTTP 403 Forbidden
    assert resp.status_code == 403
    body = resp.json()
    err_msg = body.get("error", {}).get("message", "") or body.get("detail", "")
    assert "Forbidden" in err_msg


def test_3_5_6_12_resource_enumeration_anti_enumeration_404(sec_env):
    """Scenario 12: Probing non-existent or foreign UUIDs returns 404, never 403."""
    client = TestClient(app)
    random_uuid = f"t-{uuid.uuid4()}"
    resp = client.get(f"/api/v1/tasks/{random_uuid}", headers={"Authorization": f"Bearer {sec_env['token_a']}"})
    assert resp.status_code == 404
    # Foreign task also returns 404
    resp_foreign = client.get(f"/api/v1/tasks/{sec_env['t_b']}", headers={"Authorization": f"Bearer {sec_env['token_a']}"})
    assert resp_foreign.status_code == 404


def test_3_5_6_13_missing_organization_context(sec_env):
    """Scenario 13: Unauthenticated request without org token is rejected with 401."""
    client = TestClient(app)
    resp = client.get("/api/v1/tasks")
    assert resp.status_code in (401, 403)


def test_3_5_6_14_invalid_organization_context(sec_env):
    """Scenario 14: Creating task with invalid/non-existent org ID is rejected."""
    db = sec_env["db"]
    task_in = TaskCreate(
        title="Invalid Org Task",
        description="Non-existent org",
        assigned_agent_id=sec_env["ag_a"],
    )
    with pytest.raises(Exception):
        task_service.create_task(db=db, task_in=task_in, organization_id="non-existent-org-99999")


def test_3_5_6_15_concurrent_access_different_organizations(sec_env):
    """Scenario 15: Concurrent API requests under different orgs maintain perfect data isolation."""
    client = TestClient(app)
    errors = []
    seen_orgs = []

    def make_request(token, expected_org):
        try:
            resp = client.get("/api/v1/tasks", headers={"Authorization": f"Bearer {token}"})
            assert resp.status_code == 200
            for t in resp.json():
                assert t["organization_id"] == expected_org
                seen_orgs.append(expected_org)
        except Exception as e:
            errors.append(e)

    threads = []
    for _ in range(5):
        threads.append(threading.Thread(target=make_request, args=(sec_env["token_a"], sec_env["org_a"])))
        threads.append(threading.Thread(target=make_request, args=(sec_env["token_b"], sec_env["org_b"])))

    for th in threads:
        th.start()
    for th in threads:
        th.join()

    assert len(errors) == 0, f"Errors in concurrent multi-tenant requests: {errors}"
    assert len(seen_orgs) > 0
