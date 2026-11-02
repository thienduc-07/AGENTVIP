"""
PROVIPAGENT Phase 4.3.7.1: Multi-Tenant Isolation & Adversarial HTTP API Verification
Independently verifies that all REST API endpoints strictly enforce server-side
authoritative organization isolation across Agents, Workstations, Executions,
Tasks, Meetings, and Approvals under adversarial conditions.
"""
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.core.auth import create_access_token
from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.models.execution import ExecutionModel, TerminalLineModel
from backend.app.models.approval import ApprovalModel
from backend.app.models.meeting import MeetingModel, MeetingParticipantModel


@pytest.fixture
def adversarial_env(db_session: Session):
    """
    Sets up two genuinely isolated tenant organizations with independent users,
    agents, workstations, executions, tasks, meetings, and approvals.
    """
    # 1. Organizations
    org_a = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_adv_alpha").first()
    if not org_a:
        org_a = OrganizationModel(id="org_adv_alpha", name="Alpha Corporation", slug="alpha-corp", is_active=True)
        db_session.add(org_a)

    org_b = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_adv_beta").first()
    if not org_b:
        org_b = OrganizationModel(id="org_adv_beta", name="Beta Industries", slug="beta-ind", is_active=True)
        db_session.add(org_b)

    # 2. Users
    # Admin A in Org A (has PERM_DECIDE_APPROVAL)
    user_admin_a = db_session.query(UserModel).filter(UserModel.id == "usr_adv_alpha_admin").first()
    if not user_admin_a:
        user_admin_a = UserModel(
            id="usr_adv_alpha_admin",
            email="admin@alpha.corp",
            full_name="Admin Alpha",
            hashed_password="pw",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_admin_a)

    # Member A in Org A (regular member, no DECIDE_APPROVAL)
    user_member_a = db_session.query(UserModel).filter(UserModel.id == "usr_adv_alpha_member").first()
    if not user_member_a:
        user_member_a = UserModel(
            id="usr_adv_alpha_member",
            email="member@alpha.corp",
            full_name="Member Alpha",
            hashed_password="pw",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_member_a)

    # Admin B in Org B
    user_admin_b = db_session.query(UserModel).filter(UserModel.id == "usr_adv_beta_admin").first()
    if not user_admin_b:
        user_admin_b = UserModel(
            id="usr_adv_beta_admin",
            email="admin@beta.ind",
            full_name="Admin Beta",
            hashed_password="pw",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_admin_b)

    # 3. Memberships
    m_admin_a = db_session.query(OrganizationMemberModel).filter(
        OrganizationMemberModel.user_id == "usr_adv_alpha_admin",
        OrganizationMemberModel.organization_id == "org_adv_alpha"
    ).first()
    if not m_admin_a:
        m_admin_a = OrganizationMemberModel(
            id="mem_adv_a_admin",
            user_id="usr_adv_alpha_admin",
            organization_id="org_adv_alpha",
            role="ORGANIZATION_ADMIN",
        )
        db_session.add(m_admin_a)

    m_member_a = db_session.query(OrganizationMemberModel).filter(
        OrganizationMemberModel.user_id == "usr_adv_alpha_member",
        OrganizationMemberModel.organization_id == "org_adv_alpha"
    ).first()
    if not m_member_a:
        m_member_a = OrganizationMemberModel(
            id="mem_adv_a_member",
            user_id="usr_adv_alpha_member",
            organization_id="org_adv_alpha",
            role="ORGANIZATION_MEMBER",
        )
        db_session.add(m_member_a)

    m_admin_b = db_session.query(OrganizationMemberModel).filter(
        OrganizationMemberModel.user_id == "usr_adv_beta_admin",
        OrganizationMemberModel.organization_id == "org_adv_beta"
    ).first()
    if not m_admin_b:
        m_admin_b = OrganizationMemberModel(
            id="mem_adv_b_admin",
            user_id="usr_adv_beta_admin",
            organization_id="org_adv_beta",
            role="ORGANIZATION_ADMIN",
        )
        db_session.add(m_admin_b)

    # 4. Agents
    agent_a = db_session.query(AgentModel).filter(AgentModel.id == "agt_adv_alpha").first()
    if not agent_a:
        agent_a = AgentModel(
            id="agt_adv_alpha",
            organization_id="org_adv_alpha",
            name="Alpha Agent Architect",
            role="Solutions Architect",
            description="Alpha confidential architecture blueprints",
            status="idle",
            behavioral_state="IDLE",
        )
        db_session.add(agent_a)

    agent_b = db_session.query(AgentModel).filter(AgentModel.id == "agt_adv_beta").first()
    if not agent_b:
        agent_b = AgentModel(
            id="agt_adv_beta",
            organization_id="org_adv_beta",
            name="Beta Agent Finance",
            role="Financial Auditor",
            description="Beta confidential balance sheets and audits",
            status="idle",
            behavioral_state="IDLE",
        )
        db_session.add(agent_b)

    # 5. Workstation Allocations
    ws_a = db_session.query(WorkstationAllocationModel).filter(WorkstationAllocationModel.id == "ws_adv_alpha").first()
    if not ws_a:
        ws_a = WorkstationAllocationModel(
            id="ws_adv_alpha",
            organization_id="org_adv_alpha",
            agent_id="agt_adv_alpha",
            logical_workstation_id="ws_desk_alpha_01",
            department="Engineering",
            office_zone="Engineering Zone",
            desk_number=101,
            allocation_status="ACTIVE",
        )
        db_session.add(ws_a)

    ws_b = db_session.query(WorkstationAllocationModel).filter(WorkstationAllocationModel.id == "ws_adv_beta").first()
    if not ws_b:
        ws_b = WorkstationAllocationModel(
            id="ws_adv_beta",
            organization_id="org_adv_beta",
            agent_id="agt_adv_beta",
            logical_workstation_id="ws_desk_beta_01",
            department="Finance",
            office_zone="Finance Zone",
            desk_number=201,
            allocation_status="ACTIVE",
        )
        db_session.add(ws_b)

    # 6. Tasks
    task_a = db_session.query(TaskModel).filter(TaskModel.id == "tsk_adv_alpha").first()
    if not task_a:
        task_a = TaskModel(
            id="tsk_adv_alpha",
            organization_id="org_adv_alpha",
            assigned_agent_id="agt_adv_alpha",
            title="Alpha Project Falcon",
            description="Confidential Falcon mission parameters",
            status="running",
            priority="high",
        )
        db_session.add(task_a)

    task_b = db_session.query(TaskModel).filter(TaskModel.id == "tsk_adv_beta").first()
    if not task_b:
        task_b = TaskModel(
            id="tsk_adv_beta",
            organization_id="org_adv_beta",
            assigned_agent_id="agt_adv_beta",
            title="Beta Project Eagle",
            description="Confidential Eagle budget parameters",
            status="running",
            priority="urgent",
        )
        db_session.add(task_b)

    # 7. Executions & Terminal Lines
    exec_a = db_session.query(ExecutionModel).filter(ExecutionModel.id == "exec_adv_alpha").first()
    if not exec_a:
        exec_a = ExecutionModel(
            id="exec_adv_alpha",
            organization_id="org_adv_alpha",
            agent_id="agt_adv_alpha",
            task_id="tsk_adv_alpha",
            status="running",
            summary="Alpha execution trace",
            total_lines=1,
        )
        db_session.add(exec_a)
        line_a = TerminalLineModel(
            id="line_adv_alpha_01",
            execution_id="exec_adv_alpha",
            organization_id="org_adv_alpha",
            agent_id="agt_adv_alpha",
            task_id="tsk_adv_alpha",
            line_number=1,
            stream="stdout",
            content="Alpha proprietary internal build step executed",
        )
        db_session.add(line_a)

    exec_b = db_session.query(ExecutionModel).filter(ExecutionModel.id == "exec_adv_beta").first()
    if not exec_b:
        exec_b = ExecutionModel(
            id="exec_adv_beta",
            organization_id="org_adv_beta",
            agent_id="agt_adv_beta",
            task_id="tsk_adv_beta",
            status="running",
            summary="Beta execution trace",
            total_lines=1,
        )
        db_session.add(exec_b)
        line_b = TerminalLineModel(
            id="line_adv_beta_01",
            execution_id="exec_adv_beta",
            organization_id="org_adv_beta",
            agent_id="agt_adv_beta",
            task_id="tsk_adv_beta",
            line_number=1,
            stream="stdout",
            content="Beta proprietary quarterly audit line executed",
        )
        db_session.add(line_b)

    # 8. Approvals
    appr_a = db_session.query(ApprovalModel).filter(ApprovalModel.id == "appr_adv_alpha").first()
    if not appr_a:
        appr_a = ApprovalModel(
            id="appr_adv_alpha",
            task_id="tsk_adv_alpha",
            action_type="deploy_alpha_service",
            description="Deploy Alpha core cluster",
            status="pending",
        )
        db_session.add(appr_a)

    appr_b = db_session.query(ApprovalModel).filter(ApprovalModel.id == "appr_adv_beta").first()
    if not appr_b:
        appr_b = ApprovalModel(
            id="appr_adv_beta",
            task_id="tsk_adv_beta",
            action_type="transfer_beta_funds",
            description="Transfer 1,000,000 USD to liquidity pool",
            status="pending",
        )
        db_session.add(appr_b)

    # 9. Meetings
    meeting_a = db_session.query(MeetingModel).filter(MeetingModel.id == "mtg_adv_alpha").first()
    if not meeting_a:
        meeting_a = MeetingModel(
            id="mtg_adv_alpha",
            organization_id="org_adv_alpha",
            title="Alpha Board Strategy Meeting",
            objective="Company acquisition roadmap",
            status="INITIALIZING",
            moderator_agent_id="agt_adv_alpha",
        )
        db_session.add(meeting_a)

    meeting_b = db_session.query(MeetingModel).filter(MeetingModel.id == "mtg_adv_beta").first()
    if not meeting_b:
        meeting_b = MeetingModel(
            id="mtg_adv_beta",
            organization_id="org_adv_beta",
            title="Beta Executive Compensation",
            objective="Executive stock distribution plan",
            status="INITIALIZING",
            moderator_agent_id="agt_adv_beta",
        )
        db_session.add(meeting_b)

    db_session.commit()

    token_admin_a = create_access_token(user_id="usr_adv_alpha_admin", email="admin@alpha.corp", token_version=1)
    token_member_a = create_access_token(user_id="usr_adv_alpha_member", email="member@alpha.corp", token_version=1)
    token_admin_b = create_access_token(user_id="usr_adv_beta_admin", email="admin@beta.ind", token_version=1)

    return {
        "token_admin_a": token_admin_a,
        "token_member_a": token_member_a,
        "token_admin_b": token_admin_b,
        "agent_a_id": "agt_adv_alpha",
        "agent_b_id": "agt_adv_beta",
        "ws_a_id": "ws_adv_alpha",
        "ws_b_id": "ws_adv_beta",
        "task_a_id": "tsk_adv_alpha",
        "task_b_id": "tsk_adv_beta",
        "exec_a_id": "exec_adv_alpha",
        "exec_b_id": "exec_adv_beta",
        "appr_a_id": "appr_adv_alpha",
        "appr_b_id": "appr_adv_beta",
        "meeting_a_id": "mtg_adv_alpha",
        "meeting_b_id": "mtg_adv_beta",
    }


