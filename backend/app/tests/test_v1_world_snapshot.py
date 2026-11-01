import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.main import app
from backend.app.core.database import SessionLocal
from backend.app.core.auth import create_access_token
from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.task_step import TaskStepModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.specialist import SpecialistDefinitionModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.services.event_service import event_service
from backend.app.schemas.world import WorldSnapshotResponse
from backend.app.scripts.seed import CORPORATE_AGENTS

@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.rollback()
        db.close()

@pytest.fixture
def world_setup(db_session: Session):
    # 1. Setup Tenant Org Alpha as default corporate organization
    org_a = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_default_company").first()
    if not org_a:
        org_a = OrganizationModel(
            id="org_default_company",
            name="Default Corporate AI Agency",
            slug="default-company",
            is_active=True,
        )
        db_session.add(org_a)

    # 2. Setup Tenant Org Beta (for unauthorized multi-tenant tests)
    org_b = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_world_beta").first()
    if not org_b:
        org_b = OrganizationModel(
            id="org_world_beta",
            name="Beta Competitor Inc",
            slug="beta-competitor",
            is_active=True,
        )
        db_session.add(org_b)

    # 3. Setup User Alpha
    user_a = db_session.query(UserModel).filter(UserModel.id == "usr_world_alpha").first()
    if not user_a:
        user_a = UserModel(
            id="usr_world_alpha",
            email="ceo@alpha.ai",
            full_name="Alpha CEO",
            hashed_password="hashed_placeholder",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_a)

    # 4. Setup Membership Alpha (in org_default_company)
    mem_a = db_session.query(OrganizationMemberModel).filter(OrganizationMemberModel.id == "mem_world_alpha").first()
    if not mem_a:
        mem_a = OrganizationMemberModel(
            id="mem_world_alpha",
            user_id="usr_world_alpha",
            organization_id="org_default_company",
            role="ORGANIZATION_OWNER",
        )
        db_session.add(mem_a)
    else:
        mem_a.organization_id = "org_default_company"

    # 5. Setup User Beta
    user_b = db_session.query(UserModel).filter(UserModel.id == "usr_world_beta").first()
    if not user_b:
        user_b = UserModel(
            id="usr_world_beta",
            email="guest@beta.ai",
            full_name="Beta Guest",
            hashed_password="hashed_placeholder",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_b)

    # 6. Setup Membership Beta
    mem_b = db_session.query(OrganizationMemberModel).filter(OrganizationMemberModel.id == "mem_world_beta").first()
    if not mem_b:
        mem_b = OrganizationMemberModel(
            id="mem_world_beta",
            user_id="usr_world_beta",
            organization_id="org_world_beta",
            role="ORGANIZATION_MEMBER",
        )
        db_session.add(mem_b)
    else:
        mem_b.organization_id = "org_world_beta"

    # 7. Ensure corporate agents exist in org_default_company
    for corp in CORPORATE_AGENTS:
        existing = db_session.query(AgentModel).filter(AgentModel.id == corp["id"]).first()
        if not existing:
            agent = AgentModel(
                id=corp["id"],
                name=corp["name"],
                role=corp["role"],
                station=corp.get("station", "captain_hq"),
                status=corp.get("status", "idle"),
                color=corp.get("color", "#3b82f6"),
                avatar=corp.get("avatar", "captain"),
                pos_x=corp.get("pos_x", 0.0),
                pos_y=corp.get("pos_y", 0.0),
                pos_z=corp.get("pos_z", 0.0),
                description=corp.get("description", ""),
                organization_id="org_default_company",
            )
            db_session.add(agent)

    db_session.commit()

    token_alpha = create_access_token(user_id="usr_world_alpha", email="ceo@alpha.ai", token_version=1)
    token_beta = create_access_token(user_id="usr_world_beta", email="guest@beta.ai", token_version=1)

    return {
        "org_alpha": "org_default_company",
        "org_beta": "org_world_beta",
        "token_alpha": token_alpha,
        "token_beta": token_beta,
    }


