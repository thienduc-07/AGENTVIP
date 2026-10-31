import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core.database import Base, get_db
from backend.app.main import app
from backend.app.models.agent import AgentModel
from backend.app.models.specialist import SpecialistDefinitionModel
from backend.app.models.recruitment import RecruitmentRecordModel, AgentPerformanceModel
from backend.app.services.recruitment_service import recruitment_service
from backend.app.agent_runtime.registry.agent_registry import default_agent_registry

TEST_DATABASE_URL = "sqlite:///:memory:"

@pytest.fixture(name="db_session")
def db_session_fixture():
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    # Seed CEO and Department Heads
    executives = [
        AgentModel(id="agent-exec-ceo", name="Victoria Vance", role="CEO", station="executive_suite"),
        AgentModel(id="agent-eng-lead", name="David Chen", role="Engineering Lead", station="engineering_bay"),
        AgentModel(id="agent-research-ai", name="Dr. Elena Rostova", role="Research Lead", station="research_lab"),
        AgentModel(id="agent-mkt-growth", name="Sophia Martinez", role="Marketing Lead", station="marketing_studio"),
        AgentModel(id="agent-sales-director", name="Marcus Reynolds", role="Sales Lead", station="sales_wing"),
        AgentModel(id="agent-fin-controller", name="Julian Thorne", role="Finance Lead", station="finance_office"),
        AgentModel(id="agent-ops-recruiter", name="Amara Okafor", role="Operations Lead", station="operations_hub"),
        AgentModel(id="agent-support-lead", name="Liam O'Connor", role="Support Lead", station="support_lounge"),
    ]
    for ex in executives:
        db.add(ex)

    # Seed sample specialist definition
    spec = SpecialistDefinitionModel(
        id="spec-eng-arch",
        slug="engineering-backend-architect",
        name="Backend Architect",
        division="engineering",
        department="Engineering",
        role="Principal Backend Systems Architect",
        description="Scalable cloud architectures and databases",
        color="#3b82f6",
        emoji="🏗️",
        system_instructions="Build high performance APIs.",
        core_mission="Architect high-performance distributed systems.",
        critical_rules="Adhere to strict security boundaries.",
        capabilities=["Distributed Systems", "SQL Optimization"],
        assigned_tools=["workspace_list", "file_read", "workspace.write_file"],
        permission_level=1,
        source_repo="https://github.com/msitarzewski/agency-agents",
        source_path="engineering/engineering-backend-architect.md",
        content_hash="hash123",
        raw_content="Content",
        validation_status="VALID",
        lifecycle_state="AVAILABLE",
    )
    db.add(spec)
    db.commit()

    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)

