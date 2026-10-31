import pytest
from datetime import datetime
from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.services.specialist_integrity_service import specialist_integrity_checker
from backend.app.services.agency_agent_synchronizer import agency_agent_synchronizer
from backend.app.services.workstation_service import workstation_service
from backend.app.services.recruitment_service import recruitment_service

import hashlib

@pytest.fixture
def seed_catalog_specialists(db_session):
    """Seed test specialist definitions into in-memory test database."""
    raw1 = "--- \nname: Test Lead Architect\n---\n## Mission\nArchitecture design"
    hash1 = hashlib.sha256(raw1.encode("utf-8")).hexdigest()
    s1 = SpecialistDefinitionModel(
        id="spec-test-arch",
        slug="test-architect",
        name="Test Lead Architect",
        division="engineering",
        department="Engineering",
        role="Principal Cloud Architect",
        description="Designs scalable microservices and cloud infrastructures",
        system_instructions="You are a principal cloud architect. Always produce robust architecture specifications.",
        content_hash=hash1,
        raw_content=raw1,
        source_path="engineering/test-architect.md",
        validation_status="VALID",
        lifecycle_state="AVAILABLE",
        version=1,
    )
    v1 = SpecialistVersionModel(
        specialist_id="spec-test-arch",
        version=1,
        content_hash=hash1,
        raw_content=s1.raw_content,
        change_summary="Initial import",
    )
    raw2 = "--- \nname: Test Growth Lead\n---\n## Mission\nGrowth experiments"
    hash2 = hashlib.sha256(raw2.encode("utf-8")).hexdigest()
    s2 = SpecialistDefinitionModel(
        id="spec-test-growth",
        slug="test-growth",
        name="Test Growth Lead",
        division="marketing",
        department="Marketing",
        role="Head of Growth Marketing",
        description="Drives customer acquisition and growth experiments",
        system_instructions="You are a growth marketing director. Maximize viral coefficients and acquisition.",
        content_hash=hash2,
        raw_content=raw2,
        source_path="marketing/test-growth.md",
        validation_status="VALID",
        lifecycle_state="AVAILABLE",
        version=1,
    )
    v2 = SpecialistVersionModel(
        specialist_id="spec-test-growth",
        version=1,
        content_hash=hash2,
        raw_content=s2.raw_content,
        change_summary="Initial import",
    )
    db_session.add_all([s1, v1, s2, v2])
    db_session.commit()
    return s1, s2

def test_catalog_integrity_check(db_session, seed_catalog_specialists):
    """Verifies that the catalog integrity checker audits valid specialists correctly."""
    report = specialist_integrity_checker.audit_catalog(db_session)
    assert report["total_specialists"] >= 2
    assert report["invalid_count"] == 0
    assert report["health_score"] > 90.0

def test_catalog_integrity_detects_malformed_specialist(db_session):
    """Verifies that missing metadata or invalid divisions are caught non-destructively."""
    bad_spec = SpecialistDefinitionModel(
        id="spec-bad-001",
        slug="bad-specialist",
        name="",  # Empty name
        division="non_existent_division",
        department="",
        role="",
        system_instructions="short",  # < 20 chars
        content_hash="",
        raw_content="bad",
        source_path="",
        version=1,
    )
    db_session.add(bad_spec)
    db_session.commit()

    report = specialist_integrity_checker.audit_catalog(db_session)
    assert report["invalid_count"] >= 1
    bad_issues = [i for i in report["issues"] if i["specialist_id"] == "spec-bad-001"]
    assert len(bad_issues) == 1
    assert "Missing or empty specialist display name" in bad_issues[0]["errors"]
    assert "Unknown or non-standard division: 'non_existent_division'" in bad_issues[0]["errors"]

def test_multi_organization_independent_recruitment(db_session, seed_catalog_specialists):
    """
    CRITICAL MULTI-TENANCY REQUIREMENT:
    Multiple distinct organizations can recruit the exact same global specialist template independently.
    """
    s1, _ = seed_catalog_specialists

    # Org A recruits specialist s1
    res_a = recruitment_service.recruit_specialist(
        db=db_session,
        specialist_id=s1.id,
        organization_id="org_alpha_inc",
        department="Engineering",
    )
    assert res_a["organization_id"] == "org_alpha_inc"
    assert res_a["department"] == "Engineering"
    agent_id_a = res_a["agent_id"]

    # Org B recruits the SAME specialist s1 independently
    res_b = recruitment_service.recruit_specialist(
        db=db_session,
        specialist_id=s1.id,
        organization_id="org_beta_corp",
        department="Engineering",
    )
    assert res_b["organization_id"] == "org_beta_corp"
    agent_id_b = res_b["agent_id"]

    # Must be distinct employee instances
    assert agent_id_a != agent_id_b

    # Verify both records exist in DB with proper tenant scoping
    records = db_session.query(RecruitmentRecordModel).filter(
        RecruitmentRecordModel.specialist_definition_id == s1.id
    ).all()
    assert len(records) == 2
    org_ids = {r.organization_id for r in records}
    assert org_ids == {"org_alpha_inc", "org_beta_corp"}