def test_01_snapshot_all_eight_corporate_employees(world_setup):
    """1. Snapshot with all eight corporate employees."""
    client = TestClient(app)
    headers = {
        "Authorization": f"Bearer {world_setup['token_alpha']}",
        "X-Organization-Id": world_setup["org_alpha"],
    }
    response = client.get("/api/v1/world/snapshot", headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["organization_id"] == world_setup["org_alpha"]
    assert data["schema_version"] == "3.3.1"
    assert data["summary"]["total_employees"] >= 8
    assert data["summary"]["active_employees"] >= 8

    expected_ids = {
        "agent-exec-ceo",
        "agent-eng-lead",
        "agent-research-ai",
        "agent-mkt-growth",
        "agent-sales-director",
        "agent-fin-controller",
        "agent-ops-recruiter",
        "agent-support-lead",
    }
    retrieved_ids = {a["employee_id"] for a in data["agents"]}
    for exp_id in expected_ids:
        assert exp_id in retrieved_ids, f"Expected corporate employee {exp_id} not found in snapshot"

    # Verify corporate employees default to ACTIVE lifecycle state
    for a in data["agents"]:
        if a["employee_id"] in expected_ids:
            assert a["lifecycle_state"] == "ACTIVE"


def test_02_snapshot_dynamically_recruited_specialists(world_setup, db_session: Session):
    """2. Snapshot with dynamically recruited specialists."""
    client = TestClient(app)
    # Create specialist definition if missing
    spec = db_session.query(SpecialistDefinitionModel).first()
    if not spec:
        spec = SpecialistDefinitionModel(
            id="spec_test_mlops",
            slug="engineering-mlops-specialist",
            name="MLOps Automation Specialist",
            division="engineering",
            department="Engineering",
            role="MLOps Engineer",
            description="Manage ML deployment pipelines.",
            system_instructions="Manage ML deployment pipelines.",
            source_path="engineering/mlops.md",
            content_hash="dummy_hash_mlops",
            raw_content="MLOps content",
        )
        db_session.add(spec)
        db_session.flush()

    # Create recruited agent
    rec_agent_id = "recruited-spec-test-mlops-1234"
    agent = db_session.query(AgentModel).filter_by(id=rec_agent_id).first()
    if not agent:
        agent = AgentModel(
            id=rec_agent_id,
            name="MLOps Automation Specialist",
            role="MLOps Engineer",
            status="idle",
            organization_id=world_setup["org_alpha"],
        )
        db_session.add(agent)
        db_session.flush()

    # Create recruitment record
    rec_record = db_session.query(RecruitmentRecordModel).filter_by(agent_id=rec_agent_id).first()
    if not rec_record:
        rec_record = RecruitmentRecordModel(
            specialist_definition_id=spec.id,
            agent_id=rec_agent_id,
            department="Engineering",
            lifecycle_state="ACTIVE",
            permission_profile="standard_specialist",
        )
        db_session.add(rec_record)
        db_session.commit()

    headers = {
        "Authorization": f"Bearer {world_setup['token_alpha']}",
        "X-Organization-Id": world_setup["org_alpha"],
    }
    res = client.get("/api/v1/world/snapshot", headers=headers)
    assert res.status_code == 200
    data = res.json()

    recruited_items = [a for a in data["agents"] if a["employee_id"] == rec_agent_id]
    assert len(recruited_items) == 1
    item = recruited_items[0]
    assert item["name"] == "MLOps Automation Specialist"
    assert item["department"] == "Engineering"
    assert item["lifecycle_state"] == "ACTIVE"


def test_03_snapshot_agent_without_assigned_workstation(world_setup, db_session: Session):
    """3. Agent without an assigned workstation explicitly returns null."""
    client = TestClient(app)
    unseated_id = "agent-remote-consultant-01"
    agent = db_session.query(AgentModel).filter_by(id=unseated_id).first()
    if not agent:
        agent = AgentModel(
            id=unseated_id,
            name="Remote Consultant",
            role="Advisory Specialist",
            status="idle",
            organization_id=world_setup["org_alpha"],
        )
        db_session.add(agent)
        db_session.commit()

    # Ensure no workstation allocation exists
    db_session.query(WorkstationAllocationModel).filter_by(agent_id=unseated_id).delete()
    db_session.commit()

    headers = {
        "Authorization": f"Bearer {world_setup['token_alpha']}",
        "X-Organization-Id": world_setup["org_alpha"],
    }
    res = client.get("/api/v1/world/snapshot", headers=headers)
    assert res.status_code == 200
    data = res.json()

    agent_entry = next(a for a in data["agents"] if a["employee_id"] == unseated_id)
    assert agent_entry["assigned_workstation"] is None


def test_04_snapshot_agent_with_active_task(world_setup, db_session: Session):
    """4. Agent with an active task reports active execution and step details."""
    client = TestClient(app)
    # Assign active task to agent-eng-lead
    task_id = "task-active-exec-001"
    db_session.query(TaskModel).filter_by(id=task_id).delete()
    db_session.commit()

    task = TaskModel(
        id=task_id,
        title="Implement Core Microservice",
        description="Build secure microservice endpoints.",
        status="running",
        priority="high",
        assigned_agent_id="agent-eng-lead",
        organization_id=world_setup["org_alpha"],
        started_at=datetime.utcnow(),
    )
    db_session.add(task)

    step = TaskStepModel(
        id="step-exec-001",
        task_id=task_id,
        step_index=1,
        title="Executing tool: workspace.write_file",
        status="running",
        started_at=datetime.utcnow(),
    )
    db_session.add(step)

    eng_lead = db_session.query(AgentModel).filter_by(id="agent-eng-lead").first()
    eng_lead.status = "working"
    eng_lead.current_task_id = task_id
    db_session.commit()

    headers = {
        "Authorization": f"Bearer {world_setup['token_alpha']}",
        "X-Organization-Id": world_setup["org_alpha"],
    }
    res = client.get("/api/v1/world/snapshot", headers=headers)
    assert res.status_code == 200
    data = res.json()

    agent_entry = next(a for a in data["agents"] if a["employee_id"] == "agent-eng-lead")
    assert agent_entry["operational_status"] == "working"
    assert agent_entry["current_active_task"] is not None
    assert agent_entry["current_active_task"]["task_id"] == task_id
    assert agent_entry["current_active_task"]["title"] == "Implement Core Microservice"

    activity_entry = next(act for act in data["activities"] if act["agent_id"] == "agent-eng-lead")
    assert activity_entry["activity_type"] == "tool_execution"
    assert activity_entry["task_id"] == task_id
    assert activity_entry["current_tool"] == "workspace.write_file"
    assert activity_entry["current_execution_step"] == "Executing tool: workspace.write_file"


def test_05_snapshot_agent_with_no_active_task(world_setup, db_session: Session):
    """5. Agent with no active task reports idle_standby with null task info."""
    client = TestClient(app)
    ceo = db_session.query(AgentModel).filter_by(id="agent-exec-ceo").first()
    ceo.status = "idle"
    ceo.current_task_id = None
    db_session.commit()

    headers = {
        "Authorization": f"Bearer {world_setup['token_alpha']}",
        "X-Organization-Id": world_setup["org_alpha"],
    }
    res = client.get("/api/v1/world/snapshot", headers=headers)
    assert res.status_code == 200
    data = res.json()

    ceo_entry = next(a for a in data["agents"] if a["employee_id"] == "agent-exec-ceo")
    assert ceo_entry["operational_status"] == "idle"
    assert ceo_entry["current_active_task"] is None

    ceo_act = next(act for act in data["activities"] if act["agent_id"] == "agent-exec-ceo")
    assert ceo_act["activity_type"] == "idle_standby"
    assert ceo_act["task_id"] is None
    assert ceo_act["current_tool"] is None


def test_06_snapshot_suspended_employee(world_setup, db_session: Session):
    """6. Suspended employee reports SUSPENDED lifecycle state and activity."""
    client = TestClient(app)
    susp_id = "agent-suspended-spec-01"
    agent = db_session.query(AgentModel).filter_by(id=susp_id).first()
    if not agent:
        agent = AgentModel(
            id=susp_id,
            name="Suspended Engineer",
            role="Security Auditor",
            status="idle",
            organization_id=world_setup["org_alpha"],
        )
        db_session.add(agent)
        db_session.flush()

    spec = db_session.query(SpecialistDefinitionModel).first()
    rec = db_session.query(RecruitmentRecordModel).filter_by(agent_id=susp_id).first()
    if not rec:
        rec = RecruitmentRecordModel(
            specialist_definition_id=spec.id,
            agent_id=susp_id,
            department="Engineering",
            lifecycle_state="SUSPENDED",
        )
        db_session.add(rec)
    else:
        rec.lifecycle_state = "SUSPENDED"
    db_session.commit()

    headers = {
        "Authorization": f"Bearer {world_setup['token_alpha']}",
        "X-Organization-Id": world_setup["org_alpha"],
    }
    res = client.get("/api/v1/world/snapshot", headers=headers)
    assert res.status_code == 200
    data = res.json()

    susp_entry = next(a for a in data["agents"] if a["employee_id"] == susp_id)
    assert susp_entry["lifecycle_state"] == "SUSPENDED"

    susp_act = next(act for act in data["activities"] if act["agent_id"] == susp_id)
    assert susp_act["activity_type"] == "suspended"


def test_07_snapshot_offboarded_employee(world_setup, db_session: Session):
    """7. Offboarded employee reports OFFBOARDED lifecycle state and offline activity."""
    client = TestClient(app)
    off_id = "agent-offboarded-spec-02"
    agent = db_session.query(AgentModel).filter_by(id=off_id).first()
    if not agent:
        agent = AgentModel(
            id=off_id,
            name="Offboarded Specialist",
            role="Former Analyst",
            status="offline",
            organization_id=world_setup["org_alpha"],
        )
        db_session.add(agent)
        db_session.flush()

    spec = db_session.query(SpecialistDefinitionModel).first()
    rec = db_session.query(RecruitmentRecordModel).filter_by(agent_id=off_id).first()
    if not rec:
        rec = RecruitmentRecordModel(
            specialist_definition_id=spec.id,
            agent_id=off_id,
            department="Finance",
            lifecycle_state="OFFBOARDED",
        )
        db_session.add(rec)
    else:
        rec.lifecycle_state = "OFFBOARDED"
    db_session.commit()

    headers = {
        "Authorization": f"Bearer {world_setup['token_alpha']}",
        "X-Organization-Id": world_setup["org_alpha"],
    }
    res = client.get("/api/v1/world/snapshot", headers=headers)
    assert res.status_code == 200
    data = res.json()

    off_entry = next(a for a in data["agents"] if a["employee_id"] == off_id)
    assert off_entry["lifecycle_state"] == "OFFBOARDED"

    off_act = next(act for act in data["activities"] if act["agent_id"] == off_id)
    assert off_act["activity_type"] == "offline"


def test_08_snapshot_empty_workstation(world_setup, db_session: Session):
    """8. Empty workstation reports vacant occupancy status."""
    client = TestClient(app)
    ws_id = "ws-eng-vacant-desk-99"
    db_session.query(WorkstationAllocationModel).filter_by(logical_workstation_id=ws_id).delete()

    ph_agent = db_session.query(AgentModel).filter_by(id="agent-vacant-ph").first()
    if not ph_agent:
        ph_agent = AgentModel(
            id="agent-vacant-ph",
            name="Vacant Placeholder",
            role="Vacant Placeholder",
            status="offline",
            organization_id=world_setup["org_alpha"],
        )
        db_session.add(ph_agent)
        db_session.flush()

    alloc = WorkstationAllocationModel(
        organization_id=world_setup["org_alpha"],
        agent_id=ph_agent.id,
        department="Engineering",
        logical_workstation_id=ws_id,
        office_zone="Engineering Bay",
        desk_number=99,
        pos_x=-14.0,
        pos_y=1.0,
        pos_z=-4.0,
        allocation_status="UNASSIGNED",
        is_virtual=False,
    )
    db_session.add(alloc)
    db_session.commit()

    headers = {
        "Authorization": f"Bearer {world_setup['token_alpha']}",
        "X-Organization-Id": world_setup["org_alpha"],
    }
    res = client.get("/api/v1/world/snapshot", headers=headers)
    assert res.status_code == 200
    data = res.json()

    ws_entry = next(w for w in data["workstations"] if w["workstation_id"] == ws_id)
    assert ws_entry["occupancy_status"] == "vacant"
    assert ws_entry["assigned_employee"] is None
    assert "code_sandbox" in ws_entry["capabilities"]


def test_09_snapshot_missing_workstation_data(world_setup, db_session: Session):
    """9. Missing workstation data handled gracefully without crash."""
    client = TestClient(app)
    # Clear all allocations for org beta
    db_session.query(WorkstationAllocationModel).filter_by(organization_id=world_setup["org_beta"]).delete()
    db_session.commit()

    headers = {
        "Authorization": f"Bearer {world_setup['token_beta']}",
        "X-Organization-Id": world_setup["org_beta"],
    }
    res = client.get("/api/v1/world/snapshot", headers=headers)
    assert res.status_code == 200
    data = res.json()

    assert data["organization_id"] == world_setup["org_beta"]
    assert data["workstations"] == []
    # All 60 physical desks available
    assert data["summary"]["available_workstations"] == 60


def test_10_snapshot_authentication_failure():
    """10. Authentication failure rejected with 401."""
    client = TestClient(app)
    # No auth header
    res1 = client.get("/api/v1/world/snapshot")
    assert res1.status_code == 401

    # Invalid bearer token
    res2 = client.get("/api/v1/world/snapshot", headers={"Authorization": "Bearer invalid_garbage_token"})
    assert res2.status_code == 401


def test_11_snapshot_unauthorized_organization_access(world_setup):
    """11. Cross-tenant access rejected with 403 Forbidden."""
    client = TestClient(app)
    # User Beta attempting to access Org Alpha
    headers = {
        "Authorization": f"Bearer {world_setup['token_beta']}",
        "X-Organization-Id": world_setup["org_alpha"],
    }
    res = client.get("/api/v1/world/snapshot", headers=headers)
    assert res.status_code == 403
    assert "Forbidden" in str(res.json())


def test_12_snapshot_consistency_and_schema_validation(world_setup, db_session: Session):
    """12. Snapshot consistency and strict schema validation."""
    client = TestClient(app)
    # Generate an event in org alpha to ensure monotonic watermark is verified
    event = event_service.create_event(
        db=db_session,
        event_type="system.heartbeat",
        organization_id=world_setup["org_alpha"],
        payload={"health": "optimal"},
    )
    expected_seq = event.sequence_id

    headers = {
        "Authorization": f"Bearer {world_setup['token_alpha']}",
        "X-Organization-Id": world_setup["org_alpha"],
    }
    res = client.get("/api/v1/world/snapshot", headers=headers)
    assert res.status_code == 200

    # Strict Pydantic validation
    snapshot = WorldSnapshotResponse(**res.json())
    assert snapshot.snapshot_id.startswith("snap_")
    assert snapshot.schema_version == "3.3.1"
    assert snapshot.organization_id == world_setup["org_alpha"]
    assert snapshot.sequence_id >= expected_seq
    assert snapshot.generated_at.endswith("Z")
    assert snapshot.summary.total_employees >= 8
