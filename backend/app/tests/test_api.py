import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["database"] == "connected"

def test_get_agents_list():
    response = client.get("/api/v1/agents")
    assert response.status_code == 200
    agents = response.json()
    assert len(agents) >= 4
    agent_ids = {a["id"] for a in agents}
    assert "agent-exec-ceo" in agent_ids
    assert "agent-eng-lead" in agent_ids
    assert "agent-research-ai" in agent_ids
    assert "agent-mkt-growth" in agent_ids

def test_get_tools_catalog():
    response = client.get("/api/system/tools")
    assert response.status_code == 200
    tools = response.json()
    tool_names = [t["name"] for t in tools]
    assert "system_status" in tool_names
    assert "python_exec" in tool_names
    assert "calculator" in tool_names
    
    # Verify risk classifications
    python_tool = next(t for t in tools if t["name"] == "python_exec")
    assert python_tool["risk_level"] == "HIGH"
    assert python_tool["risk_reason"] is not None

def test_create_and_cancel_task_v1():
    # Dispatch a safe task
    response = client.post("/api/v1/tasks", json={
        "title": "Check system metrics",
        "description": "Inspect CPU, memory and disk free space",
        "assigned_agent_id": "agent-eng-lead",
        "priority": "normal"
    })
    assert response.status_code == 201
    task_data = response.json()
    assert task_data["id"] is not None
    assert task_data["status"] == "queued"
    assert task_data["assigned_agent_id"] == "agent-eng-lead"

    # Cancel task
    cancel_res = client.post(f"/api/v1/tasks/{task_data['id']}/cancel")
    assert cancel_res.status_code == 200
    assert cancel_res.json()["status"] == "cancelled"
