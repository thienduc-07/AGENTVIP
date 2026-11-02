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
from backend.app.services.workstation_execution_service import workstation_execution_service

@pytest.fixture
def test_setup(db_session: Session):
    # Setup Tenant Org A
    org_a = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_term_alpha").first()
    if not org_a:
        org_a = OrganizationModel(id="org_term_alpha", name="Term Alpha Corp", slug="term-alpha-corp", is_active=True)
        db_session.add(org_a)

    # Setup Tenant Org B
    org_b = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_term_beta").first()
    if not org_b:
        org_b = OrganizationModel(id="org_term_beta", name="Term Beta Inc", slug="term-beta-inc", is_active=True)
        db_session.add(org_b)

    # Setup User A in Org A
    user_a = db_session.query(UserModel).filter(UserModel.id == "usr_term_alpha").first()
    if not user_a:
        user_a = UserModel(
            id="usr_term_alpha",
            email="alpha_operator@agency.ai",
            full_name="Alpha Operator",
            hashed_password="hashed_placeholder",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_a)

    # Setup User B in Org B
    user_b = db_session.query(UserModel).filter(UserModel.id == "usr_term_beta").first()
    if not user_b:
        user_b = UserModel(
            id="usr_term_beta",
            email="beta_operator@agency.ai",
            full_name="Beta Operator",
            hashed_password="hashed_placeholder",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_b)

    # Setup Memberships
    m_a = (
        db_session.query(OrganizationMemberModel)
        .filter(OrganizationMemberModel.user_id == "usr_term_alpha", OrganizationMemberModel.organization_id == "org_term_alpha")
        .first()
    )
    if not m_a:
        m_a = OrganizationMemberModel(
            id="mem_term_alpha",
            user_id="usr_term_alpha",
            organization_id="org_term_alpha",
            role="ORGANIZATION_ADMIN",
        )
        db_session.add(m_a)

    m_b = (
        db_session.query(OrganizationMemberModel)
        .filter(OrganizationMemberModel.user_id == "usr_term_beta", OrganizationMemberModel.organization_id == "org_term_beta")
        .first()
    )
    if not m_b:
        m_b = OrganizationMemberModel(
            id="mem_term_beta",
            user_id="usr_term_beta",
            organization_id="org_term_beta",
            role="ORGANIZATION_ADMIN",
        )
        db_session.add(m_b)

    db_session.commit()

    token_a = create_access_token(
        user_id="usr_term_alpha",
        email="alpha_operator@agency.ai",
        is_superadmin=False,
        token_version=1,
    )
    token_b = create_access_token(
        user_id="usr_term_beta",
        email="beta_operator@agency.ai",
        is_superadmin=False,
        token_version=1,
    )

    # Setup Agent in Org A
    agent_a = db_session.query(AgentModel).filter(AgentModel.id == "agt_term_01").first()
    if not agent_a:
        agent_a = AgentModel(
            id="agt_term_01",
            organization_id="org_term_alpha",
            name="Alex Dev",
            role="Backend Engineer",
            station="Engineering",
            status="active",
            behavioral_state="WORKING",
        )
        db_session.add(agent_a)

    # Setup Workstation for Agent in Org A
    alloc_a = db_session.query(WorkstationAllocationModel).filter(WorkstationAllocationModel.agent_id == "agt_term_01").first()
    if not alloc_a:
        alloc_a = WorkstationAllocationModel(
            id="ws_alloc_term_01",
            organization_id="org_term_alpha",
            agent_id="agt_term_01",
            department="Engineering",
            logical_workstation_id="ws-eng-term-01",
            office_zone="engineering_bay",
            desk_number=1,
            pos_x=-14.0,
            pos_y=1.0,
            pos_z=-4.0,
            allocation_status="ASSIGNED",
            is_virtual=False,
        )
        db_session.add(alloc_a)

    db_session.commit()

    return {
        "org_a": "org_term_alpha",
        "org_b": "org_term_beta",
        "token_a": token_a,
        "token_b": token_b,
        "agent_a": "agt_term_01",
    }

