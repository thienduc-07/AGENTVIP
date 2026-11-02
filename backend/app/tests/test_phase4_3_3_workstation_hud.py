import uuid
from datetime import datetime, timedelta
import pytest
from backend.app.models.agent import AgentModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.models.task import TaskModel
from backend.app.models.task_step import TaskStepModel
from backend.app.models.approval import ApprovalModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.models.auth import OrganizationModel, UserModel, OrganizationMemberModel
from backend.app.core.auth import create_jwt_token, hash_password

DEFAULT_ORG = "org_default_company"


def test_agent_workstation_inspection_idle(auth_client, db_session):
    """Test retrieving HUD inspection data for an idle agent with assigned workstation."""
    agent_id = f"ag-idle-{uuid.uuid4().hex[:6]}"
    ws_id = f"ws-desk-{uuid.uuid4().hex[:6]}"

    agent = AgentModel(
        id=agent_id,
        name="Alex Engineer",
        role="Senior Backend Engineer",
        description="Core systems specialist",
        status="idle",
        behavioral_state="IDLE",
        station="engineering_bay",
        organization_id=DEFAULT_ORG,
        pos_x=-14.0,
        pos_y=1.0,
        pos_z=-4.0,
    )
    alloc = WorkstationAllocationModel(
        id=f"alloc-{uuid.uuid4().hex[:6]}",
        organization_id=DEFAULT_ORG,
        agent_id=agent.id,
        department="Engineering",
        logical_workstation_id=ws_id,
        office_zone="engineering_bay",
        desk_number=1,
        pos_x=-14.0,
        pos_y=1.0,
        pos_z=-4.0,
        allocation_status="ASSIGNED",
        is_virtual=False,
    )
    db_session.add(agent)
    db_session.add(alloc)
    db_session.commit()

    resp = auth_client.get(f"/api/v1/agents/{agent_id}/inspection")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["agent_id"] == agent_id
    assert data["name"] == "Alex Engineer"
    assert data["role"] == "Senior Backend Engineer"
    assert data["department"] == "Engineering"
    assert data["status"] == "IDLE"
    assert data["is_available"] is True
    assert data["workstation"] is not None
    assert data["workstation"]["logical_workstation_id"] == ws_id
    assert data["workstation"]["desk_number"] == 1
    assert data["current_task"] is None
    assert data["current_task_steps_count"] == 0
    assert len(data["pending_approvals"]) == 0


def test_agent_inspection_active_task_and_duration(auth_client, db_session):
    """Test retrieving HUD inspection data for a working agent with task, duration, and steps."""
    agent_id = f"ag-work-{uuid.uuid4().hex[:6]}"
    task_id = f"t-act-{uuid.uuid4().hex[:6]}"

    start_time = datetime.utcnow() - timedelta(minutes=5)

    agent = AgentModel(
        id=agent_id,
        name="Rachel Researcher",
        role="AI Scientist",
        status="working",
        behavioral_state="WORKING",
        current_task_id=task_id,
        station="research_lab",
        organization_id=DEFAULT_ORG,
    )
    task = TaskModel(
        id=task_id,
        title="Synthesize Research Report",
        description="Comprehensive literature review",
        status="running",
        priority="high",
        assigned_agent_id=agent_id,
        organization_id=DEFAULT_ORG,
        started_at=start_time,
    )
    step1 = TaskStepModel(
        id=f"step-1-{uuid.uuid4().hex[:6]}",
        task_id=task_id,
        step_index=0,
        title="Literature search",
        status="completed",
    )
    step2 = TaskStepModel(
        id=f"step-2-{uuid.uuid4().hex[:6]}",
        task_id=task_id,
        step_index=1,
        title="Draft outline",
        status="running",
    )
    ev = AgentEventModel(
        id=f"ev-{uuid.uuid4().hex[:6]}",
        event_type="agent.task_assigned",
        agent_id=agent_id,
        task_id=task_id,
        organization_id=DEFAULT_ORG,
        payload_json={"title": task.title},
    )

    db_session.add(agent)
    db_session.add(task)
    db_session.add(step1)
    db_session.add(step2)
    db_session.add(ev)
    db_session.commit()

    resp = auth_client.get(f"/api/v1/agents/{agent_id}/inspection")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["status"] == "WORKING"
    assert data["is_available"] is False
    assert data["current_task"] is not None
    assert data["current_task"]["id"] == task_id
    assert data["current_task_steps_count"] == 2
    assert data["current_task_duration_seconds"] is not None
    assert data["current_task_duration_seconds"] >= 290  # ~300 seconds
    assert len(data["recent_events"]) >= 1
    assert data["recent_events"][0]["event_type"] == "agent.task_assigned"


