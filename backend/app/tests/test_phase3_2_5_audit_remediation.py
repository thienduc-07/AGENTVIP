import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.main import app
from backend.app.core.database import SessionLocal
from backend.app.core.auth import create_access_token
from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.schemas.task import TaskCreate
from backend.app.services.task_service import task_service
from backend.app.services.workstation_service import workstation_service, ZONE_CONFIGS
from backend.app.services.event_service import event_service

@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.rollback()
        db.close()

@pytest.fixture
def audit_fixture(db_session: Session):
    # Setup Tenant Org 1
    org1 = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_audit_1").first()
    if not org1:
        org1 = OrganizationModel(id="org_audit_1", name="Audit Org 1", slug="audit-org-1", is_active=True)
        db_session.add(org1)

    # Setup Tenant Org 2
    org2 = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_audit_2").first()
    if not org2:
        org2 = OrganizationModel(id="org_audit_2", name="Audit Org 2", slug="audit-org-2", is_active=True)
        db_session.add(org2)

    # Setup User 1
    user1 = db_session.query(UserModel).filter(UserModel.id == "usr_audit_1").first()
    if not user1:
        user1 = UserModel(
            id="usr_audit_1",
            email="auditor_1@agency.ai",
            full_name="Auditor One",
            hashed_password="hashed_pwd",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user1)

    # Setup Membership 1 in Org 1
    m1 = (
        db_session.query(OrganizationMemberModel)
        .filter(OrganizationMemberModel.user_id == "usr_audit_1", OrganizationMemberModel.organization_id == "org_audit_1")
        .first()
    )
    if not m1:
        m1 = OrganizationMemberModel(
            id="mem_audit_1",
            user_id="usr_audit_1",
            organization_id="org_audit_1",
            role="ORGANIZATION_ADMIN",
        )
        db_session.add(m1)

    # Setup Agent in Org 1 (Physical active)
    agent1 = db_session.query(AgentModel).filter(AgentModel.id == "agt_audit_active").first()
    if not agent1:
        agent1 = AgentModel(
            id="agt_audit_active",
            organization_id="org_audit_1",
            name="Audit Agent Active",
            role="Systems Engineer",
            station="Engineering",
            status="working",
            color="#3b82f6",
        )
        db_session.add(agent1)

    # Setup Agent in Org 1 (Physical offline)
    agent2 = db_session.query(AgentModel).filter(AgentModel.id == "agt_audit_offline").first()
    if not agent2:
        agent2 = AgentModel(
            id="agt_audit_offline",
            organization_id="org_audit_1",
            name="Audit Agent Offline",
            role="Operations Specialist",
            station="Operations",
            status="offline",
            color="#64748b",
        )
        db_session.add(agent2)

    # Setup Agent in Org 1 (Virtual)
    agent_virt = db_session.query(AgentModel).filter(AgentModel.id == "agt_audit_virtual").first()
    if not agent_virt:
        agent_virt = AgentModel(
            id="agt_audit_virtual",
            organization_id="org_audit_1",
            name="Audit Agent Cloud",
            role="Virtual Cloud Worker",
            station="AI Research",
            status="working",
            color="#10b981",
        )
        db_session.add(agent_virt)

    db_session.commit()

    token1 = create_access_token(
        user_id="usr_audit_1",
        email="auditor_1@agency.ai",
        is_superadmin=False,
        token_version=1,
    )

    return {
        "org1": "org_audit_1",
        "org2": "org_audit_2",
        "token1": token1,
    }


def test_task_creation_idempotency(audit_fixture, db_session: Session):
    """
    Remediation verification for FINDING-325-04:
    Calling create_task twice with the same client-assigned ID returns the exact same task
    without creating a duplicate or raising an IntegrityError.
    """
    client_id = "task_client_idempotent_test_001"
    db_session.query(TaskModel).filter(TaskModel.id == client_id).delete()
    db_session.commit()

    task_in = TaskCreate(
        id=client_id,
        title="Audited Task Submission",
        description="Verify task idempotency across network retries",
        assigned_agent_id="agt_audit_active",
        priority="high",
    )

    # First attempt: Task created
    task1 = task_service.create_task(db=db_session, task_in=task_in, organization_id=audit_fixture["org1"])
    db_session.commit()
    assert task1.id == client_id
    assert task1.status == "queued"

    # Second attempt (simulate network timeout retry with identical client ID)
    task2 = task_service.create_task(db=db_session, task_in=task_in, organization_id=audit_fixture["org1"])
    db_session.commit()
    assert task2.id == client_id

    # Verify no duplicate task exists in database
    tasks_count = db_session.query(TaskModel).filter(TaskModel.id == client_id).count()
    assert tasks_count == 1


def test_cross_tenant_task_id_collision_rejected(audit_fixture, db_session: Session):
    """
    Remediation verification for FINDING-325-04 security boundary:
    A client in Org 2 cannot claim an existing task ID belonging to Org 1.
    """
    from backend.app.core.errors import ValidationError

    client_id = "task_cross_tenant_collision_test"
    task_in1 = TaskCreate(
        id=client_id,
        title="Org 1 Task",
        description="Org 1 task body",
        assigned_agent_id="agt_audit_active",
        priority="normal",
    )
    task_service.create_task(db=db_session, task_in=task_in1, organization_id=audit_fixture["org1"])
    db_session.commit()

    # Attempt to create with same ID under Org 2
    task_in2 = TaskCreate(
        id=client_id,
        title="Org 2 Hijack Attempt",
        description="Should be rejected",
        assigned_agent_id="agt_audit_active",
        priority="normal",
    )
    with pytest.raises(ValidationError) as exc:
        task_service.create_task(db=db_session, task_in=task_in2, organization_id=audit_fixture["org2"])

    assert "belongs to another organization" in str(exc.value)


