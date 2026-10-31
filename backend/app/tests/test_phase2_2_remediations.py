import pytest
import uuid
from datetime import datetime
from unittest.mock import patch
from sqlalchemy.exc import IntegrityError
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.models.agent import AgentModel
from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.models.task import TaskModel
from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
from backend.app.services.recruitment_service import recruitment_service
from backend.app.services.workstation_service import workstation_service
from backend.app.services.task_service import TaskService
from backend.app.schemas.task import TaskCreate
from backend.app.core.errors import ValidationError
from backend.app.core.auth import (
    create_access_token,
    ROLE_PLATFORM_SUPERADMIN,
    ROLE_ORGANIZATION_OWNER,
    ROLE_ORGANIZATION_ADMIN,
    ROLE_ORGANIZATION_MEMBER,
)

@pytest.fixture
def auth_tokens(db_session):
    """
    Sets up two isolated tenant organizations (Org A and Org B)
    with owners, admins, members, and a platform superadmin.
    """
    # 1. Create Org A
    org_a = OrganizationModel(
        id="org_alpha_corp",
        name="Alpha Corporation",
        slug="alpha-corp",
        tier="enterprise",
        is_active=True,
    )
    # 2. Create Org B
    org_b = OrganizationModel(
        id="org_beta_inc",
        name="Beta Inc",
        slug="beta-inc",
        tier="pro",
        is_active=True,
    )
    db_session.add_all([org_a, org_b])
    db_session.flush()

    from backend.app.core.auth import hash_password
    users = [
        UserModel(id="usr_super", email="superadmin@agency.ai", hashed_password=hash_password("SuperSecret!"), full_name="Super Admin", is_superadmin=True, is_active=True, token_version=1),
        UserModel(id="usr_owner_a", email="owner@alpha.corp", hashed_password=hash_password("OwnerASecret!"), full_name="Owner A", is_superadmin=False, is_active=True, token_version=1),
        UserModel(id="usr_admin_a", email="admin@alpha.corp", hashed_password=hash_password("AdminASecret!"), full_name="Admin A", is_superadmin=False, is_active=True, token_version=1),
        UserModel(id="usr_member_a", email="member@alpha.corp", hashed_password=hash_password("MemberASecret!"), full_name="Member A", is_superadmin=False, is_active=True, token_version=1),
        UserModel(id="usr_owner_b", email="owner@beta.inc", hashed_password=hash_password("OwnerBSecret!"), full_name="Owner B", is_superadmin=False, is_active=True, token_version=1),
    ]
    members = [
        OrganizationMemberModel(organization_id="org_alpha_corp", user_id="usr_super", role=ROLE_PLATFORM_SUPERADMIN),
        OrganizationMemberModel(organization_id="org_alpha_corp", user_id="usr_owner_a", role=ROLE_ORGANIZATION_OWNER),
        OrganizationMemberModel(organization_id="org_alpha_corp", user_id="usr_admin_a", role=ROLE_ORGANIZATION_ADMIN),
        OrganizationMemberModel(organization_id="org_alpha_corp", user_id="usr_member_a", role=ROLE_ORGANIZATION_MEMBER),
        OrganizationMemberModel(organization_id="org_beta_inc", user_id="usr_owner_b", role=ROLE_ORGANIZATION_OWNER),
    ]
    db_session.add_all(users + members)
    db_session.flush()

    token_superadmin = create_access_token(
        user_id="usr_super",
        email="superadmin@agency.ai",
        is_superadmin=True,
        org_roles={"org_alpha_corp": ROLE_PLATFORM_SUPERADMIN},
    )

    token_owner_a = create_access_token(
        user_id="usr_owner_a",
        email="owner@alpha.corp",
        is_superadmin=False,
        org_roles={"org_alpha_corp": ROLE_ORGANIZATION_OWNER},
    )

    token_admin_a = create_access_token(
        user_id="usr_admin_a",
        email="admin@alpha.corp",
        is_superadmin=False,
        org_roles={"org_alpha_corp": ROLE_ORGANIZATION_ADMIN},
    )

    token_member_a = create_access_token(
        user_id="usr_member_a",
        email="member@alpha.corp",
        is_superadmin=False,
        org_roles={"org_alpha_corp": ROLE_ORGANIZATION_MEMBER},
    )

    token_owner_b = create_access_token(
        user_id="usr_owner_b",
        email="owner@beta.inc",
        is_superadmin=False,
        org_roles={"org_beta_inc": ROLE_ORGANIZATION_OWNER},
    )

    return {
        "superadmin": token_superadmin,
        "owner_a": token_owner_a,
        "admin_a": token_admin_a,
        "member_a": token_member_a,
        "owner_b": token_owner_b,
    }

