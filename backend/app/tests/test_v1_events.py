import pytest

def test_task_creation_emits_event(auth_client, seed_test_agent):
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Event Test Task",
        "description": "Verify transactional event creation",
        "assigned_agent_id": seed_test_agent.id,
        "priority": "normal"
    })
    task_id = create_res.json()["id"]

    # Query events for task
    response = auth_client.get(f"/api/v1/tasks/{task_id}/events")
    assert response.status_code == 200
    events = response.json()
    assert len(events) >= 1
    created_event = events[0]
    assert created_event["event_type"] == "task.created"
    assert created_event["task_id"] == task_id
    assert created_event["agent_id"] == seed_test_agent.id
    assert created_event["payload_json"]["title"] == "Event Test Task"

def test_task_cancellation_emits_event(auth_client, seed_test_agent):
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Cancellation Event Test",
        "description": "Checking cancellation event audit trail",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    auth_client.post(f"/api/v1/tasks/{task_id}/cancel")

    response = auth_client.get(f"/api/v1/tasks/{task_id}/events")
    assert response.status_code == 200
    events = response.json()
    assert len(events) == 2
    assert events[0]["event_type"] == "task.created"
    assert events[1]["event_type"] == "task.cancelled"

def test_events_query_filtering(auth_client, seed_test_agent):
    create_res = auth_client.post("/api/v1/tasks", json={
        "title": "Filter Event Test",
        "description": "Query filtering by event_type",
        "assigned_agent_id": seed_test_agent.id
    })
    task_id = create_res.json()["id"]

    response = auth_client.get(f"/api/v1/events?event_type=task.created&agent_id={seed_test_agent.id}")
    assert response.status_code == 200
    events = response.json()
    assert len(events) >= 1
    assert all(e["event_type"] == "task.created" for e in events)
    assert all(e["agent_id"] == seed_test_agent.id for e in events)