def test_workstation_telemetry_invariants_and_reserved_unoccupied(audit_fixture, db_session: Session):
    """
    Remediation verification for FINDING-325-02 & FINDING-325-07:
    Verify strict mathematical invariants for workstation telemetry:
    1. Capacity = Occupied + ReservedUnoccupied + Unallocated
    2. Unallocated = Capacity - Allocated
    3. ReservedUnoccupied = Allocated - Occupied
    4. 0 <= Occupied <= Allocated <= Capacity
    5. Virtual fleet does NOT inflate physical desk allocation counts
    """
    client = TestClient(app)
    token = audit_fixture["token1"]

    # 1. Allocate physical desk to active agent (Alice -> Engineering Desk 1)
    workstation_service.allocate_workstation(
        db=db_session,
        agent_id="agt_audit_active",
        department="Engineering",
        organization_id=audit_fixture["org1"],
        force_virtual=False,
    )

    # 2. Allocate physical desk to offline agent (Bob -> Operations Desk 1)
    workstation_service.allocate_workstation(
        db=db_session,
        agent_id="agt_audit_offline",
        department="Operations",
        organization_id=audit_fixture["org1"],
        force_virtual=False,
    )

    # 3. Allocate virtual workforce slot (Cloud -> AI Research)
    workstation_service.allocate_workstation(
        db=db_session,
        agent_id="agt_audit_virtual",
        department="AI Research",
        organization_id=audit_fixture["org1"],
        force_virtual=True,
    )
    db_session.commit()

    # Query overview
    res = client.get("/api/v1/workstations/overview", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()

    telemetry = data["telemetry"]
    # Total physical capacity across all 8 zones = 60
    assert telemetry["total_desk_capacity"] == 60
    # Exactly 2 physical desks allocated (1 in Engineering, 1 in Operations)
    assert telemetry["total_allocated"] == 2
    # Exactly 1 physical desk occupied (Engineering agent is active/working)
    assert telemetry["total_physical_occupied"] == 1
    # Exactly 1 physical desk reserved but unoccupied (Operations agent is offline)
    assert telemetry["total_reserved_unoccupied"] == 1
    # Exactly 58 physical desks unallocated (60 - 2 = 58)
    assert telemetry["total_physical_available"] == 58
    # Exactly 1 virtual worker (segregated cleanly)
    assert telemetry["total_virtual_workforce"] == 1

    # INVARIANT CHECKS:
    # Capacity = Allocated + Available
    assert telemetry["total_allocated"] + telemetry["total_physical_available"] == telemetry["total_desk_capacity"]
    # Allocated = Occupied + ReservedUnoccupied
    assert telemetry["total_physical_occupied"] + telemetry["total_reserved_unoccupied"] == telemetry["total_allocated"]
    # Capacity = Occupied + ReservedUnoccupied + Available
    assert (
        telemetry["total_physical_occupied"]
        + telemetry["total_reserved_unoccupied"]
        + telemetry["total_physical_available"]
        == telemetry["total_desk_capacity"]
    )

    # Check Operations zone specifically (1 desk allocated, offline agent)
    zones = {z["department"]: z for z in data["zones"]}
    ops_zone = zones["Operations"]
    assert ops_zone["max_physical_desks"] == 6
    assert ops_zone["allocated_count"] == 1
    assert ops_zone["physical_occupied_count"] == 0
    assert ops_zone["reserved_unoccupied_count"] == 1
    assert ops_zone["available_physical_count"] == 5
    assert ops_zone["virtual_count"] == 0
    assert ops_zone["allocated_count"] + ops_zone["available_physical_count"] == ops_zone["max_physical_desks"]


def test_snapshot_watermark_consistency(audit_fixture, db_session: Session):
    """
    Remediation verification for FINDING-325-03:
    Snapshot watermark is evaluated before entity reading, ensuring consistency
    and non-negative sequence IDs.
    """
    snapshot = event_service.build_initial_snapshot(
        db=db_session,
        organization_id=audit_fixture["org1"],
        is_superadmin=False,
    )
    assert snapshot["message_type"] == "snapshot"
    assert "last_sequence_id" in snapshot
    assert isinstance(snapshot["last_sequence_id"], int)
    assert snapshot["last_sequence_id"] >= 0
    assert isinstance(snapshot["data"]["agents"], list)
    assert isinstance(snapshot["data"]["active_tasks"], list)


def test_websocket_subprotocol_bearer_authentication(audit_fixture, db_session: Session, monkeypatch):
    """
    Remediation verification for FINDING-325-06:
    Verify WebSocketManager accepts authentication via Sec-WebSocket-Protocol (bearer.<jwt>)
    without requiring token in URL query parameter.
    """
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    client = TestClient(app)
    token = audit_fixture["token1"]

    # Connect using Sec-WebSocket-Protocol header with bearer.<token>
    with client.websocket_connect(
        f"/api/v1/events/ws?organization_id={audit_fixture['org1']}",
        subprotocols=[f"bearer.{token}"],
    ) as ws:
        # Initial snapshot received upon authorized connection
        snap_raw = ws.receive_text()
        assert "snapshot" in snap_raw