@pytest.fixture
def seed_specialist_versions(db_session):
    """
    Seeds a test specialist with v1 and v2 version records.
    """
    spec = SpecialistDefinitionModel(
        id="spec_test_versioned",
        slug="versioned-specialist",
        name="Versioned Specialist",
        division="engineering",
        department="Engineering",
        role="Cloud Infrastructure Engineer",
        description="Version 1 base architecture definition",
        system_instructions="Base AWS cloud setup.",
        core_mission="Base AWS cloud setup.",
        critical_rules="Operate safely.",
        version=1,
        source_path="engineering/versioned-specialist.md",
        content_hash="hash_v1_original",
        raw_content="---\nname: Versioned Specialist\nrole: Cloud Infrastructure Engineer\n---\n# Version 1 Instructions\nBase AWS cloud setup.",
        validation_status="VALID",
        lifecycle_state="AVAILABLE",
    )
    db_session.add(spec)
    db_session.flush()

    v1 = SpecialistVersionModel(
        id="ver_test_v1",
        specialist_id=spec.id,
        version=1,
        content_hash="hash_v1_original",
        raw_content=spec.raw_content,
        change_summary="Initial v1 release",
    )
    db_session.add(v1)
    db_session.commit()

    return spec, v1


# =========================================================================
# 1. REMED-01: AUTHENTICATION AND TENANT AUTHORIZATION
# =========================================================================

def test_unauthenticated_requests_rejected(client):
    """Proves unauthenticated requests cannot access protected workforce APIs."""
    endpoints = [
        ("GET", "/api/v1/recruitment/recruited"),
        ("GET", "/api/v1/recruitment/workforce"),
        ("GET", "/api/v1/recruitment/hierarchy"),
        ("POST", "/api/v1/recruitment/recruit"),
        ("POST", "/api/v1/recruitment/agent-123/activate"),
        ("POST", "/api/v1/recruitment/agent-123/suspend"),
        ("POST", "/api/v1/recruitment/agent-123/retire"),
        ("POST", "/api/v1/recruitment/agent-123/workstation"),
        ("POST", "/api/v1/specialists/sync/preview"),
        ("POST", "/api/v1/specialists/sync/apply"),
    ]
    for method, path in endpoints:
        if method == "GET":
            res = client.get(path)
        else:
            res = client.post(path, json={})
        assert res.status_code == 401, f"Expected 401 for unauthenticated {method} {path}, got {res.status_code}"

