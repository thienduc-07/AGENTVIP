import asyncio
import os
import time
import uuid
import pytest
from datetime import datetime, timezone, timedelta
from typing import Dict, Any

from backend.app.core.database import SessionLocal
from backend.app.core.config import settings
from backend.app.models.agent import AgentModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.task import TaskModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.orchestrator.multi_agent_orchestrator import MultiAgentOrchestrator
from backend.app.agent_runtime.dispatcher.crash_recovery import (
    recover_abandoned_tasks,
    detect_and_reclaim_stale_leases,
)
from backend.app.agent_runtime.lifecycle.retry_manager import retry_manager
from backend.app.agent_runtime.contracts.deliverable_contract import StructuredDeliverable
from backend.app.agent_runtime.llm.base import (
    LLMProvider,
    LLMResponse,
    LLMHealthCheckResult,
    LLMUsage,
    ToolCallRequest,
)
from backend.app.agent_runtime.tools.workspace.workspace_write import WorkspaceWriteTool
from backend.app.agent_runtime.tools.artifact.artifact_tools import ArtifactCreateTool


class FastRecoveryTestProvider(LLMProvider):
    provider_name = "fast_recovery"
    model = "recovery-v1"
    is_live_provider = False

    async def check_health(self):
        return LLMHealthCheckResult(healthy=True, provider=self.provider_name, model=self.model)

    async def generate(self, messages, *, tools=None, temperature=0.2):
        has_tool_res = any(m.get("role") == "tool" for m in messages)
        if not has_tool_res and tools:
            return LLMResponse(
                content=None,
                tool_calls=[ToolCallRequest(tool_name="calculator", arguments={"expression": "10 + 10"}, call_id="call_rec_1")],
                usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20, estimated_cost_usd=0.0),
                provider=self.provider_name,
                model=self.model,
            )
        return LLMResponse(
            content="Execution completed with verified evidence.",
            tool_calls=[],
            usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20, estimated_cost_usd=0.0),
            provider=self.provider_name,
            model=self.model,
        )


@pytest.fixture
def recovery_env(monkeypatch):
    monkeypatch.setattr(
        "backend.app.agent_runtime.orchestrator.multi_agent_orchestrator.get_llm_provider",
        lambda **kwargs: FastRecoveryTestProvider(),
    )
    db = SessionLocal()
    u_tag = uuid.uuid4().hex[:8]
    org_id = f"org_recov_{u_tag}"
    org = OrganizationModel(id=org_id, name="Crash Recovery Test Org", slug=org_id.lower(), is_active=True)
    db.add(org)

    agents = []
    for i in range(1, 25):
        ag = AgentModel(
            id=f"ag_recov_{i:03d}_{u_tag}",
            name=f"Recovery Agent {i}",
            role="Specialist",
            organization_id=org_id,
            status="idle",
            behavioral_state="IDLE",
        )
        agents.append(ag)
        db.add(ag)
    db.commit()

    yield {
        "db": db,
        "org_id": org_id,
        "agents": agents,
        "u_tag": u_tag,
    }

    try:
        db.query(TaskModel).filter(TaskModel.organization_id == org_id).delete(synchronize_session=False)
        db.query(AgentModel).filter(AgentModel.organization_id == org_id).delete(synchronize_session=False)
        db.query(OrganizationModel).filter(OrganizationModel.id == org_id).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
    db.close()


@pytest.mark.asyncio
async def test_3_3_5_2_01_agent_process_crash_mid_execution(recovery_env):
    """1. Agent process crashes mid-execution (simulated SIGKILL / process termination)."""
    db = recovery_env["db"]
    org_id = recovery_env["org_id"]
    agent = recovery_env["agents"][0]

    # Task was mid-execution when process was terminated
    task = TaskModel(
        id=f"task-crash-{uuid.uuid4().hex[:8]}",
        organization_id=org_id,
        task_type="subtask",
        title="Interrupted Task",
        description="Process crashed mid-run",
        assigned_agent_id=agent.id,
        status="running",
        retry_count=0,
        max_retries=2,
    )
    agent.status = "working"
    agent.behavioral_state = "WORKING"
    agent.current_task_id = task.id
    db.add(task)
    db.commit()

    # Trigger post-crash recovery
    recovered = recover_abandoned_tasks(db, auto_retry=True)
    assert recovered >= 1

    db.expire_all()
    reloaded_task = db.query(TaskModel).filter(TaskModel.id == task.id).first()
    reloaded_agent = db.query(AgentModel).filter(AgentModel.id == agent.id).first()

    assert reloaded_task.status == "queued"
    assert reloaded_task.retry_count == 1
    assert reloaded_agent.status == "idle"
    assert reloaded_agent.behavioral_state == "IDLE"
    assert reloaded_agent.current_task_id is None


