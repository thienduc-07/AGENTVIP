"""
PROVIPAGENT Phase 4.3.7: Multi-Tenant Security & Vulnerability Hardening Test Suite
Adversarial verification of cross-tenant isolation, authorization enforcement,
approval integrity, secret redaction, and path traversal protection.
"""
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.core.auth import create_access_token, PERM_DECIDE_APPROVAL
from backend.app.core.security_sanitizer import (
    redact_secrets,
    sanitize_terminal_text,
    sanitize_file_path,
)
from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.models.execution import ExecutionModel
from backend.app.models.approval import ApprovalModel
from backend.app.models.meeting import MeetingModel
from backend.app.services.workstation_execution_service import workstation_execution_service
from backend.app.services.approval_service import approval_service


@pytest.fixture
def adversarial_setup(db_session: Session):
    """
    Sets up two strictly isolated tenant organizations with users, agents,
    tasks, workstations, executions, approvals, and meetings.
    """
    # 1. Organization A
    org_a = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_adv_alpha").first()
    if not org_a:
        org_a = OrganizationModel(id="org_adv_alpha", name="Alpha Corp", slug="alpha-corp", is_active=True)
        db_session.add(org_a)

    # 2. Organization B
    org_b = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_adv_beta").first()
    if not org_b:
        org_b = OrganizationModel(id="org_adv_beta", name="Beta Inc", slug="beta-inc", is_active=True)
        db_session.add(org_b)

    # 3. Users in Org A:
    # - User Admin A (has PERM_DECIDE_APPROVAL)
    # - User Member A (regular member, NO PERM_DECIDE_APPROVAL)
    user_admin_a = db_session.query(UserModel).filter(UserModel.id == "usr_adv_alpha_admin").first()
    if not user_admin_a:
        user_admin_a = UserModel(
            id="usr_adv_alpha_admin",
            email="admin@alpha.corp",
            full_name="Admin Alpha",
            hashed_password="placeholder_hash",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_admin_a)

    user_member_a = db_session.query(UserModel).filter(UserModel.id == "usr_adv_alpha_member").first()
    if not user_member_a:
        user_member_a = UserModel(
            id="usr_adv_alpha_member",
            email="member@alpha.corp",
            full_name="Member Alpha",
            hashed_password="placeholder_hash",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_member_a)

    # 4. User in Org B:
    user_b = db_session.query(UserModel).filter(UserModel.id == "usr_adv_beta_admin").first()
    if not user_b:
        user_b = UserModel(
            id="usr_adv_beta_admin",
            email="admin@beta.inc",
            full_name="Admin Beta",
            hashed_password="placeholder_hash",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_b)

    # 5. Memberships
    m_admin_a = db_session.query(OrganizationMemberModel).filter(
        OrganizationMemberModel.user_id == "usr_adv_alpha_admin",
        OrganizationMemberModel.organization_id == "org_adv_alpha"
    ).first()
    if not m_admin_a:
        m_admin_a = OrganizationMemberModel(
            id="mem_adv_alpha_admin",
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
            id="mem_adv_alpha_member",
            user_id="usr_adv_alpha_member",
            organization_id="org_adv_alpha",
            role="ORGANIZATION_MEMBER",
        )
        db_session.add(m_member_a)

    m_b = db_session.query(OrganizationMemberModel).filter(
        OrganizationMemberModel.user_id == "usr_adv_beta_admin",
        OrganizationMemberModel.organization_id == "org_adv_beta"
    ).first()
    if not m_b:
        m_b = OrganizationMemberModel(
            id="mem_adv_beta_admin",
            user_id="usr_adv_beta_admin",
            organization_id="org_adv_beta",
            role="ORGANIZATION_ADMIN",
        )
        db_session.add(m_b)

    # 6. Agents
    agent_a = db_session.query(AgentModel).filter(AgentModel.id == "agt_adv_alpha").first()
    if not agent_a:
        agent_a = AgentModel(
            id="agt_adv_alpha",
            organization_id="org_adv_alpha",
            name="Alpha Agent",
            role="Security Analyst",
            station="Security",
            status="idle",
            behavioral_state="IDLE",
        )
        db_session.add(agent_a)

    agent_b = db_session.query(AgentModel).filter(AgentModel.id == "agt_adv_beta").first()
    if not agent_b:
        agent_b = AgentModel(
            id="agt_adv_beta",
            organization_id="org_adv_beta",
            name="Beta Agent",
            role="Operations Specialist",
            station="Operations",
            status="working",
            behavioral_state="WORKING",
        )
        db_session.add(agent_b)

    # 7. Workstations
    ws_b = db_session.query(WorkstationAllocationModel).filter(WorkstationAllocationModel.agent_id == "agt_adv_beta").first()
    if not ws_b:
        ws_b = WorkstationAllocationModel(
            id="ws_adv_beta",
            organization_id="org_adv_beta",
            agent_id="agt_adv_beta",
            department="Operations",
            logical_workstation_id="ws-ops-beta-01",
            office_zone="operations_bay",
            desk_number=1,
            pos_x=10.0,
            pos_y=1.0,
            pos_z=10.0,
            allocation_status="ASSIGNED",
            is_virtual=False,
        )
        db_session.add(ws_b)

    # 8. Tasks & Executions in Org B
    task_b = db_session.query(TaskModel).filter(TaskModel.id == "tsk_adv_beta").first()
    if not task_b:
        task_b = TaskModel(
            id="tsk_adv_beta",
            organization_id="org_adv_beta",
            assigned_agent_id="agt_adv_beta",
            title="Secret Beta Financial Task",
            description="Confidential data",
            status="waiting_approval",
            priority="urgent",
        )
        db_session.add(task_b)

    # 9. Approval in Org B
    appr_b = db_session.query(ApprovalModel).filter(ApprovalModel.task_id == "tsk_adv_beta").first()
    if not appr_b:
        appr_b = ApprovalModel(
            id="appr_adv_beta",
            task_id="tsk_adv_beta",
            action_type="deploy_ledger",
            description="Authorize deployment to financial ledger",
            status="pending",
        )
        db_session.add(appr_b)

    # 10. Meeting in Org B
    meeting_b = db_session.query(MeetingModel).filter(MeetingModel.id == "mtg_adv_beta").first()
    if not meeting_b:
        meeting_b = MeetingModel(
            id="mtg_adv_beta",
            organization_id="org_adv_beta",
            title="Beta Boardroom Strategy",
            meeting_type="STRATEGY",
            status="IN_PROGRESS",
        )
        db_session.add(meeting_b)

    db_session.commit()

    # 11. Create real execution & terminal lines in Org B
    exec_b = workstation_execution_service.start_execution(
        db=db_session,
        agent_id="agt_adv_beta",
        organization_id="org_adv_beta",
        task_id="tsk_adv_beta",
    )
    workstation_execution_service.append_terminal_line(
        db=db_session,
        execution_id=exec_b.id,
        stream="stdout",
        content="Confidential financial report: Q4 revenue $50M",
        broadcast=False,
    )

    # 12. Create tokens
    token_admin_a = create_access_token(
        user_id="usr_adv_alpha_admin",
        email="admin@alpha.corp",
        is_superadmin=False,
        token_version=1,
    )
    token_member_a = create_access_token(
        user_id="usr_adv_alpha_member",
        email="member@alpha.corp",
        is_superadmin=False,
        token_version=1,
    )
    token_b = create_access_token(
        user_id="usr_adv_beta_admin",
        email="admin@beta.inc",
        is_superadmin=False,
        token_version=1,
    )

    return {
        "org_a": "org_adv_alpha",
        "org_b": "org_adv_beta",
        "token_admin_a": token_admin_a,
        "token_member_a": token_member_a,
        "token_b": token_b,
        "agent_b": "agt_adv_beta",
        "ws_b": "ws-ops-beta-01",
        "exec_b_id": exec_b.id,
        "approval_b_id": "appr_adv_beta",
        "meeting_b_id": "mtg_adv_beta",
    }


