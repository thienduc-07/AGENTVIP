import pytest
import asyncio
from backend.app.models.task import TaskModel
from backend.app.agent_runtime.dispatcher.dispatcher import task_dispatcher

@pytest.mark.asyncio
async def test_end_to_end_runtime_flow(auth_client, db_session, seed_test_agent):
    # 1. Create a task via API
    payload = {
        "title": "Analyze Project Structure and Write Report",
        "description": "Scan workspace files, compile architecture report, and verify artifact",
        "assigned_agent_id": seed_test_agent.id,
        "priority": "high"
    }
    create_response = auth_client.post("/api/v1/tasks", json=payload)
    assert create_response.status_code == 201
    task_id = create_response.json()["id"]
    assert create_response.json()["status"] == "queued"

    # 2. Process task through the Dispatcher and ExecutionLoop
    # Dispatcher claims task, generates plan, calls real tools (workspace_list, workspace_write, verification_tool)
    await task_dispatcher._process_task(task_id, db=db_session)

    # 3. Verify task outcome via API GET /api/v1/tasks/{id}
    get_res = auth_client.get(f"/api/v1/tasks/{task_id}")
    assert get_res.status_code == 200
    task_data = get_res.json()

    assert task_data["status"] == "completed"
    assert task_data["result_summary"] is not None
    assert "xác minh" in task_data["result_summary"].lower() or "verified" in task_data["result_summary"].lower() or "hoàn thành" in task_data["result_summary"].lower()
    assert task_data["completed_at"] is not None

    # 4. Verify Task Steps via API GET /api/v1/tasks/{id}/steps
    steps_res = auth_client.get(f"/api/v1/tasks/{task_id}/steps")
    assert steps_res.status_code == 200
    steps = steps_res.json()
    assert len(steps) >= 2
    assert all(s["status"] == "completed" for s in steps)

    # 5. Verify Audit Events via API GET /api/v1/tasks/{id}/events
    events_res = auth_client.get(f"/api/v1/tasks/{task_id}/events")
    assert events_res.status_code == 200
    events = events_res.json()
    event_types = [e["event_type"] for e in events]
    assert "task.created" in event_types
    assert "task.plan_created" in event_types
    assert "task.completed" in event_types