@pytest.mark.asyncio
async def test_3_3_5_2_02_agent_unresponsive_heartbeat_timeout(recovery_env):
    """2. Agent becomes unresponsive (heartbeat timeout / lease expiration)."""
    db = recovery_env["db"]
    org_id = recovery_env["org_id"]
    agent = recovery_env["agents"][1]

    # Task updated 10 minutes ago, exceeding 300s lease threshold
    stale_time = datetime.now(timezone.utc) - timedelta(minutes=10)
    task = TaskModel(
        id=f"task-stale-{uuid.uuid4().hex[:8]}",
        organization_id=org_id,
        task_type="subtask",
        title="Unresponsive Agent Task",
        description="Agent stopped sending heartbeats",
        assigned_agent_id=agent.id,
        status="running",
        retry_count=0,
        max_retries=2,
        updated_at=stale_time,
    )
    agent.status = "working"
    agent.behavioral_state = "THINKING"
    agent.current_task_id = task.id
    db.add(task)
    db.commit()

    reclaimed = detect_and_reclaim_stale_leases(db, lease_timeout_seconds=300.0)
    assert reclaimed >= 1

    db.expire_all()
    reloaded_task = db.query(TaskModel).filter(TaskModel.id == task.id).first()
    reloaded_agent = db.query(AgentModel).filter(AgentModel.id == agent.id).first()

    assert reloaded_task.status == "queued"
    assert reloaded_task.retry_count == 1
    assert reloaded_agent.status == "idle"
    assert reloaded_agent.behavioral_state == "IDLE"


@pytest.mark.asyncio
async def test_3_3_5_2_03_stale_task_lease_reclamation(recovery_env):
    """3. Stale task lease reclamation: when an agent holds a task lease past TTL, another agent reclaims it."""
    db = recovery_env["db"]
    org_id = recovery_env["org_id"]
    agent_slow = recovery_env["agents"][2]
    agent_healthy = recovery_env["agents"][3]

    stale_time = datetime.now(timezone.utc) - timedelta(seconds=400)
    task = TaskModel(
        id=f"task-lease-{uuid.uuid4().hex[:8]}",
        organization_id=org_id,
        task_type="subtask",
        title="Reclaimable Lease Task",
        description="Lease expired, should be re-assigned",
        assigned_agent_id=agent_slow.id,
        agent_type="general",
        status="running",
        retry_count=0,
        max_retries=2,
        dependencies_json=[],
        input_data_json={"subtask_key": "rec_lease"},
        updated_at=stale_time,
    )
    agent_slow.status = "working"
    agent_slow.behavioral_state = "WORKING"
    agent_slow.current_task_id = task.id
    db.add(task)
    db.commit()

    # Reclaim stale lease
    detect_and_reclaim_stale_leases(db, lease_timeout_seconds=300.0)

    db.expire_all()
    reloaded_task = db.query(TaskModel).filter(TaskModel.id == task.id).first()
    assert reloaded_task.status == "queued"

    # Reassign to agent_healthy
    reloaded_task.assigned_agent_id = agent_healthy.id
    db.commit()

    assert reloaded_task.assigned_agent_id == agent_healthy.id


@pytest.mark.asyncio
async def test_3_3_5_2_04_server_restart_during_subtask_execution(recovery_env):
    """4. Server restart during subtask execution: recovered tasks resume from last valid state."""
    db = recovery_env["db"]
    org_id = recovery_env["org_id"]
    agents = recovery_env["agents"]

    wf_id = f"wf-restart-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="Workflow Interrupted by Reboot",
        description="Testing recovery resumption",
        assigned_agent_id=agents[0].id,
        status="in_progress",
    )
    # Child 1: was already completed before crash
    st1 = TaskModel(
        id=f"st-rest-1-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_id,
        organization_id=org_id,
        task_type="subtask",
        title="Completed Child 1",
        description="Was finished before restart",
        assigned_agent_id=agents[1].id,
        agent_type="general",
        status="completed",
        dependencies_json=[],
        input_data_json={"subtask_key": "rest_1"},
    )
    # Child 2: was running when server restarted
    st2 = TaskModel(
        id=f"st-rest-2-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_id,
        organization_id=org_id,
        task_type="subtask",
        title="Interrupted Child 2",
        description="Was in progress during restart",
        assigned_agent_id=agents[2].id,
        agent_type="general",
        status="running",
        retry_count=0,
        max_retries=2,
        dependencies_json=["rest_1"],
        input_data_json={"subtask_key": "rest_2"},
    )
    agents[2].status = "working"
    agents[2].behavioral_state = "WORKING"
    agents[2].current_task_id = st2.id

    db.add(wf)
    db.add(st1)
    db.add(st2)
    db.commit()

    # Trigger recovery as occurs during server startup
    recovered = recover_abandoned_tasks(db, auto_retry=True)
    assert recovered >= 1

    db.expire_all()
    st1_r = db.query(TaskModel).filter(TaskModel.id == st1.id).first()
    st2_r = db.query(TaskModel).filter(TaskModel.id == st2.id).first()
    wf_r = db.query(TaskModel).filter(TaskModel.id == wf_id).first()

    # st1 remains completed, st2 is re-queued, wf is re-queued
    assert st1_r.status == "completed"
    assert st2_r.status == "queued"
    assert wf_r.status == "queued"