def test_duplicate_recruitment_prevention_within_same_org(db_session, seed_catalog_specialists):
    """Verifies that an organization cannot recruit the same active specialist twice."""
    s1, _ = seed_catalog_specialists

    # First recruitment in Org Alpha
    recruitment_service.recruit_specialist(
        db=db_session,
        specialist_id=s1.id,
        organization_id="org_alpha_inc",
    )

    # Attempt second recruitment of same specialist in same Org Alpha must fail
    with pytest.raises(ValueError) as exc:
        recruitment_service.recruit_specialist(
            db=db_session,
            specialist_id=s1.id,
            organization_id="org_alpha_inc",
        )
    assert "already recruited in organization 'org_alpha_inc'" in str(exc.value)

def test_workstation_allocation_and_reassignment(db_session, seed_catalog_specialists):
    """Verifies logical workstation allocation, 3D coordinate generation, and reassignment."""
    s1, _ = seed_catalog_specialists

    res = recruitment_service.recruit_specialist(
        db=db_session,
        specialist_id=s1.id,
        organization_id="org_test_company",
        department="Engineering",
    )
    agent_id = res["agent_id"]
    assert res["logical_workstation_id"].startswith("ws-engineering-")
    assert res["desk_number"] == 1
    assert res["is_virtual"] is False

    # Check workstation in DB
    ws = workstation_service.get_workstation_for_agent(db_session, agent_id, organization_id="org_test_company")
    assert ws is not None
    assert ws.allocation_status == "ASSIGNED"
    assert ws.office_zone == "engineering_bay"

    # Reassign agent to Marketing Studio
    reassigned = workstation_service.reassign_workstation(
        db=db_session,
        agent_id=agent_id,
        target_department="Marketing",
        organization_id="org_test_company",
    )
    assert reassigned.department == "Marketing"
    assert reassigned.office_zone == "marketing_studio"
    assert reassigned.logical_workstation_id.startswith("ws-marketing-")

def test_dynamic_workstation_overflow_virtualization(db_session, seed_catalog_specialists):
    """
    CRITICAL WORKFORCE SCALABILITY REQUIREMENT:
    Recruiting more employees than visible physical desk capacity must gracefully
    allocate virtual workstations without crashing or enforcing hard caps.
    """
    s1, _ = seed_catalog_specialists
    dept = "Operations"  # Max physical desks in Operations is 6

    from backend.app.models.agent import AgentModel

    # Recruit 8 agents in Operations (> 6 physical capacity)
    allocations = []
    for i in range(8):
        agent_id = f"test-agent-overflow-{i}"
        dummy_agent = AgentModel(
            id=agent_id,
            name=f"Overflow Operator {i}",
            role="Operations Specialist",
            status="IDLE",
            station=dept,
            organization_id="org_overflow_test",
        )
        db_session.add(dummy_agent)
        db_session.commit()

        alloc = workstation_service.allocate_workstation(
            db=db_session,
            agent_id=agent_id,
            department=dept,
            organization_id="org_overflow_test",
        )
        allocations.append(alloc)

    # First 6 must be physical desks
    for i in range(6):
        assert allocations[i].is_virtual is False
        assert allocations[i].allocation_status == "ASSIGNED"
        assert allocations[i].desk_number == i + 1

    # Desks 7 and 8 must be virtualized overflow
    assert allocations[6].is_virtual is True
    assert allocations[6].allocation_status == "VIRTUAL"
    assert allocations[6].logical_workstation_id.startswith("vws-operations-")

    assert allocations[7].is_virtual is True
    assert allocations[7].allocation_status == "VIRTUAL"

def test_retirement_releases_workstation(db_session, seed_catalog_specialists):
    """Verifies that retiring an employee releases the physical workstation reservation."""
    s1, _ = seed_catalog_specialists

    res = recruitment_service.recruit_specialist(
        db=db_session,
        specialist_id=s1.id,
        organization_id="org_retire_test",
        department="Engineering",
    )
    agent_id = res["agent_id"]

    ws_before = workstation_service.get_workstation_for_agent(db_session, agent_id, organization_id="org_retire_test")
    assert ws_before.allocation_status == "ASSIGNED"
    assert ws_before.desk_number == 1

    # Transition agent to RETIRED
    recruitment_service.transition_lifecycle(
        db=db_session,
        agent_id=agent_id,
        target_state="RETIRED",
        reason="Completed annual contract",
    )

    ws_after = workstation_service.get_workstation_for_agent(db_session, agent_id, organization_id="org_retire_test")
    assert ws_after.allocation_status == "UNASSIGNED"
    assert ws_after.desk_number is None

def test_api_catalog_integrity_endpoint(client, seed_catalog_specialists):
    """Tests GET /api/v1/specialists/catalog/integrity REST API."""
    res = client.get("/api/v1/specialists/catalog/integrity")
    assert res.status_code == 200
    data = res.json()
    assert "health_score" in data
    assert "total_specialists" in data
    assert "issues" in data