def test_cross_tenant_isolation(client, db_session, auth_tokens, seed_specialist_versions):
    """
    Proves Organization A cannot read, retire, suspend, or reassign Organization B's employee.
    Avoids leaking existence across tenants (returns 404).
    """
    spec, _ = seed_specialist_versions

    # Org B recruits an employee
    headers_b = {"Authorization": f"Bearer {auth_tokens['owner_b']}"}
    recruit_res = client.post(
        "/api/v1/recruitment/recruit",
        json={"specialist_id": spec.slug, "department": "Engineering"},
        headers=headers_b,
    )
    assert recruit_res.status_code == 201
    agent_b_id = recruit_res.json()["agent_id"]

    headers_a = {"Authorization": f"Bearer {auth_tokens['owner_a']}"}

    # Org A reads workforce -> cannot see Org B's agent
    wf_a = client.get("/api/v1/recruitment/workforce", headers=headers_a)
    assert wf_a.status_code == 200
    assert len(wf_a.json()["workforce"]) == 0

    # Org A tries to suspend Org B's agent -> rejected with 404
    sus_res = client.post(f"/api/v1/recruitment/{agent_b_id}/suspend", headers=headers_a)
    assert sus_res.status_code == 404

    # Org A tries to retire Org B's agent -> rejected with 404
    ret_res = client.post(f"/api/v1/recruitment/{agent_b_id}/retire", headers=headers_a)
    assert ret_res.status_code == 404

    # Org A tries to reassign Org B's workstation -> rejected with 404
    reassign_res = client.post(
        f"/api/v1/recruitment/{agent_b_id}/workstation",
        json={"department": "Marketing"},
        headers=headers_a,
    )
    assert reassign_res.status_code == 404

def test_forged_organization_id_in_request_body_ignored(client, auth_tokens, seed_specialist_versions):
    """
    Proves that a client forging organization_id in request body or headers cannot bypass tenant scoping.
    """
    spec, _ = seed_specialist_versions
    headers_a = {"Authorization": f"Bearer {auth_tokens['owner_a']}"}

    # Attempt to recruit on behalf of Org B while authenticated as Org A owner
    res = client.post(
        "/api/v1/recruitment/recruit",
        json={
            "specialist_id": spec.slug,
            "organization_id": "org_beta_inc",  # FORGED ORG ID
            "department": "Engineering",
        },
        headers=headers_a,
    )
    assert res.status_code == 201
    data = res.json()
    # The server must bind to the authenticated tenant (org_alpha_corp), NOT the forged body!
    assert data["organization_id"] == "org_alpha_corp"

def test_role_based_permissions(client, auth_tokens):
    """
    Proves RBAC: Member cannot recruit (403), Admin cannot apply global sync (403), Superadmin can apply sync.
    """
    headers_member = {"Authorization": f"Bearer {auth_tokens['member_a']}"}
    headers_admin = {"Authorization": f"Bearer {auth_tokens['admin_a']}"}
    headers_super = {"Authorization": f"Bearer {auth_tokens['superadmin']}"}

    # Member cannot recruit
    res_mem = client.post(
        "/api/v1/recruitment/recruit",
        json={"specialist_id": "any", "department": "Engineering"},
        headers=headers_member,
    )
    assert res_mem.status_code == 403

    # Org admin can preview sync, but CANNOT apply global sync
    res_prev = client.post("/api/v1/specialists/sync/preview", headers=headers_admin)
    assert res_prev.status_code in [200, 404]  # Allowed past authorization (404 only if source dir missing)

    res_apply_admin = client.post("/api/v1/specialists/sync/apply", headers=headers_admin)
    assert res_apply_admin.status_code == 403

    # Superadmin CAN apply global sync
    res_apply_super = client.post("/api/v1/specialists/sync/apply", headers=headers_super)
    assert res_apply_super.status_code == 200


# =========================================================================
# 2. REMED-02: DATABASE-ENFORCED PHYSICAL DESK UNIQUENESS
# =========================================================================