def test_agent_inspection_waiting_approval_and_pending_approvals(auth_client, db_session):
    """Test HUD reflects WAITING_APPROVAL status and exposes pending approval list."""
    agent_id = f"ag-appr-{uuid.uuid4().hex[:6]}"
    task_id = f"t-appr-{uuid.uuid4().hex[:6]}"

    agent = AgentModel(
        id=agent_id,
        name="Dan Deployer",
        role="DevOps Lead",
        status="waiting_approval",
        behavioral_state="WAITING",
        current_task_id=task_id,
        organization_id=DEFAULT_ORG,
    )
    task = TaskModel(
        id=task_id,
        title="Deploy to Production Cluster",
        description="Rolling update of k8s cluster",
        status="waiting_approval",
        assigned_agent_id=agent_id,
        organization_id=DEFAULT_ORG,
        started_at=datetime.utcnow() - timedelta(minutes=2),
    )
    approval = ApprovalModel(
        id=f"appr-{uuid.uuid4().hex[:6]}",
        task_id=task_id,
        action_type="execute_command_deploy",
        description="Production cluster upgrade requires confirmation",
        status="pending",
    )

    db_session.add(agent)
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    resp = auth_client.get(f"/api/v1/agents/{agent_id}/inspection")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["status"] == "WAITING_APPROVAL"
    assert len(data["pending_approvals"]) == 1
    assert data["pending_approvals"][0]["id"] == approval.id
    assert data["pending_approvals"][0]["action_type"] == "execute_command_deploy"


def test_agent_inspection_paused_task(auth_client, db_session):
    """Test HUD reflects PAUSED status when the active task is paused."""
    agent_id = f"ag-pause-{uuid.uuid4().hex[:6]}"
    task_id = f"t-pause-{uuid.uuid4().hex[:6]}"

    agent = AgentModel(
        id=agent_id,
        name="Paula Planner",
        role="Operations Coordinator",
        status="working",
        behavioral_state="WORKING",
        current_task_id=task_id,
        organization_id=DEFAULT_ORG,
    )
    task = TaskModel(
        id=task_id,
        title="Reorganize Inventory",
        description="Full inventory rebalance",
        status="paused",
        assigned_agent_id=agent_id,
        organization_id=DEFAULT_ORG,
        started_at=datetime.utcnow() - timedelta(minutes=10),
    )

    db_session.add(agent)
    db_session.add(task)
    db_session.commit()

    resp = auth_client.get(f"/api/v1/agents/{agent_id}/inspection")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["status"] == "PAUSED"
    assert data["is_available"] is False
    assert data["current_task"]["status"] == "paused"


def test_agent_inspection_tenant_isolation(auth_client, client, db_session):
    """Cross-tenant inspection requests must be denied with 404."""
    org_b = OrganizationModel(
        id="org_corp_beta",
        name="Beta Corp",
        slug="beta-corp",
        is_active=True,
    )
    db_session.add(org_b)
    db_session.flush()

    agent_id = f"ag-b-{uuid.uuid4().hex[:6]}"
    agent = AgentModel(
        id=agent_id,
        name="Beta Spy",
        role="Beta Agent",
        status="idle",
        organization_id=org_b.id,  # Belongs to ORG_B
    )
    db_session.add(agent)
    db_session.commit()

    # auth_client belongs to org_default_company
    resp = auth_client.get(f"/api/v1/agents/{agent_id}/inspection")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "AGENT_NOT_FOUND"


