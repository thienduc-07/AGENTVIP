import os
import uuid
from datetime import datetime, timezone, timedelta
import pytest
from sqlalchemy.orm import Session

from backend.app.core.database import SessionLocal
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.meeting import MeetingModel
from backend.app.models.execution import ExecutionModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.models.auth import OrganizationModel
from backend.app.agent_runtime.dispatcher.crash_recovery import (
    recover_abandoned_tasks,
    recover_abandoned_meetings,
    recover_abandoned_executions,
)


@pytest.fixture
def recovery_db():
    db = SessionLocal()
    org_id = f"org_recov_{uuid.uuid4().hex[:8]}"
    org = OrganizationModel(id=org_id, name="Recovery Org", slug=org_id, is_active=True)
    db.add(org)

    agent = AgentModel(
        id=f"agt_recov_{uuid.uuid4().hex[:8]}",
        name="Recovery Specialist",
        role="Systems Engineer",
        station="engineering_bay",
        status="working",
        organization_id=org_id,
    )
    db.add(agent)
    db.commit()

    yield db, org_id, agent.id

    # Clean teardown in reverse foreign-key dependency order
    db.query(AgentEventModel).filter(AgentEventModel.organization_id == org_id).delete(synchronize_session=False)
    db.query(ExecutionModel).filter(ExecutionModel.organization_id == org_id).delete(synchronize_session=False)
    db.query(MeetingModel).filter(MeetingModel.organization_id == org_id).delete(synchronize_session=False)
    db.query(TaskModel).filter(TaskModel.organization_id == org_id).delete(synchronize_session=False)
    db.query(AgentModel).filter(AgentModel.organization_id == org_id).delete(synchronize_session=False)
    db.query(OrganizationModel).filter(OrganizationModel.id == org_id).delete(synchronize_session=False)
    db.commit()
    db.close()


def test_abandoned_task_recovery(recovery_db):
    """Test 1: Tasks abandoned in 'running' state are safely recovered and marked failed."""
    db, org_id, agent_id = recovery_db

    task = TaskModel(
        id=f"task_recov_{uuid.uuid4().hex[:8]}",
        title="Abandoned In Flight Task",
        description="Worker crashed during execution",
        status="running",
        priority="high",
        assigned_agent_id=agent_id,
        organization_id=org_id,
        started_at=datetime.now(timezone.utc) - timedelta(minutes=15),
    )
    db.add(task)
    db.commit()

    # Run task crash recovery without auto_retry
    recovered_count = recover_abandoned_tasks(db, auto_retry=False)
    assert recovered_count >= 1

    db.refresh(task)
    assert task.status == "failed"
    assert "worker restart" in task.error_message.lower()


def test_abandoned_meeting_recovery(recovery_db):
    """Test 2: Meetings abandoned in 'IN_PROGRESS' state are safely paused."""
    db, org_id, agent_id = recovery_db

    meeting = MeetingModel(
        id=f"meet_recov_{uuid.uuid4().hex[:8]}",
        title="Abandoned Board Meeting",
        meeting_type="STRATEGY_SESSION",
        status="IN_PROGRESS",
        organization_id=org_id,
        moderator_agent_id=agent_id,
        started_at=datetime.now(timezone.utc) - timedelta(hours=2),
    )
    db.add(meeting)
    db.commit()

    recovered_count = recover_abandoned_meetings(db)
    assert recovered_count >= 1

    db.refresh(meeting)
    assert meeting.status in ["PAUSED", "COMPLETED"]


def test_abandoned_execution_recovery(recovery_db):
    """Test 3: Workstation executions abandoned in 'running' state are terminated safely."""
    db, org_id, agent_id = recovery_db

    execution = ExecutionModel(
        id=f"exec_recov_{uuid.uuid4().hex[:8]}",
        organization_id=org_id,
        agent_id=agent_id,
        status="running",
        started_at=datetime.utcnow() - timedelta(hours=1),
    )
    db.add(execution)
    db.commit()

    recovered_count = recover_abandoned_executions(db)
    assert recovered_count >= 1

    db.refresh(execution)
    assert execution.status in ["failed", "timeout"]
    assert execution.completed_at is not None


def test_recovery_idempotency(recovery_db):
    """Test 4: Running recovery repeatedly is idempotent and does not corrupt state."""
    db, org_id, agent_id = recovery_db

    # Second pass over clean state
    recovered_tasks = recover_abandoned_tasks(db, auto_retry=False)
    recovered_meetings = recover_abandoned_meetings(db)
    recovered_execs = recover_abandoned_executions(db)

    assert recovered_tasks == 0
    assert recovered_meetings == 0
    assert recovered_execs == 0