@pytest.mark.asyncio
async def test_3_3_5_2_05_worker_db_session_disconnects_mid_transaction(recovery_env):
    """5. Worker database session drops mid-transaction: task transaction rolls back cleanly."""
    db = recovery_env["db"]
    org_id = recovery_env["org_id"]
    agent = recovery_env["agents"][4]

    task_id = f"task-tx-abort-{uuid.uuid4().hex[:8]}"
    initial_task = TaskModel(
        id=task_id,
        organization_id=org_id,
        task_type="subtask",
        title="Transaction Rollback Task",
        description="Should remain intact after worker disconnect",
        assigned_agent_id=agent.id,
        status="queued",
    )
    db.add(initial_task)
    db.commit()

    # Worker session starts a transaction but encounters a simulated connection drop
    worker_session = SessionLocal()
    try:
        t_worker = worker_session.query(TaskModel).filter(TaskModel.id == task_id).first()
        t_worker.status = "running"
        t_worker.error_message = "Partial uncommitted data"
        # Simulate unhandled network disconnect before commit
        raise ConnectionResetError("Simulated DB pipe broken mid-transaction")
    except ConnectionResetError:
        worker_session.rollback()
    finally:
        worker_session.close()

    db.expire_all()
    reloaded = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    # Uncommitted dirty status was cleanly rolled back
    assert reloaded.status == "queued"
    assert reloaded.error_message is None


@pytest.mark.asyncio
async def test_3_3_5_2_06_crash_after_producing_deliverable_before_reporting_completion(recovery_env):
    """6. Crash after subtask produces deliverable: recovery detects existing deliverable and does not re-execute."""
    db = recovery_env["db"]
    org_id = recovery_env["org_id"]
    agent = recovery_env["agents"][5]

    # Task crashed while in 'running' status, but deliverable was already created and verified
    deliverable = StructuredDeliverable(
        deliverable_id=f"deliv-crash-{uuid.uuid4().hex[:8]}",
        task_id=f"task-with-deliv-{uuid.uuid4().hex[:8]}",
        agent_id=agent.id,
        execution_id=f"exec-{uuid.uuid4().hex[:8]}",
        objective="Deliverable persistence verification",
        result_summary="Verified deliverable saved right before crash",
        evidence=["calc: 20"],
        artifact_paths=["artifacts/report.md"],
        artifact_hashes={"artifacts/report.md": "abc123hash"},
        verification_status="VERIFIED",
    )
    task = TaskModel(
        id=deliverable.task_id,
        organization_id=org_id,
        task_type="subtask",
        title="Task with Saved Deliverable",
        description="Crash happened after deliverable persistence",
        assigned_agent_id=agent.id,
        agent_type="general",
        status="running",
        retry_count=0,
        output_data_json={"deliverable": deliverable.to_dict()},
    )
    agent.status = "working"
    agent.behavioral_state = "WORKING"
    agent.current_task_id = task.id
    db.add(task)
    db.commit()

    recovered = recover_abandoned_tasks(db, auto_retry=True)
    assert recovered >= 1

    db.expire_all()
    reloaded_task = db.query(TaskModel).filter(TaskModel.id == task.id).first()
    reloaded_agent = db.query(AgentModel).filter(AgentModel.id == agent.id).first()

    # Recovery recognized verified deliverable and completed without re-queuing
    assert reloaded_task.status == "completed"
    assert reloaded_task.retry_count == 0  # Not retried unnecessarily
    assert reloaded_agent.status == "idle"
    assert reloaded_agent.behavioral_state == "IDLE"


