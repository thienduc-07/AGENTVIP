import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.main import app
from backend.app.core.database import SessionLocal
from backend.app.core.auth import create_access_token
from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
from backend.app.models.agent import AgentModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.services.workstation_service import workstation_service, ZONE_CONFIGS

@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.rollback()
        db.close()

@pytest.fixture
def test_setup(db_session: Session):
    # Setup Tenant Org A
    org_a = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_ws_alpha").first()
    if not org_a:
        org_a = OrganizationModel(id="org_ws_alpha", name="Alpha Corp", slug="alpha-corp", is_active=True)
        db_session.add(org_a)

    # Setup Tenant Org B
    org_b = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_ws_beta").first()
    if not org_b:
        org_b = OrganizationModel(id="org_ws_beta", name="Beta Inc", slug="beta-inc", is_active=True)
        db_session.add(org_b)

    # Setup User A
    user_a = db_session.query(UserModel).filter(UserModel.id == "usr_ws_alpha").first()
    if not user_a:
        user_a = UserModel(
            id="usr_ws_alpha",
            email="alpha_lead@agency.ai",
            full_name="Alpha Lead",
            hashed_password="hashed_placeholder",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_a)

    # Setup Membership A
    m_a = (
        db_session.query(OrganizationMemberModel)
        .filter(OrganizationMemberModel.user_id == "usr_ws_alpha", OrganizationMemberModel.organization_id == "org_ws_alpha")
        .first()
    )
    if not m_a:
        m_a = OrganizationMemberModel(
            id="mem_ws_alpha",
            user_id="usr_ws_alpha",
            organization_id="org_ws_alpha",
            role="ORGANIZATION_ADMIN",
        )
        db_session.add(m_a)

    # Setup Agent Physical in Org A
    agent_phys = db_session.query(AgentModel).filter(AgentModel.id == "agt_ws_phys_1").first()
    if not agent_phys:
        agent_phys = AgentModel(
            id="agt_ws_phys_1",
            organization_id="org_ws_alpha",
            name="Alice Eng",
            role="Senior Systems Architect",
            station="Engineering",
            status="working",
            color="#3b82f6",
        )
        db_session.add(agent_phys)

    # Setup Agent Virtual in Org A
    agent_virt = db_session.query(AgentModel).filter(AgentModel.id == "agt_ws_virt_1").first()
    if not agent_virt:
        agent_virt = AgentModel(
            id="agt_ws_virt_1",
            organization_id="org_ws_alpha",
            name="Bob Cloud",
            role="Distributed Specialist",
            station="Engineering",
            status="idle",
            color="#10b981",
        )
        db_session.add(agent_virt)

    # Setup Agent in Org B (for tenant isolation test)
    agent_b = db_session.query(AgentModel).filter(AgentModel.id == "agt_ws_beta_1").first()
    if not agent_b:
        agent_b = AgentModel(
            id="agt_ws_beta_1",
            organization_id="org_ws_beta",
            name="Charlie Beta",
            role="Beta Specialist",
            station="Marketing",
            status="idle",
            color="#f59e0b",
        )
        db_session.add(agent_b)

    db_session.commit()

    token_a = create_access_token(
        user_id="usr_ws_alpha",
        email="alpha_lead@agency.ai",
        is_superadmin=False,
        token_version=1,
    )

    return {
        "org_a": "org_ws_alpha",
        "org_b": "org_ws_beta",
        "token_a": token_a,
    }

def test_zone_configs_ground_truth():
    """Verify backend ground truth: 8 zones, 60 physical desk slots."""
    assert len(ZONE_CONFIGS) == 8
    expected_capacities = {
        "Engineering": 12,
        "AI Research": 10,
        "Marketing": 8,
        "Sales": 8,
        "Operations": 6,
        "Finance": 6,
        "Customer Success": 6,
        "Executive": 4,
    }
    total_desks = 0
    for dept, cap in expected_capacities.items():
        assert dept in ZONE_CONFIGS
        assert ZONE_CONFIGS[dept]["max_physical_desks"] == cap
        total_desks += cap

    assert total_desks == 60

def test_workstation_overview_api(test_setup, db_session: Session):
    """Test GET /api/v1/workstations/overview endpoint with tenant isolation."""
    client = TestClient(app)
    token = test_setup["token_a"]

    # 1. Allocate 1 physical desk and 1 virtual workforce slot in Org A
    alloc_phys = workstation_service.allocate_workstation(
        db=db_session,
        agent_id="agt_ws_phys_1",
        department="Engineering",
        organization_id=test_setup["org_a"],
        force_virtual=False,
    )
    alloc_virt = workstation_service.allocate_workstation(
        db=db_session,
        agent_id="agt_ws_virt_1",
        department="Engineering",
        organization_id=test_setup["org_a"],
        force_virtual=True,
    )
    # Allocate in Org B to verify tenant segregation
    alloc_b = workstation_service.allocate_workstation(
        db=db_session,
        agent_id="agt_ws_beta_1",
        department="Marketing",
        organization_id=test_setup["org_b"],
        force_virtual=False,
    )
    db_session.commit()

    # Query overview as Org A
    response = client.get(
        "/api/v1/workstations/overview",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()

    # Verify telemetry adheres to strict physical invariants
    telemetry = data["telemetry"]
    assert telemetry["total_desk_capacity"] == 60
    assert telemetry["total_allocated"] == 1  # 1 physical desk allocated in Org A
    assert telemetry["total_physical_occupied"] == 1  # Alice Eng is working
    assert telemetry["total_reserved_unoccupied"] == 0
    assert telemetry["total_physical_available"] == 59  # 60 - 1 assigned desk = 59
    assert telemetry["total_virtual_workforce"] == 1  # Bob Cloud is virtual
    # Invariant: Capacity = Allocated + Available
    assert telemetry["total_allocated"] + telemetry["total_physical_available"] == telemetry["total_desk_capacity"]
    # Invariant: Allocated = Occupied + ReservedUnoccupied
    assert telemetry["total_physical_occupied"] + telemetry["total_reserved_unoccupied"] == telemetry["total_allocated"]

    # Verify zones array
    zones = {z["department"]: z for z in data["zones"]}
    assert len(zones) == 8
    eng_zone = zones["Engineering"]
    assert eng_zone["max_physical_desks"] == 12
    assert eng_zone["allocated_count"] == 1  # 1 physical desk
    assert eng_zone["physical_occupied_count"] == 1
    assert eng_zone["reserved_unoccupied_count"] == 0
    assert eng_zone["available_physical_count"] == 11
    assert eng_zone["virtual_count"] == 1
    # Zone Invariant: max_physical_desks = allocated_count + available_physical_count
    assert eng_zone["allocated_count"] + eng_zone["available_physical_count"] == eng_zone["max_physical_desks"]
    # Zone Invariant: allocated_count = physical_occupied_count + reserved_unoccupied_count
    assert eng_zone["physical_occupied_count"] + eng_zone["reserved_unoccupied_count"] == eng_zone["allocated_count"]


    # Verify allocations array: only Org A's allocations should be returned
    allocations = data["allocations"]
    assert len(allocations) == 2
    agent_ids = {a["agent_id"] for a in allocations}
    assert "agt_ws_phys_1" in agent_ids
    assert "agt_ws_virt_1" in agent_ids
    assert "agt_ws_beta_1" not in agent_ids  # Tenant isolation verified!

def test_workstation_unauthorized():
    """Verify endpoint rejects requests without valid bearer token."""
    client = TestClient(app)
    response = client.get("/api/v1/workstations/overview")
    assert response.status_code == 401
