import json
import pytest
from datetime import datetime
from starlette.websockets import WebSocketDisconnect
from backend.app.services.event_service import (
    event_service,
    TASK_CREATED,
    TASK_STARTED,
    TASK_COMPLETED,
    AGENT_WORKING,
    AGENT_IDLE,
)
from backend.app.models.agent_event import AgentEventModel
from backend.app.websocket_manager import ws_manager

from backend.app.models.task import TaskModel

def test_event_envelope_serialization(db_session, seed_test_agent):
    """Test that event model produces an envelope matching Milestone 5 specification."""
    task = TaskModel(
        title="Envelope Task",
        description="Testing serialization",
        assigned_agent_id=seed_test_agent.id,
        priority="normal",
        status="queued"
    )
    db_session.add(task)
    db_session.commit()

    event = event_service.create_event(
        db=db_session,
        event_type=TASK_CREATED,
        agent_id=seed_test_agent.id,
        task_id=task.id,
        payload={"title": "Test Title", "priority": "high"},
        commit=True,
    )

    envelope = event.to_envelope()
    assert envelope["schema_version"] == 1
    assert envelope["event_id"] == event.id
    assert envelope["event_id"].startswith("evt_")
    assert envelope["event_type"] == TASK_CREATED
    assert envelope["agent_id"] == seed_test_agent.id
    assert envelope["task_id"] == task.id
    assert envelope["sequence_id"] is not None
    assert envelope["sequence_id"] >= 1
    assert envelope["payload"] == {"title": "Test Title", "priority": "high"}
    assert "Z" in envelope["occurred_at"]

def test_event_sequence_id_monotonicity(db_session, seed_test_agent):
    """Test that multiple events in database receive strictly increasing sequence IDs."""
    task = TaskModel(
        title="Seq Task",
        description="Testing monotonicity",
        assigned_agent_id=seed_test_agent.id,
        priority="normal",
        status="queued"
    )
    db_session.add(task)
    db_session.commit()

    ev1 = event_service.create_event(db_session, TASK_CREATED, seed_test_agent.id, task.id, commit=True)
    ev2 = event_service.create_event(db_session, TASK_STARTED, seed_test_agent.id, task.id, commit=True)
    ev3 = event_service.create_event(db_session, TASK_COMPLETED, seed_test_agent.id, task.id, commit=True)

    assert ev1.sequence_id < ev2.sequence_id < ev3.sequence_id
    assert ev2.sequence_id == ev1.sequence_id + 1
    assert ev3.sequence_id == ev2.sequence_id + 1

def test_websocket_initial_snapshot(auth_client):
    """Test that client connecting to /api/v1/events/ws receives initial snapshot."""
    with auth_client.websocket_connect(f"/api/v1/events/ws?token={auth_client.auth_token}") as websocket:
        initial_frame = websocket.receive_json()
        assert initial_frame["message_type"] == "snapshot"
        assert "snapshot_id" in initial_frame
        assert "generated_at" in initial_frame
        assert "last_sequence_id" in initial_frame
        assert "data" in initial_frame
        assert "agents" in initial_frame["data"]
        assert len(initial_frame["data"]["agents"]) > 0
        assert "active_tasks" in initial_frame["data"]

def test_websocket_ping_pong_heartbeat(auth_client):
    """Test ping message responds with pong."""
    with auth_client.websocket_connect(f"/api/v1/events/ws?token={auth_client.auth_token}") as websocket:
        _ = websocket.receive_json()  # Read initial snapshot

        websocket.send_json({"action": "ping", "timestamp": 123456789})
        response = websocket.receive_json()
        assert response["message_type"] == "pong"
        assert response["timestamp"] == 123456789

def test_websocket_resync_command(auth_client):
    """Test client can request a fresh snapshot via resync action."""
    with auth_client.websocket_connect(f"/api/v1/events/ws?token={auth_client.auth_token}") as websocket:
        _ = websocket.receive_json()  # Read initial snapshot

        websocket.send_json({"action": "resync"})
        resync_snapshot = websocket.receive_json()
        assert resync_snapshot["message_type"] == "snapshot"
        assert "snapshot_id" in resync_snapshot
        assert "data" in resync_snapshot

def test_websocket_replay_command(auth_client, db_session, seed_test_agent, monkeypatch):
    """Test that client can request missed events after last_sequence_id."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    # Insert test events
    task = TaskModel(
        title="Replay Task",
        description="Testing event replay",
        assigned_agent_id=seed_test_agent.id,
        priority="normal",
        status="queued"
    )
    db_session.add(task)
    db_session.commit()

    ev1 = event_service.create_event(db_session, TASK_CREATED, seed_test_agent.id, task.id, commit=True)
    ev2 = event_service.create_event(db_session, TASK_STARTED, seed_test_agent.id, task.id, commit=True)

    with auth_client.websocket_connect(f"/api/v1/events/ws?token={auth_client.auth_token}") as websocket:
        _ = websocket.receive_json()  # Snapshot

        # Request replay after sequence of ev1
        websocket.send_json({"action": "replay", "last_sequence_id": ev1.sequence_id})
        frame = websocket.receive_json()

        assert frame["message_type"] == "event"
        assert frame["event"]["event_id"] == ev2.id
        assert frame["event"]["sequence_id"] == ev2.sequence_id

def test_websocket_origin_check_allowed_and_rejected():
    """Test origin header filtering according to CORS rules."""
    assert ws_manager.is_origin_allowed("http://localhost:3000") is True
    assert ws_manager.is_origin_allowed("http://127.0.0.1:3000") is True
    assert ws_manager.is_origin_allowed(None) is True  # Allow non-browser CLI clients
    assert ws_manager.is_origin_allowed("http://malicious-unauthorized-site.com") is False

def test_websocket_oversized_payload_rejection(auth_client):
    """Test that incoming frames > 64KB are rejected."""
    with auth_client.websocket_connect(f"/api/v1/events/ws?token={auth_client.auth_token}") as websocket:
        _ = websocket.receive_json()  # Snapshot

        huge_payload = "a" * (70 * 1024)  # 70 KB
        websocket.send_text(huge_payload)
        response = websocket.receive_json()
        assert response.get("error") == "PAYLOAD_TOO_LARGE"