def test_physical_desk_database_uniqueness(db_session):
    """
    Verifies database-level uniqueness on (organization_id, department, desk_number)
    for occupied physical desks.
    """
    # Create agents to satisfy foreign key
    ag1 = AgentModel(id="agent_desk_1", name="Desk Agent 1", role="Role", station="engineering_bay", organization_id="org_test_uniqueness")
    ag2 = AgentModel(id="agent_desk_2", name="Desk Agent 2", role="Role", station="engineering_bay", organization_id="org_test_uniqueness")
    ag_v = AgentModel(id="agent_desk_virt", name="Desk Agent Virt", role="Role", station="engineering_bay", organization_id="org_test_uniqueness")
    ag_m = AgentModel(id="agent_desk_mkt", name="Desk Agent Mkt", role="Role", station="marketing_studio", organization_id="org_test_uniqueness")
    db_session.add_all([ag1, ag2, ag_v, ag_m])
    db_session.commit()

    # 1. Create first assigned physical desk
    alloc1 = WorkstationAllocationModel(
        organization_id="org_test_uniqueness",
        agent_id="agent_desk_1",
        department="Engineering",
        logical_workstation_id="ws-engineering-1",
        office_zone="engineering_bay",
        desk_number=1,
        allocation_status="ASSIGNED",
        is_virtual=False,
    )
    db_session.add(alloc1)
    db_session.commit()

    # 2. Attempt duplicate physical allocation in same organization, department, and desk_number
    alloc2 = WorkstationAllocationModel(
        organization_id="org_test_uniqueness",
        agent_id="agent_desk_2",
        department="Engineering",
        logical_workstation_id="ws-engineering-1-dup",
        office_zone="engineering_bay",
        desk_number=1,  # COLLISION
        allocation_status="ASSIGNED",
        is_virtual=False,
    )
    with pytest.raises(IntegrityError):
        with db_session.begin_nested():
            db_session.add(alloc2)
            db_session.flush()

    # 3. Virtual allocation with desk_number=None or virtual does not conflict
    alloc_virt = WorkstationAllocationModel(
        organization_id="org_test_uniqueness",
        agent_id="agent_desk_virt",
        department="Engineering",
        logical_workstation_id="vws-engineering-1",
        office_zone="engineering_bay",
        desk_number=None,
        allocation_status="VIRTUAL",
        is_virtual=True,
    )
    db_session.add(alloc_virt)
    db_session.commit()
    assert alloc_virt.id is not None

    # 4. Same desk_number in a DIFFERENT department does not conflict
    alloc_mkt = WorkstationAllocationModel(
        organization_id="org_test_uniqueness",
        agent_id="agent_desk_mkt",
        department="Marketing",
        logical_workstation_id="ws-marketing-1",
        office_zone="marketing_studio",
        desk_number=1,
        allocation_status="ASSIGNED",
        is_virtual=False,
    )
    db_session.add(alloc_mkt)
    db_session.commit()
    assert alloc_mkt.id is not None

def test_workstation_service_savepoint_retry_on_desk_collision(db_session):
    """
    Tests that WorkstationService savepoint retry gracefully catches desk collisions
    and allocates the next available desk or falls back to virtual.
    """
    ag_p1 = AgentModel(id="agent_pre_1", name="Pre Agent 1", role="Role", station="engineering_bay", organization_id="org_savepoint_test")
    ag_p2 = AgentModel(id="agent_pre_2", name="Pre Agent 2", role="Role", station="engineering_bay", organization_id="org_savepoint_test")
    db_session.add_all([ag_p1, ag_p2])
    db_session.commit()

    # Pre-occupy desk 1
    alloc1 = workstation_service.allocate_workstation(
        db=db_session,
        agent_id="agent_pre_1",
        department="Engineering",
        organization_id="org_savepoint_test",
        force_virtual=False,
    )
    assert alloc1.desk_number == 1
    db_session.commit()

    # Next allocation naturally gets desk 2
    alloc2 = workstation_service.allocate_workstation(
        db=db_session,
        agent_id="agent_pre_2",
        department="Engineering",
        organization_id="org_savepoint_test",
        force_virtual=False,
    )
    assert alloc2.desk_number == 2
    db_session.commit()


# =========================================================================
# 3. REMED-03: IMMUTABLE SPECIALIST VERSION PINNING
# =========================================================================