def test_cross_tenant_agent_read_rejected(client: TestClient, adversarial_env):
    """Scenario 2.1: User A requests Agent B by ID; User B requests Agent A by ID."""
    token_a = adversarial_env["token_admin_a"]
    token_b = adversarial_env["token_admin_b"]

    # User A requests Agent B
    res_a = client.get(
        f"/api/v1/agents/{adversarial_env['agent_b_id']}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res_a.status_code == 404, "User A must not access Agent B"
    assert "Beta confidential" not in res_a.text

    # User B requests Agent A
    res_b = client.get(
        f"/api/v1/agents/{adversarial_env['agent_a_id']}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert res_b.status_code == 404, "User B must not access Agent A"
    assert "Alpha confidential" not in res_b.text


def test_cross_tenant_agent_inspection_rejected(client: TestClient, adversarial_env):
    """Scenario 2.1: User A requests inspection HUD of Agent B."""
    token_a = adversarial_env["token_admin_a"]
    res = client.get(
        f"/api/v1/agents/{adversarial_env['agent_b_id']}/inspection",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res.status_code == 404
    assert "Beta Agent Finance" not in res.text


def test_cross_tenant_agent_update_rejected(client: TestClient, adversarial_env):
    """Scenario 2.1: User A attempts to PATCH update Agent B."""
    token_a = adversarial_env["token_admin_a"]
    res = client.patch(
        f"/api/v1/agents/{adversarial_env['agent_b_id']}",
        json={"name": "Hacked Agent Name"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res.status_code in (404, 403)


def test_cross_tenant_agent_movement_actions_rejected(client: TestClient, adversarial_env):
    """Scenario 2.1: User A attempts to control Agent B's movement and behavioral state."""
    token_a = adversarial_env["token_admin_a"]
    agent_b = adversarial_env["agent_b_id"]

    res1 = client.post(
        f"/api/v1/agents/{agent_b}/navigate",
        json={"destination": "conference_room"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res1.status_code in (404, 403)

    res2 = client.post(
        f"/api/v1/agents/{agent_b}/behavioral-state",
        json={"behavioral_state": "WORKING"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    # Rejection: returns 422 CROSS_TENANT_BEHAVIORAL_TRANSITION or 404/403
    assert res2.status_code in (404, 403, 422)


def test_cross_tenant_workstation_read_rejected(client: TestClient, adversarial_env):
    """Scenario 2.2: User A attempts to access Agent B's workstation detail and history."""
    token_a = adversarial_env["token_admin_a"]
    agent_b = adversarial_env["agent_b_id"]

    # Workstation live detail
    res1 = client.get(
        f"/api/v1/workstations/{agent_b}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res1.status_code in (404, 403)
    assert "Finance Zone" not in res1.text

    # Workstation executions
    res2 = client.get(
        f"/api/v1/workstations/{agent_b}/executions",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    # Must either be 404/403 or return empty list scoped to Org A without leaking Org B executions
    if res2.status_code == 200:
        data = res2.json()
        exec_ids = [e["id"] for e in data.get("executions", [])]
        assert adversarial_env["exec_b_id"] not in exec_ids
    else:
        assert res2.status_code in (404, 403)

    # Workstation terminal lines
    res3 = client.get(
        f"/api/v1/workstations/{agent_b}/terminal",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    if res3.status_code == 200:
        lines = res3.json().get("lines", [])
        assert len(lines) == 0 or all("Beta proprietary" not in l.get("content", "") for l in lines)
    else:
        assert res3.status_code in (404, 403)


def test_cross_tenant_execution_direct_read_rejected(client: TestClient, adversarial_env):
    """Scenario 2.3: User A attempts to read Execution B, its events, and its terminal lines."""
    token_a = adversarial_env["token_admin_a"]
    exec_b = adversarial_env["exec_b_id"]

    # 1. Execution detail
    res1 = client.get(
        f"/api/v1/executions/{exec_b}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res1.status_code == 404
    assert "Beta execution trace" not in res1.text

    # 2. Execution events
    res2 = client.get(
        f"/api/v1/executions/{exec_b}/events",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res2.status_code == 404

    # 3. Execution terminal lines
    res3 = client.get(
        f"/api/v1/executions/{exec_b}/terminal",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res3.status_code == 404
    assert "Beta proprietary quarterly audit line" not in res3.text


def test_cross_tenant_task_cancellation_and_control_rejected(client: TestClient, adversarial_env):
    """Scenario 2.3: User A attempts to pause, resume, or cancel Task B."""
    token_a = adversarial_env["token_admin_a"]
    task_b = adversarial_env["task_b_id"]

    res_cancel = client.post(
        f"/api/v1/tasks/{task_b}/cancel",
        json={"reason": "Adversarial cancellation attempt"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res_cancel.status_code in (404, 403)

    res_pause = client.post(
        f"/api/v1/tasks/{task_b}/pause",
        json={"reason": "Adversarial pause attempt"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res_pause.status_code in (404, 403)


def test_cross_tenant_meeting_read_rejected(client: TestClient, adversarial_env):
    """Scenario 2.4: User A attempts to read Meeting B and its participants."""
    token_a = adversarial_env["token_admin_a"]
    meeting_b = adversarial_env["meeting_b_id"]

    res1 = client.get(
        f"/api/v1/meetings/{meeting_b}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res1.status_code == 404
    assert "Beta Executive Compensation" not in res1.text

    res2 = client.get(
        f"/api/v1/meetings/{meeting_b}/participants",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res2.status_code == 404


def test_cross_tenant_meeting_mutation_rejected(client: TestClient, adversarial_env):
    """Scenario 2.4: User A attempts to modify Meeting B decisions or action items."""
    token_a = adversarial_env["token_admin_a"]
    meeting_b = adversarial_env["meeting_b_id"]

    res_dec = client.post(
        f"/api/v1/meetings/{meeting_b}/decisions",
        json={"title": "Hacked Decision", "description": "Authorize fraudulent bonus"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res_dec.status_code in (404, 403)

    res_act = client.post(
        f"/api/v1/meetings/{meeting_b}/action-items",
        json={
            "title": "Hacked Action Item",
            "description": "Exfiltrate database to attacker server",
            "assigned_agent_id": "agt_adv_beta",
        },
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res_act.status_code in (404, 403)


def test_cross_tenant_approval_read_and_decide_rejected(client: TestClient, adversarial_env):
    """Scenario 2.5: User A attempts to read or decide Approval B."""
    token_a = adversarial_env["token_admin_a"]
    appr_b = adversarial_env["appr_b_id"]

    res1 = client.get(
        f"/api/v1/approvals/{appr_b}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res1.status_code == 404
    assert "Transfer 1,000,000 USD" not in res1.text

    res2 = client.post(
        f"/api/v1/approvals/{appr_b}/decision",
        json={"decision": "approved", "reason": "Adversarial approval of funds transfer"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res2.status_code == 404


def test_unauthorized_member_approval_decision_rejected(client: TestClient, adversarial_env):
    """Scenario 2.5: Regular member in Org A (without DECIDE_APPROVAL) is rejected with 403."""
    token_member_a = adversarial_env["token_member_a"]
    appr_a = adversarial_env["appr_a_id"]

    res = client.post(
        f"/api/v1/approvals/{appr_a}/decision",
        json={"decision": "approved", "reason": "Unauthorized member decision"},
        headers={"Authorization": f"Bearer {token_member_a}"},
    )
    assert res.status_code == 403
    assert "Permission denied" in res.text


def test_approval_decision_maker_cannot_be_spoofed(client: TestClient, adversarial_env, db_session: Session):
    """Scenario 2.5: Client-supplied resolved_by_user_id is ignored; authenticated user is bound."""
    token_admin_a = adversarial_env["token_admin_a"]
    appr_a = adversarial_env["appr_a_id"]

    res = client.post(
        f"/api/v1/approvals/{appr_a}/decision",
        json={
            "decision": "approved",
            "reason": "Authorized admin approved",
            "resolved_by_user_id": "usr_spoofed_hacker",  # Spoofed user ID
        },
        headers={"Authorization": f"Bearer {token_admin_a}"},
    )
    assert res.status_code == 200

    # In database, resolved_by_user_id must match authenticated user, not spoofed payload
    appr_db = db_session.query(ApprovalModel).filter(ApprovalModel.id == appr_a).first()
    assert appr_db.status == "approved"
    assert appr_db.resolved_by_user_id == "usr_adv_alpha_admin"
    assert appr_db.resolved_by_user_id != "usr_spoofed_hacker"


def test_organization_context_spoofing_prevented(client: TestClient, adversarial_env, db_session: Session):
    """Scenario 2.6: Query param, header, and body attempts to spoof organization context are rejected."""
    token_admin_a = adversarial_env["token_admin_a"]

    # 1. Query parameter spoofing
    res_query = client.get(
        "/api/v1/tasks?organization_id=org_adv_beta",
        headers={"Authorization": f"Bearer {token_admin_a}"},
    )
    assert res_query.status_code == 403
    assert "Forbidden" in res_query.text

    # 2. Header spoofing
    res_hdr = client.get(
        "/api/v1/tasks",
        headers={
            "Authorization": f"Bearer {token_admin_a}",
            "X-Organization-Id": "org_adv_beta",
        },
    )
    assert res_hdr.status_code == 403
    assert "Forbidden" in res_hdr.text

    # 3. Request body spoofing: Task creation attempts to inject organization_id="org_adv_beta"
    res_post = client.post(
        "/api/v1/tasks",
        json={
            "title": "Alpha Created Task",
            "description": "Task creation with spoofed org body",
            "assigned_agent_id": "agt_adv_alpha",
            "organization_id": "org_adv_beta",  # Client attempts to assign to Beta
        },
        headers={"Authorization": f"Bearer {token_admin_a}"},
    )
    assert res_post.status_code == 201
    created_task_id = res_post.json()["id"]

    # Verify task in DB is strictly assigned to authenticated org_adv_alpha
    created_db = db_session.query(TaskModel).filter(TaskModel.id == created_task_id).first()
    assert created_db.organization_id == "org_adv_alpha"
    assert created_db.organization_id != "org_adv_beta"


def test_unauthorized_requests_do_not_leak_protected_metadata(client: TestClient, adversarial_env):
    """Scenario 2.6: Verify 404/403 responses return standardized errors without disclosing sensitive metadata."""
    token_a = adversarial_env["token_admin_a"]

    # Test nonexistent vs foreign ID return identical 404 structure
    res_foreign = client.get(
        f"/api/v1/agents/{adversarial_env['agent_b_id']}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    res_nonexistent = client.get(
        "/api/v1/agents/agt_nonexistent_random_id",
        headers={"Authorization": f"Bearer {token_a}"},
    )

    assert res_foreign.status_code == 404
    assert res_nonexistent.status_code == 404
    assert res_foreign.json().get("error", {}).get("code") == "AGENT_NOT_FOUND"
    assert res_nonexistent.json().get("error", {}).get("code") == "AGENT_NOT_FOUND"