def test_api_workforce_contract_endpoint(client, db_session, seed_catalog_specialists):
    """Tests GET /api/v1/recruitment/workforce contract for 3D office telemetry."""
    from backend.app.models.auth import OrganizationModel, UserModel, OrganizationMemberModel
    from backend.app.core.auth import create_access_token, hash_password, ROLE_ORGANIZATION_OWNER

    org = OrganizationModel(
        id="org_api_test",
        name="API Test Org",
        slug="api-test-org",
        tier="enterprise",
        is_active=True,
    )
    user = UserModel(
        id="usr-test-owner",
        email="owner@test.corp",
        hashed_password=hash_password("Pass123!"),
        full_name="Owner",
        is_active=True,
        token_version=1,
    )
    member = OrganizationMemberModel(
        organization_id="org_api_test",
        user_id="usr-test-owner",
        role=ROLE_ORGANIZATION_OWNER,
    )
    db_session.add_all([org, user, member])
    db_session.flush()

    token = create_access_token(
        user_id="usr-test-owner",
        email="owner@test.corp",
        is_superadmin=False,
        org_roles={"org_api_test": ROLE_ORGANIZATION_OWNER},
    )
    headers = {"Authorization": f"Bearer {token}"}

    recruit_payload = {
        "specialist_id": "spec-test-arch",
        "department": "Engineering",
        "budget_limit_usd": 100.0,
        "is_virtual": False,
    }
    r = client.post("/api/v1/recruitment/recruit?organization_id=org_api_test", json=recruit_payload, headers=headers)
    assert r.status_code == 201
    created = r.json()
    assert created["logical_workstation_id"].startswith("ws-engineering-")

    # Fetch organization workforce
    wf_res = client.get("/api/v1/recruitment/workforce?organization_id=org_api_test", headers=headers)
    assert wf_res.status_code == 200
    wf_data = wf_res.json()
    assert wf_data["organization_id"] == "org_api_test"
    assert wf_data["total_employees"] == 1
    assert len(wf_data["workforce"]) == 1
    employee = wf_data["workforce"][0]
    assert employee["agent_id"] == created["agent_id"]
    assert employee["workstation"]["logical_workstation_id"] == created["logical_workstation_id"]

def test_synchronizer_preview_and_apply(db_session, seed_catalog_specialists, tmp_path):
    """
    CRITICAL CATALOG SYNCHRONIZATION REQUIREMENT:
    Safe Agency Agents synchronization with preview, hash comparison, and non-destructive version bumping.
    """
    s1, s2 = seed_catalog_specialists

    # Create upstream test markdown files
    eng_dir = tmp_path / "engineering"
    eng_dir.mkdir(parents=True, exist_ok=True)
    mkt_dir = tmp_path / "marketing"
    mkt_dir.mkdir(parents=True, exist_ok=True)
    pm_dir = tmp_path / "product"
    pm_dir.mkdir(parents=True, exist_ok=True)

    # 1. Unchanged upstream file
    (eng_dir / "test-architect.md").write_text(s1.raw_content, encoding="utf-8")

    # 2. Updated upstream file (changed body)
    updated_raw = "--- \nname: Test Growth Lead\n---\n## Mission\nUpdated growth experiments with viral loops"
    (mkt_dir / "test-growth.md").write_text(updated_raw, encoding="utf-8")

    # 3. Brand new upstream file
    new_raw = "--- \nname: Test Product Lead\n---\n## Mission\nBuild scalable product roadmaps"
    (pm_dir / "test-pm.md").write_text(new_raw, encoding="utf-8")

    # Generate sync preview
    preview = agency_agent_synchronizer.preview_sync(
        db=db_session,
        source_dir=str(tmp_path),
    )
    assert preview["summary"]["NEW"] == 1
    assert preview["summary"]["UPDATED"] == 1
    assert preview["summary"]["UNCHANGED"] == 1

    status_by_slug = {c["slug"]: c["status"] for c in preview["items"]}
    assert status_by_slug["test-architect"] == "UNCHANGED"
    assert status_by_slug["test-growth"] == "UPDATED"
    assert status_by_slug["test-pm"] == "NEW"

    # Apply synchronization
    applied = agency_agent_synchronizer.apply_sync(
        db=db_session,
        source_dir=str(tmp_path),
    )
    assert applied["applied"]["created"] == 1
    assert applied["applied"]["updated"] == 1

    # Verify updated specialist has version 2 in definition
    updated_spec = db_session.query(SpecialistDefinitionModel).filter_by(slug="test-growth").first()
    assert updated_spec.version == 2

    # Verify both version 1 and version 2 records exist in SpecialistVersionModel
    versions = (
        db_session.query(SpecialistVersionModel)
        .filter_by(specialist_id=updated_spec.id)
        .order_by(SpecialistVersionModel.version.asc())
        .all()
    )
    assert len(versions) == 2
    assert versions[0].version == 1
    assert versions[1].version == 2
    assert "Updated growth experiments" in versions[1].raw_content

    # Verify new specialist was created
    new_spec = db_session.query(SpecialistDefinitionModel).filter_by(slug="test-pm").first()
    assert new_spec is not None
    assert new_spec.name == "Test Product Lead"
    assert new_spec.version == 1