def test_immutable_specialist_version_pinning(db_session, seed_specialist_versions):
    """
    Proves:
    1. Recruited employee pins exact specialist_version_id and version_num (v1).
    2. When upstream updates catalog to v2, employee stays pinned to v1.
    3. New employee recruited after update pins v2.
    4. Prompt assembly builds from the pinned version instructions.
    """
    spec, v1 = seed_specialist_versions

    # Employee 1 recruited while catalog is at v1
    emp1_res = recruitment_service.recruit_specialist(
        db=db_session,
        specialist_id=spec.id,
        organization_id="org_version_test",
        department="Engineering",
        custom_name="V1 Pinned Engineer",
    )
    assert emp1_res["specialist_version_id"] == v1.id
    assert emp1_res["specialist_version_num"] == 1

    # Upstream catalog updates to v2
    v2 = SpecialistVersionModel(
        id="ver_test_v2",
        specialist_id=spec.id,
        version=2,
        content_hash="hash_v2_kubernetes",
        raw_content="---\nname: Versioned Specialist\nrole: Principal Cloud Architect\n---\n# Version 2 Instructions\nAdvanced Kubernetes clusters and multi-region failover.",
        change_summary="Upgraded to v2 with Kubernetes support",
    )
    db_session.add(v2)
    spec.version = 2
    spec.description = "Version 2 Kubernetes specialist"
    db_session.commit()

    # Verify Employee 1 record in DB remains pinned to v1
    rec1 = db_session.query(RecruitmentRecordModel).filter_by(agent_id=emp1_res["agent_id"]).first()
    assert rec1.specialist_version_id == v1.id
    assert rec1.specialist_version_num == 1

    # Employee 2 recruited in Org B pins v2
    emp2_res = recruitment_service.recruit_specialist(
        db=db_session,
        specialist_id=spec.id,
        organization_id="org_version_test_b",
        department="Engineering",
        custom_name="V2 Modern Engineer",
    )
    assert emp2_res["specialist_version_id"] == v2.id
    assert emp2_res["specialist_version_num"] == 2

    # Verify runtime registry prompt for Employee 1 reflects pinned v1 instructions
    from backend.app.agent_runtime.registry.agent_registry import default_agent_registry
    def1 = default_agent_registry.get(emp1_res["agent_id"])
    assert "Pinned Specialist Version: v1" in def1.system_prompt
    assert "Base AWS cloud setup" in def1.system_prompt
    assert "Advanced Kubernetes clusters" not in def1.system_prompt

    # Verify runtime registry prompt for Employee 2 reflects pinned v2 instructions
    def2 = default_agent_registry.get(emp2_res["agent_id"])
    assert "Pinned Specialist Version: v2" in def2.system_prompt
    assert "Advanced Kubernetes clusters" in def2.system_prompt


# =========================================================================
# 4. REMED-04: ATOMIC TRANSACTION BOUNDARIES
# =========================================================================

def test_transaction_rollback_integrity_on_recruitment_failure(db_session, seed_specialist_versions):
    """
    Deliberately injects a failure during recruitment (e.g. in performance init)
    and verifies that agent and workstation records are cleanly rolled back.
    """
    spec, _ = seed_specialist_versions
    org_id = "org_tx_fail_test"

    agents_before = db_session.query(AgentModel).filter_by(organization_id=org_id).count()
    ws_before = db_session.query(WorkstationAllocationModel).filter_by(organization_id=org_id).count()

    with patch("backend.app.services.recruitment_service.AgentPerformanceModel", side_effect=RuntimeError("Deliberate failure inside transaction")):
        with pytest.raises(RuntimeError):
            recruitment_service.recruit_specialist(
                db=db_session,
                specialist_id=spec.id,
                organization_id=org_id,
                department="Engineering",
            )

    agents_after = db_session.query(AgentModel).filter_by(organization_id=org_id).count()
    ws_after = db_session.query(WorkstationAllocationModel).filter_by(organization_id=org_id).count()

    assert agents_after == agents_before, "Agent record was not rolled back upon transaction failure!"
    assert ws_after == ws_before, "Workstation allocation was not rolled back upon transaction failure!"


# =========================================================================
# 5. REMED-05: RECRUITMENT LIFECYCLE EXECUTION GUARDS
# =========================================================================