def test_workstation_inspection_occupied(auth_client, db_session):
    """Inspecting an occupied workstation returns workstation metadata and occupant inspection."""
    agent_id = f"ag-occ-{uuid.uuid4().hex[:6]}"
    ws_id = f"ws-occ-{uuid.uuid4().hex[:6]}"

    agent = AgentModel(
        id=agent_id,
        name="Charlie Chief",
        role="Marketing Director",
        status="idle",
        organization_id=DEFAULT_ORG,
    )
    alloc = WorkstationAllocationModel(
        id=f"alloc-{uuid.uuid4().hex[:6]}",
        organization_id=DEFAULT_ORG,
        agent_id=agent_id,
        department="Marketing",
        logical_workstation_id=ws_id,
        office_zone="marketing_studio",
        desk_number=3,
        pos_x=-14.0,
        pos_y=1.0,
        pos_z=10.0,
        allocation_status="ASSIGNED",
        is_virtual=False,
    )
    db_session.add(agent)
    db_session.add(alloc)
    db_session.commit()

    resp = auth_client.get(f"/api/v1/workstations/{ws_id}/inspection")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["workstation_id"] == ws_id
    assert data["department"] == "Marketing"
    assert data["is_occupied"] is True
    assert data["agent"] is not None
    assert data["agent"]["agent_id"] == agent_id
    assert data["agent"]["name"] == "Charlie Chief"


def test_workstation_inspection_unoccupied_does_not_fabricate_agent(auth_client, db_session):
    """Inspecting an unoccupied/unassigned workstation must NOT fabricate an agent."""
    ws_id = f"ws-vacant-{uuid.uuid4().hex[:6]}"

    dummy_agent = AgentModel(
        id=f"ag-released-{uuid.uuid4().hex[:6]}",
        name="Released Agent",
        role="Ex-Finance",
        status="offline",
        organization_id=DEFAULT_ORG,
    )
    db_session.add(dummy_agent)
    db_session.flush()

    alloc = WorkstationAllocationModel(
        id=f"alloc-{uuid.uuid4().hex[:6]}",
        organization_id=DEFAULT_ORG,
        agent_id=dummy_agent.id,
        department="Finance",
        logical_workstation_id=ws_id,
        office_zone="finance_office",
        desk_number=5,
        pos_x=6.0,
        pos_y=1.0,
        pos_z=20.0,
        allocation_status="UNASSIGNED",
        is_virtual=False,
    )
    db_session.add(alloc)
    db_session.commit()

    resp = auth_client.get(f"/api/v1/workstations/{ws_id}/inspection")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["workstation_id"] == ws_id
    assert data["is_occupied"] is False
    assert data["agent"] is None


def test_workstation_inspection_tenant_isolation(auth_client, db_session):
    """Cross-tenant workstation inspection must be rejected with 404."""
    org_b = OrganizationModel(
        id="org_corp_gamma",
        name="Gamma Corp",
        slug="gamma-corp",
        is_active=True,
    )
    db_session.add(org_b)
    db_session.flush()

    ws_id = f"ws-gamma-{uuid.uuid4().hex[:6]}"
    agent_b = AgentModel(
        id=f"ag-g-desk-{uuid.uuid4().hex[:6]}",
        name="Gamma Worker",
        role="Worker",
        organization_id=org_b.id,
    )
    db_session.add(agent_b)
    db_session.flush()

    alloc = WorkstationAllocationModel(
        id=f"alloc-g-{uuid.uuid4().hex[:6]}",
        organization_id=org_b.id,
        agent_id=agent_b.id,
        department="Engineering",
        logical_workstation_id=ws_id,
        office_zone="engineering_bay",
        allocation_status="ASSIGNED",
    )
    db_session.add(alloc)
    db_session.commit()

    # auth_client belongs to org_default_company
    resp = auth_client.get(f"/api/v1/workstations/{ws_id}/inspection")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "WORKSTATION_NOT_FOUND"