# =============================================================================
# 1. CROSS-TENANT ADVERSARIAL API TESTS
# =============================================================================

def test_adversarial_user_a_cannot_read_agent_b(adversarial_setup, client: TestClient):
    """User in Org A must be rejected when attempting to inspect an Agent belonging to Org B."""
    token_a = adversarial_setup["token_admin_a"]
    agent_b = adversarial_setup["agent_b"]

    res = client.get(f"/api/v1/agents/{agent_b}", headers={"Authorization": f"Bearer {token_a}"})
    assert res.status_code == 404, "Cross-tenant agent inspection must be rejected with 404"


def test_adversarial_user_a_cannot_read_workstation_b(adversarial_setup, client: TestClient):
    """User in Org A must be rejected when attempting to inspect Workstation of Org B."""
    token_a = adversarial_setup["token_admin_a"]
    ws_b = adversarial_setup["ws_b"]

    res = client.get(f"/api/v1/workstations/{ws_b}", headers={"Authorization": f"Bearer {token_a}"})
    assert res.status_code == 404, "Cross-tenant workstation inspection must be rejected with 404"


def test_adversarial_user_a_cannot_read_execution_b(adversarial_setup, client: TestClient):
    """User in Org A must be rejected when attempting to read Execution details of Org B."""
    token_a = adversarial_setup["token_admin_a"]
    exec_b_id = adversarial_setup["exec_b_id"]

    res = client.get(f"/api/v1/executions/{exec_b_id}", headers={"Authorization": f"Bearer {token_a}"})
    assert res.status_code == 404, "Direct execution lookup for other tenant must return 404"
    assert "Confidential" not in res.text