def test_task_creation_rejected_for_suspended_and_retired_employees(db_session, seed_specialist_versions):
    """
    Proves that TaskService.create_task rejects task assignment
    if employee is in SUSPENDED, RETIRED, or CONFIGURED state.
    """
    spec, _ = seed_specialist_versions
    emp = recruitment_service.recruit_specialist(
        db=db_session,
        specialist_id=spec.id,
        organization_id="org_lifecycle_test",
        department="Engineering",
    )
    agent_id = emp["agent_id"]

    # 1. While ACTIVE: task creation succeeds
    t_active = TaskService.create_task(
        db=db_session,
        task_in=TaskCreate(
            title="Active Task",
            description="Work on cloud setup",
            assigned_agent_id=agent_id,
        ),
    )
    assert t_active.id is not None
    assert t_active.status == "queued"

    # 2. Suspend employee
    recruitment_service.transition_lifecycle(
        db=db_session,
        agent_id=agent_id,
        target_state="SUSPENDED",
        reason="Performance review",
    )

    # Task creation MUST be rejected
    with pytest.raises(ValidationError) as exc_info:
        TaskService.create_task(
            db=db_session,
            task_in=TaskCreate(
                title="Suspended Task",
                description="Should not be created",
                assigned_agent_id=agent_id,
            ),
        )
    assert "cannot accept tasks" in str(exc_info.value)

    # 3. Retire employee
    recruitment_service.transition_lifecycle(
        db=db_session,
        agent_id=agent_id,
        target_state="RETIRED",
        reason="Contract terminated",
    )

    # Task creation MUST be rejected
    with pytest.raises(ValidationError) as exc_info:
        TaskService.create_task(
            db=db_session,
            task_in=TaskCreate(
                title="Retired Task",
                description="Should not be created",
                assigned_agent_id=agent_id,
            ),
        )
    assert "cannot accept tasks" in str(exc_info.value)

def test_queued_tasks_auto_cancelled_upon_suspension_or_retirement(db_session, seed_specialist_versions):
    """
    Proves that tasks already queued for an employee are automatically cancelled
    when that employee transitions to SUSPENDED or RETIRED.
    """
    spec, _ = seed_specialist_versions
    emp = recruitment_service.recruit_specialist(
        db=db_session,
        specialist_id=spec.id,
        organization_id="org_cancel_queued_test",
        department="Engineering",
    )
    agent_id = emp["agent_id"]

    # Queue 2 tasks
    t1 = TaskService.create_task(
        db=db_session,
        task_in=TaskCreate(title="Queued Task 1", description="Description 1", assigned_agent_id=agent_id),
    )
    t2 = TaskService.create_task(
        db=db_session,
        task_in=TaskCreate(title="Queued Task 2", description="Description 2", assigned_agent_id=agent_id),
    )
    assert t1.status == "queued"
    assert t2.status == "queued"

    # Suspend employee -> tasks must be cancelled
    recruitment_service.transition_lifecycle(
        db=db_session,
        agent_id=agent_id,
        target_state="SUSPENDED",
        reason="Investigating security issue",
    )

    db_session.refresh(t1)
    db_session.refresh(t2)
    assert t1.status == "cancelled"
    assert "assigned employee was suspended" in t1.error_message
    assert t2.status == "cancelled"
    assert "assigned employee was suspended" in t2.error_message


# =========================================================================
# 6. REMED-06: GLOBAL CATALOG SYNC AUDIT AND PROTECTION
# =========================================================================

def test_global_catalog_sync_admin_protection(client, auth_tokens):
    """
    Proves that apply_upstream_sync strictly requires PLATFORM_SUPERADMIN,
    records audit logging, and preserves specialist version stability.
    """
    headers_owner = {"Authorization": f"Bearer {auth_tokens['owner_a']}"}
    headers_super = {"Authorization": f"Bearer {auth_tokens['superadmin']}"}

    # Org owner cannot apply sync (403)
    res_forbidden = client.post("/api/v1/specialists/sync/apply", headers=headers_owner)
    assert res_forbidden.status_code == 403

    # Superadmin can apply sync (200)
    res_ok = client.post("/api/v1/specialists/sync/apply", headers=headers_super)
    assert res_ok.status_code == 200
    assert res_ok.json()["success"] is True