def test_workstation_execution_service_lifecycle(test_setup, db_session: Session):
    """Verify execution creation, terminal output streaming, tool tracking, and completion."""
    org_id = test_setup["org_a"]
    agent_id = test_setup["agent_a"]

    # 1. Start execution
    exec_record = workstation_execution_service.start_execution(
        db=db_session,
        agent_id=agent_id,
        organization_id=org_id,
        task_id=None,
    )
    assert exec_record.id.startswith("exec_")
    assert exec_record.status == "running"
    assert exec_record.total_lines >= 1  # includes initial [SYSTEM] message

    # 2. Append stdout and stderr terminal lines
    line1 = workstation_execution_service.append_terminal_line(
        db=db_session,
        execution_id=exec_record.id,
        stream="stdout",
        content="Initializing environment dependencies...",
        broadcast=False,
    )
    assert line1 is not None
    assert line1.line_number == 2
    assert line1.stream == "stdout"

    # Verify secret redaction in terminal output
    line2 = workstation_execution_service.append_terminal_line(
        db=db_session,
        execution_id=exec_record.id,
        stream="stdout",
        content="Connecting with token sk-live1234567890abcdef1234567890",
        broadcast=False,
    )
    assert "sk-live" not in line2.content  # Redacted
    assert "[REDACTED]" in line2.content or "***" in line2.content

    # 3. Record tool activity
    workstation_execution_service.record_tool_call_started(
        db=db_session,
        execution_id=exec_record.id,
        tool_name="git_cli",
        arguments={"cmd": "git status"},
    )
    workstation_execution_service.record_tool_call_completed(
        db=db_session,
        execution_id=exec_record.id,
        tool_name="git_cli",
        duration_ms=45,
        output_summary="Working tree clean",
    )

    # 4. Record file operation
    workstation_execution_service.record_file_operation(
        db=db_session,
        execution_id=exec_record.id,
        file_path="src/main.py",
        operation="WRITE",
        size_bytes=1024,
    )

    # 5. Complete execution
    completed_exec = workstation_execution_service.complete_execution(
        db=db_session,
        execution_id=exec_record.id,
        status="completed",
        summary="Build and verification succeeded",
        prompt_tokens=150,
        completion_tokens=50,
        total_tokens=200,
        estimated_cost_usd=0.002,
        tool_calls_count=1,
        files_count=1,
    )
    assert completed_exec.status == "completed"
    assert completed_exec.completed_at is not None
    assert completed_exec.total_tokens == 200

def test_workstation_api_inspection_and_terminal(test_setup, db_session: Session, client: TestClient):
    """Verify REST API routes for /api/v1/workstations/{agent_id} and terminal output."""
    token = test_setup["token_a"]
    agent_id = test_setup["agent_a"]
    org_id = test_setup["org_a"]

    # Start an execution to populate data
    exec_rec = workstation_execution_service.start_execution(
        db=db_session,
        agent_id=agent_id,
        organization_id=org_id,
    )
    workstation_execution_service.append_terminal_line(
        db=db_session,
        execution_id=exec_rec.id,
        stream="stdout",
        content="Running comprehensive integration verification.",
        broadcast=False,
    )

    # 1. GET /api/v1/workstations/{agent_id}
    res = client.get(f"/api/v1/workstations/{agent_id}", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["agent_id"] == agent_id
    assert data["agent_name"] == "Alex Dev"
    assert data["workstation"]["logical_workstation_id"] == "ws-eng-term-01"
    assert data["active_execution"]["id"] == exec_rec.id

    # 2. GET /api/v1/workstations/{agent_id}/executions
    res_execs = client.get(f"/api/v1/workstations/{agent_id}/executions", headers={"Authorization": f"Bearer {token}"})
    assert res_execs.status_code == 200
    execs_data = res_execs.json()
    assert execs_data["total"] >= 1
    assert any(e["id"] == exec_rec.id for e in execs_data["items"])

    # 3. GET /api/v1/workstations/{agent_id}/terminal
    res_term = client.get(f"/api/v1/workstations/{agent_id}/terminal", headers={"Authorization": f"Bearer {token}"})
    assert res_term.status_code == 200
    term_data = res_term.json()
    assert term_data["execution_id"] == exec_rec.id
    assert len(term_data["lines"]) >= 2

    # 4. GET /api/v1/executions/{execution_id}
    res_exec_detail = client.get(f"/api/v1/executions/{exec_rec.id}", headers={"Authorization": f"Bearer {token}"})
    assert res_exec_detail.status_code == 200
    detail_data = res_exec_detail.json()
    assert detail_data["id"] == exec_rec.id
    assert detail_data["organization_id"] == org_id

def test_workstation_multi_tenant_isolation(test_setup, db_session: Session, client: TestClient):
    """Verify that User B in Org B CANNOT inspect or access executions/terminal from Org A."""
    token_b = test_setup["token_b"]
    agent_id = test_setup["agent_a"]
    org_a = test_setup["org_a"]

    # Start an execution in Org A
    exec_rec = workstation_execution_service.start_execution(
        db=db_session,
        agent_id=agent_id,
        organization_id=org_a,
    )

    # 1. Tenant B attempting to query Org A's agent workstation
    res_ws = client.get(f"/api/v1/workstations/{agent_id}", headers={"Authorization": f"Bearer {token_b}"})
    assert res_ws.status_code == 404

    # 2. Tenant B attempting to query Org A's executions
    res_exec = client.get(f"/api/v1/workstations/{agent_id}/executions", headers={"Authorization": f"Bearer {token_b}"})
    assert res_exec.status_code == 404

    # 3. Tenant B attempting to query Org A's execution directly by ID
    res_direct = client.get(f"/api/v1/executions/{exec_rec.id}", headers={"Authorization": f"Bearer {token_b}"})
    assert res_direct.status_code == 404