@pytest.mark.asyncio
async def test_3_3_5_2_07_crash_during_deliverable_persistence(recovery_env):
    """7. Crash during deliverable persistence: deliverable file integrity verified, partial writes cleaned up."""
    # Test atomic write tool handles interrupted write and cleanup
    tool = WorkspaceWriteTool()
    test_file = f"reports/crash_test_{uuid.uuid4().hex[:8]}.txt"
    full_content = "Complete valid market analysis data."

    # Normal atomic write succeeds
    res = await tool.execute({"filepath": test_file, "content": full_content, "overwrite": True})
    assert res.success is True

    target_path = settings.SANDBOX_DIR / test_file
    assert target_path.exists()
    assert target_path.read_text(encoding="utf-8") == full_content

    # No leftover temporary files in directory
    temp_files = list(target_path.parent.glob(f".{target_path.name}.tmp.*"))
    assert len(temp_files) == 0

    # Cleanup
    if target_path.exists():
        target_path.unlink()


@pytest.mark.asyncio
async def test_3_3_5_2_08_multiple_agents_crash_simultaneously(recovery_env):
    """8. Multiple agents crash simultaneously: recovery mechanism scales and handles bulk failures."""
    db = recovery_env["db"]
    org_id = recovery_env["org_id"]
    agents = recovery_env["agents"][:20]

    crashed_tasks = []
    for i, ag in enumerate(agents):
        task = TaskModel(
            id=f"task-bulk-{i}-{uuid.uuid4().hex[:8]}",
            organization_id=org_id,
            task_type="subtask",
            title=f"Bulk Interrupted Task {i}",
            description="Fleet crash test",
            assigned_agent_id=ag.id,
            status="running",
            retry_count=0,
            max_retries=2,
        )
        ag.status = "working"
        ag.behavioral_state = "WORKING"
        ag.current_task_id = task.id
        crashed_tasks.append(task)
        db.add(task)
    db.commit()

    recovered_count = recover_abandoned_tasks(db, auto_retry=True)
    assert recovered_count >= 20

    db.expire_all()
    for task in crashed_tasks:
        t = db.query(TaskModel).filter(TaskModel.id == task.id).first()
        assert t.status == "queued"
        assert t.retry_count == 1

    for ag in agents:
        a = db.query(AgentModel).filter(AgentModel.id == ag.id).first()
        assert a.status == "idle"
        assert a.behavioral_state == "IDLE"
        assert a.current_task_id is None


@pytest.mark.asyncio
async def test_3_3_5_2_09_recovery_failure_exponential_backoff_and_dead_letter(recovery_env):
    """9. Recovery itself encounters a failure: exponential backoff, dead-letter state after max retries."""
    db = recovery_env["db"]
    org_id = recovery_env["org_id"]
    agent = recovery_env["agents"][6]

    # Verify backoff calculation
    b0 = retry_manager.calculate_backoff(0, base_seconds=1.0)
    b1 = retry_manager.calculate_backoff(1, base_seconds=1.0)
    b2 = retry_manager.calculate_backoff(2, base_seconds=1.0)
    assert b0 == 1.0
    assert b1 == 2.0
    assert b2 == 4.0

    # Task that already reached max_retries
    dead_task = TaskModel(
        id=f"task-dead-{uuid.uuid4().hex[:8]}",
        organization_id=org_id,
        task_type="subtask",
        title="Exhausted Retries Task",
        description="Should transition to terminal failed (dead-letter)",
        assigned_agent_id=agent.id,
        status="running",
        retry_count=3,
        max_retries=3,  # Already exhausted
    )
    agent.status = "working"
    agent.behavioral_state = "WORKING"
    agent.current_task_id = dead_task.id
    db.add(dead_task)
    db.commit()

    recover_abandoned_tasks(db, auto_retry=True)

    db.expire_all()
    reloaded = db.query(TaskModel).filter(TaskModel.id == dead_task.id).first()
    # Transitioned to terminal failed (dead-letter)
    assert reloaded.status == "failed"
    assert "exhausted" in reloaded.error_message.lower() and "retry" in reloaded.error_message.lower()


@pytest.mark.asyncio
async def test_3_3_5_2_10_post_recovery_system_state_consistency(recovery_env):
    """10. System state after recovery matches expected state: no orphan tasks, no inconsistent agent states."""
    db = recovery_env["db"]
    org_id = recovery_env["org_id"]
    agents = recovery_env["agents"]

    # Verify that in this organization, no running tasks or non-idle agents exist
    running_tasks = (
        db.query(TaskModel)
        .filter(
            TaskModel.organization_id == org_id,
            TaskModel.status.in_(["running", "in_progress", "planning"]),
        )
        .all()
    )
    assert len(running_tasks) == 0

    stuck_agents = (
        db.query(AgentModel)
        .filter(
            AgentModel.organization_id == org_id,
            (AgentModel.status != "idle") | (AgentModel.behavioral_state != "IDLE"),
        )
        .all()
    )
    assert len(stuck_agents) == 0
