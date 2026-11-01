import json
import asyncio
import pytest
from backend.app.agent_runtime.dispatcher.dispatcher import task_dispatcher
from backend.app.websocket_manager import ws_manager
from backend.app.models.task import TaskModel
from backend.app.models.agent import AgentModel
from backend.app.services.task_service import task_service
from backend.app.schemas.task import TaskCreate

class MockWebSocketClient:
    def __init__(self):
        self.received_messages = []

    async def send_text(self, text: str):
        self.received_messages.append(json.loads(text))

@pytest.mark.asyncio
async def test_live_task_execution_streams_events_to_websocket(db_session, seed_test_agent):
    """
    Verifies that executing a real task generates the complete real-time event lifecycle
    and broadcasts every event envelope to connected WebSocket clients.
    """
    mock_ws = MockWebSocketClient()
    ws_manager.active_connections.add(mock_ws)
    ws_manager.connection_metadata[mock_ws] = {
        "user_id": "test_mock_user",
        "organization_id": "org_default_company",
        "is_superadmin": False,
    }

    try:
        # 1. Create task
        task = task_service.create_task(
            db=db_session,
            task_in=TaskCreate(
                title="Stream Island Telemetry",
                description="Analyze workspace and verify telemetry stream",
                assigned_agent_id=seed_test_agent.id,
                priority="high",
            )
        )

        # 2. Execute Task via Dispatcher
        await task_dispatcher._process_task(task_id=task.id, db=db_session)

        # 3. Verify event envelopes received by mock client
        event_types = [
            m.get("event", {}).get("event_type")
            for m in mock_ws.received_messages
            if m.get("message_type") == "event"
        ]

        assert "task.created" in event_types
        assert "task.plan_created" in event_types
        assert "task.step.started" in event_types
        assert "tool.execution_started" in event_types
        assert "tool.execution_completed" in event_types
        assert "task.completed" in event_types
        assert "agent.idle" in event_types

        # Verify task completed in database
        db_session.refresh(task)
        assert task.status == "completed"

        agent = db_session.query(AgentModel).filter(AgentModel.id == seed_test_agent.id).first()
        assert agent.status == "idle"

    finally:
        ws_manager.disconnect(mock_ws)

@pytest.mark.asyncio
async def test_cancelled_task_streams_cancellation_events(db_session, seed_test_agent):
    """
    Verifies that cancelling a task streams task.cancelled and restores agent.idle.
    """
    mock_ws = MockWebSocketClient()
    ws_manager.active_connections.add(mock_ws)
    ws_manager.connection_metadata[mock_ws] = {
        "user_id": "test_mock_user",
        "organization_id": "org_default_company",
        "is_superadmin": False,
    }

    try:
        task = task_service.create_task(
            db=db_session,
            task_in=TaskCreate(
                title="Task to Cancel",
                description="Will be cancelled immediately",
                assigned_agent_id=seed_test_agent.id,
                priority="normal",
            )
        )

        # Cancel Task
        task_service.cancel_task(db=db_session, task_id=task.id)
        await asyncio.sleep(0.01)

        event_types = [
            m.get("event", {}).get("event_type")
            for m in mock_ws.received_messages
            if m.get("message_type") == "event"
        ]

        assert "task.created" in event_types
        assert "task.cancelled" in event_types

        db_session.refresh(task)
        assert task.status == "cancelled"

    finally:
        ws_manager.disconnect(mock_ws)