@pytest.fixture(name="client")
def client_fixture(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()

def test_recruit_specialist_lifecycle(db_session):
    res = recruitment_service.recruit_specialist(
        db=db_session,
        specialist_id="spec-eng-arch",
        recruited_by="agent-eng-lead",
        manager_agent_id="agent-eng-lead",
        department="Engineering",
        budget_limit_usd=100.0,
    )

    assert res["success"] is True
    agent_id = res["agent_id"]
    assert "agent-spec-engineering-backend-architect" in agent_id
    assert res["department"] == "Engineering"
    assert res["station"] == "engineering_bay"

    # Verify agent in DB
    agent = db_session.query(AgentModel).filter_by(id=agent_id).first()
    assert agent is not None
    assert agent.role == "Principal Backend Systems Architect"
    assert agent.station == "engineering_bay"

    # Verify recruitment record
    rec = db_session.query(RecruitmentRecordModel).filter_by(agent_id=agent_id).first()
    assert rec is not None
    assert rec.lifecycle_state == "ACTIVE"
    assert rec.budget_limit_usd == 100.0
    assert rec.manager_agent_id == "agent-eng-lead"

    # Verify performance initialized
    perf = db_session.query(AgentPerformanceModel).filter_by(agent_id=agent_id).first()
    assert perf is not None
    assert perf.tasks_completed == 0

    # Verify registered in runtime AgentRegistry
    agent_def = default_agent_registry.get(agent_id)
    assert agent_def is not None
    assert agent_def.enabled is True
    assert agent_def.default_assigned_agent_id == agent_id
    assert "workspace.write_file" in agent_def.allowed_tools

def test_cannot_recruit_invalid_specialist(db_session):
    spec_inv = SpecialistDefinitionModel(
        id="spec-broken",
        slug="broken-specialist",
        name="Broken",
        division="engineering",
        department="Engineering",
        role="Broken Agent",
        system_instructions="Bad",
        source_path="engineering/broken.md",
        content_hash="badhash",
        raw_content="Bad",
        validation_status="INVALID",
        validation_errors=["Harmful instructions detected"],
    )
    db_session.add(spec_inv)
    db_session.commit()

    with pytest.raises(ValueError) as exc:
        recruitment_service.recruit_specialist(db=db_session, specialist_id="spec-broken")
    assert "Cannot recruit invalid specialist" in str(exc.value)

def test_lifecycle_transitions(db_session):
    res = recruitment_service.recruit_specialist(db=db_session, specialist_id="spec-eng-arch")
    agent_id = res["agent_id"]

    # 1. Suspend
    res_suspend = recruitment_service.transition_lifecycle(
        db=db_session,
        agent_id=agent_id,
        target_state="SUSPENDED",
        reason="Budget audit pending",
    )
    assert res_suspend["current_state"] == "SUSPENDED"

    agent_def = default_agent_registry.get(agent_id)
    assert agent_def is not None
    assert agent_def.enabled is False

    # 2. Re-activate
    res_active = recruitment_service.transition_lifecycle(
        db=db_session,
        agent_id=agent_id,
        target_state="ACTIVE",
    )
    assert res_active["current_state"] == "ACTIVE"
    agent_def = default_agent_registry.get(agent_id)
    assert agent_def is not None
    assert agent_def.enabled is True

    # 3. Retire
    res_retire = recruitment_service.transition_lifecycle(
        db=db_session,
        agent_id=agent_id,
        target_state="RETIRED",
    )
    assert res_retire["current_state"] == "RETIRED"
    agent_def = default_agent_registry.get(agent_id)
    assert agent_def is not None
    assert agent_def.enabled is False

    # 4. Disallowed transition from RETIRED
    with pytest.raises(ValueError):
        recruitment_service.transition_lifecycle(
            db=db_session,
            agent_id=agent_id,
            target_state="ACTIVE",
        )

def test_corporate_hierarchy(db_session):
    recruitment_service.recruit_specialist(
        db=db_session,
        specialist_id="spec-eng-arch",
        department="Engineering",
    )

    hierarchy = recruitment_service.get_corporate_hierarchy(db_session)
    assert hierarchy["ceo"]["name"] == "Victoria Vance"
    assert "Engineering" in hierarchy["departments"]
    eng_dept = hierarchy["departments"]["Engineering"]
    assert eng_dept["manager"]["name"] == "David Chen"
    assert eng_dept["headcount"] == 1
    assert eng_dept["specialists"][0]["role"] == "Principal Backend Systems Architect"

def test_compare_candidates(db_session):
    # Add second specialist
    spec2 = SpecialistDefinitionModel(
        id="spec-ai-eng",
        slug="engineering-ai-engineer",
        name="AI Engineer",
        division="engineering",
        department="Engineering",
        role="LLM and Agent Systems Engineer",
        system_instructions="AI Instructions",
        source_path="engineering/ai-engineer.md",
        content_hash="hash456",
        raw_content="AI Content",
        capabilities=["Model Fine-Tuning", "Prompt Engineering"],
        validation_status="VALID",
    )
    db_session.add(spec2)
    db_session.commit()

    comparison = recruitment_service.compare_specialists(db_session, ["spec-eng-arch", "spec-ai-eng"])
    assert len(comparison) == 2
    names = [c["name"] for c in comparison]
    assert "Backend Architect" in names
    assert "AI Engineer" in names

def test_recruitment_api_endpoints(client, db_session):
    from backend.app.models.auth import OrganizationModel, UserModel, OrganizationMemberModel
    from backend.app.core.auth import create_access_token, hash_password, ROLE_ORGANIZATION_OWNER

    default_org = OrganizationModel(
        id="org_default_company",
        name="Default Company",
        slug="default-company",
        tier="ENTERPRISE",
        is_active=True,
    )
    owner_user = UserModel(
        id="usr-org-owner-victoria",
        email="owner@default.corp",
        hashed_password=hash_password("OwnerPassword123!"),
        full_name="Victoria Vance",
        is_active=True,
        is_superadmin=False,
        token_version=1,
    )
    member = OrganizationMemberModel(
        organization_id="org_default_company",
        user_id="usr-org-owner-victoria",
        role=ROLE_ORGANIZATION_OWNER,
    )
    db_session.add_all([default_org, owner_user, member])
    db_session.flush()

    token = create_access_token(
        user_id="usr-org-owner-victoria",
        email="owner@default.corp",
        is_superadmin=False,
        org_roles={"org_default_company": ROLE_ORGANIZATION_OWNER},
    )
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Test POST /api/v1/recruitment/recruit
    res = client.post(
        "/api/v1/recruitment/recruit",
        json={
            "specialist_id": "spec-eng-arch",
            "department": "Engineering",
            "manager_agent_id": "agent-eng-lead",
            "budget_limit_usd": 75.0,
            "custom_name": "Senior Cloud Architect",
        },
        headers=headers,
    )
    assert res.status_code == 201
    data = res.json()
    assert data["success"] is True
    agent_id = data["agent_id"]
    assert data["name"] == "Senior Cloud Architect"

    # 2. Test GET /api/v1/recruitment/recruited
    res_list = client.get("/api/v1/recruitment/recruited", headers=headers)
    assert res_list.status_code == 200
    recruited_items = res_list.json()
    assert len(recruited_items) == 1
    assert recruited_items[0]["agent_id"] == agent_id
    assert recruited_items[0]["department"] == "Engineering"

    # 3. Test POST /api/v1/recruitment/{agent_id}/suspend
    res_sus = client.post(f"/api/v1/recruitment/{agent_id}/suspend", json={"reason": "Testing"}, headers=headers)
    assert res_sus.status_code == 200
    assert res_sus.json()["current_state"] == "SUSPENDED"

    # 4. Test POST /api/v1/recruitment/{agent_id}/activate
    res_act = client.post(f"/api/v1/recruitment/{agent_id}/activate", headers=headers)
    assert res_act.status_code == 200
    assert res_act.json()["current_state"] == "ACTIVE"

    # 5. Test GET /api/v1/recruitment/hierarchy
    res_hier = client.get("/api/v1/recruitment/hierarchy", headers=headers)
    assert res_hier.status_code == 200
    assert res_hier.json()["total_recruited"] == 1

    # 6. Test GET /api/v1/recruitment/performance/{agent_id}
    res_perf = client.get(f"/api/v1/recruitment/performance/{agent_id}", headers=headers)
    assert res_perf.status_code == 200
    assert res_perf.json()["tasks_completed"] == 0