def test_hud_action_pause_and_resume_task(auth_client, db_session):
    """Verify that HUD pause and resume actions execute authoritatively via backend endpoints."""
    agent_id = f"ag-ctrl-{uuid.uuid4().hex[:6]}"
    task_id = f"t-ctrl-{uuid.uuid4().hex[:6]}"

    agent = AgentModel(
        id=agent_id,
        name="Controller Agent",
        role="Control Specialist",
        status="working",
        organization_id=DEFAULT_ORG,
    )
    task = TaskModel(
        id=task_id,
        title="Control Workflow Task",
        description="Testing pause and resume via HUD",
        status="running",
        assigned_agent_id=agent_id,
        organization_id=DEFAULT_ORG,
        started_at=datetime.utcnow() - timedelta(minutes=1),
    )
    db_session.add(agent)
    db_session.add(task)
    db_session.commit()

    # 1. Action: Pause Task
    pause_resp = auth_client.post(
        f"/api/v1/tasks/{task_id}/pause",
        json={"reason": "Paused by operator from 3D HUD"},
    )
    assert pause_resp.status_code == 200, pause_resp.text
    assert pause_resp.json()["is_paused"] is True
    assert pause_resp.json()["status"] == "paused"

    # Verify inspection reflects paused state
    insp1 = auth_client.get(f"/api/v1/agents/{agent_id}/inspection").json()
    assert insp1["status"] == "PAUSED"
    assert insp1["current_task"]["status"] == "paused"

    # 2. Action: Resume Task
    resume_resp = auth_client.post(
        f"/api/v1/tasks/{task_id}/resume",
        json={"guidance": "Resume execution from 3D HUD"},
    )
    assert resume_resp.status_code == 200, resume_resp.text
    assert resume_resp.json()["status"] in ("queued", "running")

    # Verify inspection reflects resumed state
    insp2 = auth_client.get(f"/api/v1/agents/{agent_id}/inspection").json()
    assert insp2["status"] in ("IDLE", "WORKING")


def test_hud_action_approval_decision_auto_resumes_task(auth_client, db_session):
    """Verify that approving a pending approval from HUD auto-resumes the task (Phase 4.3.2 invariant)."""
    agent_id = f"ag-appr-act-{uuid.uuid4().hex[:6]}"
    task_id = f"t-appr-act-{uuid.uuid4().hex[:6]}"
    appr_id = f"appr-act-{uuid.uuid4().hex[:6]}"

    agent = AgentModel(
        id=agent_id,
        name="Auto-Resume Agent",
        role="Release Engineer",
        status="waiting_approval",
        organization_id=DEFAULT_ORG,
    )
    task = TaskModel(
        id=task_id,
        title="Release v4.3.3",
        description="Requires operator approval to release",
        status="waiting_approval",
        assigned_agent_id=agent_id,
        organization_id=DEFAULT_ORG,
    )
    approval = ApprovalModel(
        id=appr_id,
        task_id=task_id,
        action_type="deploy_release",
        description="Release approval required",
        status="pending",
    )
    db_session.add(agent)
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    # Action: Decide Approval (Approve)
    decide_resp = auth_client.post(
        f"/api/v1/approvals/{appr_id}/decide",
        json={"decision": "approved", "reason": "Operator approved release via HUD"},
    )
    assert decide_resp.status_code == 200, decide_resp.text
    assert decide_resp.json()["status"] == "approved"

    # Verify task transitioned to queued for dispatcher execution
    db_session.refresh(task)
    assert task.status == "queued"

    # Verify inspection no longer has pending approvals
    insp = auth_client.get(f"/api/v1/agents/{agent_id}/inspection").json()
    assert len(insp["pending_approvals"]) == 0
