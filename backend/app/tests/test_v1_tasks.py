import pytest

def test_create_task_success(auth_client, seed_test_agent):
    payload = {
        "title": "Analyze Island Defenses",
        "description": "Inspect perimeter sensors and armory stock",
        "assigned_agent_id": seed_test_agent.id,
        "priority": "high"
    }
    response = auth_client.post("/api/v1/tasks", json=payload)
    assert response.status_code == 201
    task = response.json()
    assert task["title"] == payload["title"]
    assert task["description"] == payload["description"]
    assert task["assigned_agent_id"] == seed_test_agent.id
    assert task["status"] == "queued"
    assert task["priority"] == "high"
    # Verify task is NOT completed immediately
    assert task["completed_at"] is None
    assert task["started_at"] is None

def test_create_task_invalid_agent_rejected(auth_client):
    payload = {
        "title": "Invalid Mission",
        "description": "Attempt task with ghost agent",
        "assigned_agent_id": "non-existent-agent-id",
        "priority": "normal"
    }
    response = auth_client.post("/api/v1/tasks", json=payload)
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "AGENT_NOT_FOUND"

def test_create_task_validation_empty_title(auth_client, seed_test_agent):
    payload = {
        "title": "   ",
        "description": "Valid description",
        "assigned_agent_id": seed_test_agent.id
    }
    response = auth_client.post("/api/v1/tasks", json=payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] in ["EMPTY_TASK_TITLE", "VALIDATION_ERROR"]

def test_create_task_validation_title_too_long(auth_client, seed_test_agent):
    payload = {
        "title": "X" * 150,  # Max is 120
        "description": "Valid description",
        "assigned_agent_id": seed_test_agent.id
    }
    response = auth_client.post("/api/v1/tasks", json=payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"

def test_get_task_by_id(auth_client, seed_test_agent):
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Fetch Task Test",
        "description": "Detail description",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    response = auth_client.get(f"/api/v1/tasks/{task_id}")
    assert response.status_code == 200
    assert response.json()["id"] == task_id

def test_get_task_not_found(auth_client):
    response = auth_client.get("/api/v1/tasks/ghost-task-id")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "TASK_NOT_FOUND"

def test_list_tasks_filter_by_agent_and_status(auth_client, seed_test_agent):
    auth_client.post("/api/v1/tasks", json={
        "title": "Agent Task 1",
        "description": "Description 1",
        "assigned_agent_id": seed_test_agent.id
    })

    # Filter by agent
    res = auth_client.get(f"/api/v1/tasks?agent_id={seed_test_agent.id}")
    assert res.status_code == 200
    tasks = res.json()
    assert len(tasks) >= 1
    assert all(t["assigned_agent_id"] == seed_test_agent.id for t in tasks)

    # Filter by status
    res = auth_client.get("/api/v1/tasks?status=queued")
    assert res.status_code == 200
    tasks = res.json()
    assert all(t["status"] == "queued" for t in tasks)

def test_cancel_queued_task(auth_client, seed_test_agent):
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Task to Cancel",
        "description": "This will be cancelled",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    cancel_res = auth_client.post(f"/api/v1/tasks/{task_id}/cancel")
    assert cancel_res.status_code == 200
    data = cancel_res.json()
    assert data["id"] == task_id
    assert data["status"] == "cancelled"

    # Verify task state in database
    get_res = auth_client.get(f"/api/v1/tasks/{task_id}")
    assert get_res.json()["status"] == "cancelled"

def test_cancel_already_cancelled_task_conflict(auth_client, seed_test_agent):
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Cancel Twice Test",
        "description": "Test double cancel guard",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    # First cancel
    auth_client.post(f"/api/v1/tasks/{task_id}/cancel")

    # Second cancel must return 409 Conflict
    cancel_res2 = auth_client.post(f"/api/v1/tasks/{task_id}/cancel")
    assert cancel_res2.status_code == 409
    error = cancel_res2.json()["error"]
    assert error["code"] == "TASK_ALREADY_CANCELLED"