def test_adversarial_user_a_cannot_read_terminal_b(adversarial_setup, client: TestClient):
    """User in Org A must be rejected when attempting to read Terminal output of Org B."""
    token_a = adversarial_setup["token_admin_a"]
    exec_b_id = adversarial_setup["exec_b_id"]

    res = client.get(f"/api/v1/executions/{exec_b_id}/terminal", headers={"Authorization": f"Bearer {token_a}"})
    assert res.status_code == 404, "Terminal output lookup for other tenant must return 404"
    assert "revenue" not in res.text


def test_adversarial_user_a_cannot_read_meeting_b(adversarial_setup, client: TestClient):
    """User in Org A must be rejected when attempting to read Meeting details of Org B."""
    token_a = adversarial_setup["token_admin_a"]
    meeting_b_id = adversarial_setup["meeting_b_id"]

    res = client.get(f"/api/v1/meetings/{meeting_b_id}", headers={"Authorization": f"Bearer {token_a}"})
    assert res.status_code == 404, "Meeting lookup for other tenant must return 404"


def test_adversarial_user_a_cannot_decide_approval_b(adversarial_setup, client: TestClient):
    """User in Org A cannot approve or reject an approval belonging to Org B."""
    token_a = adversarial_setup["token_admin_a"]
    appr_b_id = adversarial_setup["approval_b_id"]

    res = client.post(
        f"/api/v1/approvals/{appr_b_id}/decision",
        json={"decision": "approved", "reason": "Adversarial approval attempt"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res.status_code == 404, "Cross-tenant approval decision must return 404"


def test_adversarial_organization_id_spoofing_rejected(adversarial_setup, client: TestClient):
    """User in Org A cannot spoof X-Organization-Id header or query param to gain access to Org B."""
    token_a = adversarial_setup["token_admin_a"]
    org_b = adversarial_setup["org_b"]

    res_header = client.get(
        "/api/v1/agents",
        headers={"Authorization": f"Bearer {token_a}", "X-Organization-Id": org_b},
    )
    assert res_header.status_code == 403, "Forged X-Organization-Id header must be forbidden with 403"

    res_query = client.get(
        f"/api/v1/agents?organization_id={org_b}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res_query.status_code == 403, "Forged organization_id query parameter must be forbidden with 403"


# =============================================================================
# 2. APPROVAL WORKFLOW AUTHORIZATION & STATE INVARIANTS
# =============================================================================

def test_unauthorized_member_cannot_decide_approval(adversarial_setup, client: TestClient, db_session: Session):
    """A regular organization member (without DECIDE_APPROVAL permission) must be rejected with 403."""
    token_member_a = adversarial_setup["token_member_a"]

    # Create task & approval in Org A
    task_a = TaskModel(
        id="tsk_adv_alpha_appr",
        organization_id="org_adv_alpha",
        assigned_agent_id="agt_adv_alpha",
        title="High Risk Action",
        description="Deploying contract",
        status="waiting_approval",
        priority="urgent",
    )
    db_session.add(task_a)
    appr_a = ApprovalModel(
        id="appr_adv_alpha_1",
        task_id="tsk_adv_alpha_appr",
        action_type="deploy_smart_contract",
        description="Deploy contract to mainnet",
        status="pending",
    )
    db_session.add(appr_a)
    db_session.commit()

    # User Member A attempts to approve
    res = client.post(
        f"/api/v1/approvals/{appr_a.id}/decision",
        json={"decision": "approved", "reason": "Member trying to approve"},
        headers={"Authorization": f"Bearer {token_member_a}"},
    )
    assert res.status_code == 403, "Non-admin member without PERM_DECIDE_APPROVAL must be rejected with 403"
    assert "Permission denied" in res.text


def test_authorized_admin_decides_approval_and_records_user(adversarial_setup, client: TestClient, db_session: Session):
    """An authorized administrator can decide approval and resolved_by_user_id is recorded."""
    token_admin_a = adversarial_setup["token_admin_a"]

    task_a = TaskModel(
        id="tsk_adv_alpha_appr_2",
        organization_id="org_adv_alpha",
        assigned_agent_id="agt_adv_alpha",
        title="Admin Approved Action",
        description="Deploying infrastructure",
        status="waiting_approval",
        priority="urgent",
    )
    db_session.add(task_a)
    appr_a = ApprovalModel(
        id="appr_adv_alpha_2",
        task_id="tsk_adv_alpha_appr_2",
        action_type="deploy_infra",
        description="Deploy infrastructure",
        status="pending",
    )
    db_session.add(appr_a)
    db_session.commit()

    res = client.post(
        f"/api/v1/approvals/{appr_a.id}/decision",
        json={"decision": "approved", "reason": "Admin verified compliance"},
        headers={"Authorization": f"Bearer {token_admin_a}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "approved"
    assert data["resolved_by_user_id"] == "usr_adv_alpha_admin"

    # Invariant: Duplicate approval decision must be rejected (409 Conflict)
    res_dup = client.post(
        f"/api/v1/approvals/{appr_a.id}/decision",
        json={"decision": "rejected", "reason": "Second attempt"},
        headers={"Authorization": f"Bearer {token_admin_a}"},
    )
    assert res_dup.status_code == 409, "Resolving an already decided approval must yield 409 Conflict"


# =============================================================================
# 3. SECRET REDACTION & TERMINAL SANITIZATION
# =============================================================================

def test_secret_redaction_comprehensive():
    """Verify that all secret patterns are scrubbed completely."""
    # 1. Bearer token
    s1 = "Authorization: Bearer secret_token_xyz_12345"
    assert "secret_token" not in redact_secrets(s1)
    assert "Bearer [REDACTED]" in redact_secrets(s1)

    # 2. OpenAI and Groq keys
    s2 = "API call using sk-abc12345678901234 and gsk_groq9876543210"
    red2 = redact_secrets(s2)
    assert "abc12345678901234" not in red2
    assert "groq9876543210" not in red2
    assert "sk-[REDACTED]" in red2
    assert "gsk_[REDACTED]" in red2

    # 3. Database URL with password
    s3 = "Connected to postgresql://postgres:SuperSecretP@ssw0rd@db.internal:5432/agency"
    red3 = redact_secrets(s3)
    assert "SuperSecretP@ssw0rd" not in red3
    assert "postgresql://postgres:[REDACTED]@db.internal:5432/agency" in red3

    # 4. Private Key Block
    s4 = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAz9x...\n-----END RSA PRIVATE KEY-----"
    red4 = redact_secrets(s4)
    assert "MIIEowIBAAKCAQEAz9x" not in red4
    assert "[REDACTED_PRIVATE_KEY]" in red4

    # 5. AWS Key
    s5 = "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"
    red5 = redact_secrets(s5)
    assert "AKIAIOSFODNN7EXAMPLE" not in red5
    assert "AKIA[REDACTED]" in red5


def test_terminal_text_sanitization_defense():
    """Verify OSC escape sequences, control characters, and HTML script tags are suppressed."""
    # 1. OSC injection attempt (e.g. terminal title change or command injection)
    raw_osc = "Normal output \x1b]0;hacked_title\x07More text"
    clean_osc = sanitize_terminal_text(raw_osc)
    assert "\x1b]0;" not in clean_osc
    assert "hacked_title" not in clean_osc
    assert "Normal output More text" in clean_osc

    # 2. Dangerous HTML script tag injection
    raw_html = 'Step 1: <script>alert("XSS")</script> processed'
    clean_html = sanitize_terminal_text(raw_html)
    assert "<script>" not in clean_html
    assert 'alert("XSS")' not in clean_html
    assert "[SANITIZED_TAG]" in clean_html

    # 3. Payload length bounding
    massive_output = "A" * 6000
    bounded = sanitize_terminal_text(massive_output, max_length=4000)
    assert len(bounded) <= 4050
    assert "[TRUNCATED]" in bounded


# =============================================================================
# 4. FILE PATH TRAVERSAL SANITIZATION
# =============================================================================

def test_file_path_traversal_sanitization():
    """Verify directory traversal attempts and host user paths are sanitized."""
    # 1. Directory traversal
    p1 = "../../etc/passwd"
    clean1 = sanitize_file_path(p1)
    assert ".." not in clean1
    assert "[TRAVERSAL_PREVENTED]/etc/passwd" in clean1

    # 2. Windows traversal
    p2 = "..\\..\\windows\\system32\\cmd.exe"
    clean2 = sanitize_file_path(p2)
    assert ".." not in clean2
    assert "[TRAVERSAL_PREVENTED]" in clean2

    # 3. Redaction of user home path
    p3 = "/Users/thienduc/Desktop/Code/provipagent/src/index.ts"
    clean3 = sanitize_file_path(p3)
    assert "/Users/thienduc/" not in clean3
    assert "~/Desktop/Code/provipagent/src/index.ts" == clean3

    # 4. Null byte injection
    p4 = "safe_file.txt\x00.exe"
    clean4 = sanitize_file_path(p4)
    assert "\x00" not in clean4
    assert clean4 == "safe_file.txt.exe"
