import asyncio
import pytest
from datetime import datetime
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.core.database import SessionLocal
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.orchestrator.multi_agent_orchestrator import multi_agent_orchestrator
from backend.app.services.workflow_service import workflow_service
from backend.app.schemas.workflow import WorkflowCreate

@pytest.fixture
def db_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()

@pytest.fixture
def test_client():
    return TestClient(app)

def test_api_list_agent_registry(test_client):
    """Verifies GET /api/v1/agents/registry returns all active specialized agent definitions."""
    res = test_client.get("/api/v1/agents/registry")
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 5
    agent_types = [a["agent_type"] for a in data]
    assert "general" in agent_types
    assert "research" in agent_types
    assert "analyst" in agent_types
    assert "writer" in agent_types
    assert "reviewer" in agent_types

def test_api_get_specific_agent_registry(test_client):
    """Verifies GET /api/v1/agents/registry/{agent_type} returns accurate permissions and tool lists."""
    res = test_client.get("/api/v1/agents/registry/research")
    assert res.status_code == 200
    data = res.json()
    assert data["agent_type"] == "research"
    assert data["permission_level"] == 0
    assert "workspace_list" in data["allowed_tools"]
    assert "workspace_write" not in data["allowed_tools"]

    res_writer = test_client.get("/api/v1/agents/registry/writer")
    assert res_writer.status_code == 200
    assert res_writer.json()["permission_level"] == 1
    assert "workspace_write" in res_writer.json()["allowed_tools"]

def test_api_workflow_lifecycle_endpoints(test_client):
    """Verifies POST, GET, and cancellation of multi-agent workflows via REST API."""
    # 1. Create workflow
    create_res = test_client.post(
        "/api/v1/workflows",
        json={
            "title": "API Multi-Agent Telemetry Workflow",
            "description": "Analyze workspace telemetry and generate verified audit report",
            "assigned_agent_id": "agent-exec-ceo",
            "priority": "high",
        }
    )
    assert create_res.status_code == 201
    wf_data = create_res.json()
    wf_id = wf_data["id"]
    assert wf_data["task_type"] == "workflow"
    assert wf_data["status"] == "queued"

    # 2. Get workflow details
    get_res = test_client.get(f"/api/v1/workflows/{wf_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == wf_id

    # 3. List workflows
    list_res = test_client.get("/api/v1/workflows")
    assert list_res.status_code == 200
    ids = [w["id"] for w in list_res.json()]
    assert wf_id in ids

    # 4. Cancel workflow
    cancel_res = test_client.post(f"/api/v1/workflows/{wf_id}/cancel")
    assert cancel_res.status_code == 200
    assert cancel_res.json()["status"] == "cancelled"

@pytest.mark.asyncio
async def test_multi_agent_orchestrator_end_to_end_execution(db_session: Session):
    """
    Executes a complete Multi-Agent Workflow:
    - Task is decomposed into DAG subtasks (Research -> Writer -> Reviewer).
    - Subtasks are executed by their respective specialized agents.
    - Result contracts are passed downstream.
    - Final report is verified, and parent task is marked completed.
    """
    # 1. Create workflow in DB
    wf_dict = workflow_service.create_workflow(
        db=db_session,
        workflow_in=WorkflowCreate(
            title="Full Workspace Architecture & Security Audit",
            description="Inspect repository structure, synthesize findings into a markdown report, and verify compliance.",
            assigned_agent_id="agent-exec-ceo",
            priority="high",
        )
    )
    wf_id = wf_dict["id"]
    token = CancellationToken()

    # 2. Execute workflow through orchestrator
    await multi_agent_orchestrator.execute_workflow(task_id=wf_id, token=token, db=db_session)

    # 3. Verify Database state
    db_session.expire_all()
    parent = db_session.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert parent is not None
    assert parent.status == "completed"
    assert parent.result_summary is not None
    assert "Multi-Agent Workflow Execution Report" in parent.result_summary

    # Verify subtasks
    subtasks = db_session.query(TaskModel).filter(TaskModel.parent_task_id == wf_id).all()
    assert len(subtasks) >= 3
    
    subtask_agent_types = [st.agent_type for st in subtasks]
    assert "research" in subtask_agent_types
    assert "writer" in subtask_agent_types
    assert "reviewer" in subtask_agent_types

    for st in subtasks:
        assert st.status == "completed"
        assert st.output_data_json is not None
        assert st.completed_at is not None

    # Verify primary agent is restored to idle
    ceo = db_session.query(AgentModel).filter(AgentModel.id == "agent-exec-ceo").first()
    assert ceo.status == "idle"

@pytest.mark.asyncio
async def test_workflow_cancellation_propagation(db_session: Session):
    """Verifies that requesting cancellation marks workflow cancelled and halts execution."""
    wf_dict = workflow_service.create_workflow(
        db=db_session,
        workflow_in=WorkflowCreate(
            title="Cancelled Mission",
            description="This workflow should be cancelled immediately.",
            assigned_agent_id="agent-exec-ceo"
        )
    )
    wf_id = wf_dict["id"]
    token = CancellationToken()
    token.cancel() # Trigger pre-emptive cancellation

    await multi_agent_orchestrator.execute_workflow(task_id=wf_id, token=token, db=db_session)

    db_session.expire_all()
    parent = db_session.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert parent.status == "cancelled"
