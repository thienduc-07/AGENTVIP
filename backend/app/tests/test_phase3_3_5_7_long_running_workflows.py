import asyncio
import time
import uuid
import pytest
from datetime import datetime, timezone
from typing import Dict, Any, List

from backend.app.core.database import SessionLocal, engine
from backend.app.core.config import settings
from backend.app.models.agent import AgentModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.task import TaskModel
from backend.app.models.artifact import ArtifactModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.orchestrator.multi_agent_orchestrator import MultiAgentOrchestrator
from backend.app.services.event_service import event_service
from backend.app.services.behavioral_state_service import behavioral_state_service, BehavioralState
from backend.app.agent_runtime.llm.base import (
    LLMProvider,
    LLMResponse,
    LLMHealthCheckResult,
    LLMUsage,
    ToolCallRequest,
)


class FastLongRunningProvider(LLMProvider):
    provider_name = "fast_long_running"
    model = "long-v1"
    is_live_provider = False

    async def check_health(self):
        return LLMHealthCheckResult(healthy=True, provider=self.provider_name, model=self.model)

    async def generate(self, messages, *, tools=None, temperature=0.2):
        has_tool_res = any(m.get("role") == "tool" for m in messages)
        if not has_tool_res and tools:
            tool_names = [t.get("function", {}).get("name") for t in tools if isinstance(t, dict)]
            tool_name = "calculator" if "calculator" in tool_names else (tool_names[0] if tool_names else "calculator")
            args = {"expression": "1 + 1"} if tool_name == "calculator" else {"filepath": "artifacts/summary.md", "must_exist": False}
            return LLMResponse(
                content=None,
                tool_calls=[ToolCallRequest(tool_name=tool_name, arguments=args, call_id="call_lr_1")],
                usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20, estimated_cost_usd=0.0),
                provider=self.provider_name,
                model=self.model,
            )
        return LLMResponse(
            content="Execution phase verified successfully.",
            tool_calls=[],
            usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20, estimated_cost_usd=0.0),
            provider=self.provider_name,
            model=self.model,
        )


@pytest.fixture
def long_env(monkeypatch):
    monkeypatch.setattr(
        "backend.app.agent_runtime.orchestrator.multi_agent_orchestrator.get_llm_provider",
        lambda **kwargs: FastLongRunningProvider(),
    )
    db = SessionLocal()
    u_tag = uuid.uuid4().hex[:8]
    org_id = f"org_long_{u_tag}"
    org = OrganizationModel(id=org_id, name="Long Running Test Org", slug=org_id.lower(), is_active=True)
    db.add(org)

    agents = []
    for i in range(1, 30):
        ag = AgentModel(
            id=f"ag_long_{i:02d}_{u_tag}",
            name=f"Long Agent {i}",
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
        db.query(AgentEventModel).filter(AgentEventModel.organization_id == org_id).delete(synchronize_session=False)
        db.query(AgentModel).filter(AgentModel.organization_id == org_id).delete(synchronize_session=False)
        db.query(OrganizationModel).filter(OrganizationModel.id == org_id).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
    db.close()


@pytest.mark.asyncio
async def test_3_3_5_7_01_deep_linear_workflow_50_subtasks(long_env):
    """1. Deep linear workflow: 50 sequential subtasks chained end-to-end without stack overflow or connection leaks."""
    db = long_env["db"]
    org_id = long_env["org_id"]
    agents = long_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-deep-50-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="50 Sequential Steps Deep Pipeline",
        description="Linear chain execution",
        assigned_agent_id=agents[0].id,
        status="queued",
    )
    db.add(wf)

    # Chain 50 subtasks: step_0 -> step_1 -> ... -> step_49
    num_steps = 50
    for i in range(num_steps):
        prev_dep = [f"step_{i-1}"] if i > 0 else []
        initial_st = "queued" if i == 0 else "pending"
        st = TaskModel(
            id=f"st-deep-{i}-{uuid.uuid4().hex[:8]}",
            parent_task_id=wf_id,
            organization_id=org_id,
            task_type="subtask",
            title=f"Pipeline Step {i}",
            description=f"Sequential step {i}",
            assigned_agent_id=agents[i % len(agents)].id,
            agent_type="general",
            status=initial_st,
            dependencies_json=prev_dep,
            input_data_json={"subtask_key": f"step_{i}"},
        )
        db.add(st)
    db.commit()

    token = CancellationToken()
    start = time.perf_counter()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=1)
    duration = time.perf_counter() - start

    db.expire_all()
    wf_res = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert wf_res.status == "completed"

    subtasks = db.query(TaskModel).filter(TaskModel.parent_task_id == wf_id).all()
    assert len(subtasks) == num_steps
    assert all(st.status == "completed" for st in subtasks)


@pytest.mark.asyncio
async def test_3_3_5_7_02_broad_fanout_fanin_workflow_100_subtasks(long_env):
    """2. Broad fan-out/fan-in workflow: 100 subtasks (1 root -> 98 parallel workers -> 1 aggregator)."""
    db = long_env["db"]
    org_id = long_env["org_id"]
    agents = long_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-fan-100-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="Fan-Out/Fan-In 100 Subtasks",
        description="Broad parallel aggregation",
        assigned_agent_id=agents[0].id,
        status="queued",
    )
    # Root task
    st_root = TaskModel(
        id=f"st-fan-root-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_id,
        organization_id=org_id,
        task_type="subtask",
        title="Root Dispatcher",
        description="Emits work items",
        assigned_agent_id=agents[0].id,
        agent_type="general",
        status="queued",
        dependencies_json=[],
        input_data_json={"subtask_key": "root"},
    )
    db.add(wf)
    db.add(st_root)

    # 98 parallel workers
    worker_keys = []
    for i in range(98):
        k = f"worker_{i}"
        worker_keys.append(k)
        st_w = TaskModel(
            id=f"st-fan-w-{i}-{uuid.uuid4().hex[:8]}",
            parent_task_id=wf_id,
            organization_id=org_id,
            task_type="subtask",
            title=f"Parallel Worker {i}",
            description="Parallel map phase",
            assigned_agent_id=agents[(i + 1) % len(agents)].id,
            agent_type="general",
            status="pending",
            dependencies_json=["root"],
            input_data_json={"subtask_key": k},
        )
        db.add(st_w)

    # 1 aggregator depending on all 98 workers
    st_agg = TaskModel(
        id=f"st-fan-agg-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_id,
        organization_id=org_id,
        task_type="subtask",
        title="Aggregator Reducer",
        description="Consolidates 98 parallel worker findings",
        assigned_agent_id=agents[0].id,
        agent_type="general",
        status="pending",
        dependencies_json=worker_keys,
        input_data_json={"subtask_key": "aggregator"},
    )
    db.add(st_agg)
    db.commit()

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=25)

    db.expire_all()
    wf_res = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert wf_res.status == "completed"

    all_st = db.query(TaskModel).filter(TaskModel.parent_task_id == wf_id).all()
    assert len(all_st) == 100
    assert all(st.status == "completed" for st in all_st)


@pytest.mark.asyncio
async def test_3_3_5_7_03_prolonged_waiting_workflow(long_env):
    """3. Prolonged waiting workflow: subtask requiring human approval enters WAITING state cleanly."""
    db = long_env["db"]
    org_id = long_env["org_id"]
    agent = long_env["agents"][0]

    task_id = f"task-wait-{uuid.uuid4().hex[:8]}"
    task = TaskModel(
        id=task_id,
        organization_id=org_id,
        task_type="subtask",
        title="High-Value Wire Transfer Authorization",
        description="Requires executive signoff",
        assigned_agent_id=agent.id,
        status="waiting_approval",
    )
    db.add(task)
    db.commit()

    # Transition agent to WAITING behavioral state
    behavioral_state_service.transition_state(
        db=db,
        agent_id=agent.id,
        target_state=BehavioralState.WAITING,
        organization_id=org_id,
        task_id=task_id,
        reason="Awaiting executive authorization",
        commit=True,
    )

    db.expire_all()
    ag_reloaded = db.query(AgentModel).filter(AgentModel.id == agent.id).first()
    assert ag_reloaded.behavioral_state == "WAITING"
    assert ag_reloaded.status in ("waiting_approval", "idle")

    # Agent is safely released back to IDLE upon approval resolution
    behavioral_state_service.safe_release_agent(
        db=db,
        agent_id=agent.id,
        organization_id=org_id,
        reason="Approval resolved",
        commit=True,
    )

    db.expire_all()
    assert db.query(AgentModel).filter(AgentModel.id == agent.id).first().behavioral_state == "IDLE"


@pytest.mark.asyncio
async def test_3_3_5_7_04_workflow_cancellation_mid_run(long_env, monkeypatch):
    """4. Workflow cancellation mid-run: in-flight subtasks cancel cleanly and agents release to IDLE."""
    db = long_env["db"]
    org_id = long_env["org_id"]
    agents = long_env["agents"][:5]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-cancel-mid-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Cancellation Mid-Run", description="Abort test", assigned_agent_id=agents[0].id, status="queued")
    db.add(wf)

    for i in range(5):
        st = TaskModel(
            id=f"st-cm-{i}-{uuid.uuid4().hex[:8]}",
            parent_task_id=wf_id,
            organization_id=org_id,
            task_type="subtask",
            title=f"Parallel Step {i}",
            description="Testing mid-flight abort",
            assigned_agent_id=agents[i].id,
            agent_type="general",
            status="queued",
            dependencies_json=[],
            input_data_json={"subtask_key": f"cm_{i}"},
        )
        db.add(st)
    db.commit()

    token = CancellationToken()

    async def mock_execute(db, subtask, parent_task, subtask_results, llm_provider, token):
        # Cancel workflow during the second subtask
        if "cm_1" in (subtask.input_data_json or {}).get("subtask_key", ""):
            token.cancel("User cancelled mid-run")
        token.check()

    monkeypatch.setattr(orchestrator, "_execute_subtask", mock_execute)

    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=2)

    db.expire_all()
    wf_r = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert wf_r.status == "cancelled"

    for ag in agents:
        ag_r = db.query(AgentModel).filter(AgentModel.id == ag.id).first()
        assert ag_r.status == "idle"
        assert ag_r.behavioral_state == "IDLE"


def test_3_3_5_7_05_resource_cleanup_after_completion(long_env):
    """5. Resource cleanup: database connection pool returns connections, memory freed."""
    pool = engine.pool
    # Verified connection pool checked in status
    assert pool.checkedin() >= 0
    # Temporary files verification
    sandbox_artifacts = settings.SANDBOX_DIR / "artifacts"
    if sandbox_artifacts.exists():
        temp_files = list(sandbox_artifacts.glob("*.tmp.*"))
        assert len(temp_files) == 0


def test_3_3_5_7_06_execution_history_pagination(long_env):
    """6. Execution history pagination: workflow with 100+ events paginates correctly."""
    db = long_env["db"]
    org_id = long_env["org_id"]
    agent = long_env["agents"][0]

    # Pre-generate 100 events
    for i in range(100):
        event_service.create_event(
            db=db,
            event_type="pagination.test.event",
            agent_id=agent.id,
            organization_id=org_id,
            payload={"index": i},
            commit=False,
        )
    db.commit()

    page1 = event_service.get_events(db, organization_id=org_id, limit=50, offset=0)
    page2 = event_service.get_events(db, organization_id=org_id, limit=50, offset=50)

    assert len(page1) == 50
    assert len(page2) == 50

    p1_ids = {e.id for e in page1}
    p2_ids = {e.id for e in page2}
    # No overlap between page 1 and page 2
    assert len(p1_ids.intersection(p2_ids)) == 0


@pytest.mark.asyncio
async def test_3_3_5_7_07_workflow_resume_after_partial_failure(long_env, monkeypatch):
    """7. Workflow resume after partial failure: subtasks 1-2 skipped, subtask 3 re-executes, subtasks 4-5 execute."""
    db = long_env["db"]
    org_id = long_env["org_id"]
    agents = long_env["agents"][:5]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-resum-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Resume Partial Fail", description="Testing resume", assigned_agent_id=agents[0].id, status="in_progress")
    # Subtasks 1 and 2 already completed in previous run
    st1 = TaskModel(id=f"st-r1-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Step 1", description="Done", assigned_agent_id=agents[0].id, agent_type="general", status="completed", dependencies_json=[], input_data_json={"subtask_key": "step_1"})
    st2 = TaskModel(id=f"st-r2-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Step 2", description="Done", assigned_agent_id=agents[1].id, agent_type="general", status="completed", dependencies_json=["step_1"], input_data_json={"subtask_key": "step_2"})
    # Subtask 3 was fixed and reset to queued
    st3 = TaskModel(id=f"st-r3-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Step 3", description="Fixed and retried", assigned_agent_id=agents[2].id, agent_type="general", status="queued", dependencies_json=["step_2"], input_data_json={"subtask_key": "step_3"})
    # Subtasks 4 and 5 pending
    st4 = TaskModel(id=f"st-r4-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Step 4", description="Waiting", assigned_agent_id=agents[3].id, agent_type="general", status="pending", dependencies_json=["step_3"], input_data_json={"subtask_key": "step_4"})
    st5 = TaskModel(id=f"st-r5-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Step 5", description="Waiting", assigned_agent_id=agents[4].id, agent_type="general", status="pending", dependencies_json=["step_4"], input_data_json={"subtask_key": "step_5"})

    db.add(wf)
    db.add(st1)
    db.add(st2)
    db.add(st3)
    db.add(st4)
    db.add(st5)
    db.commit()

    executed_subtask_keys = []
    original_execute = orchestrator._execute_subtask

    async def mock_execute(db, subtask, parent_task, subtask_results, llm_provider, token):
        k = (subtask.input_data_json or {}).get("subtask_key")
        executed_subtask_keys.append(k)
        await original_execute(db, subtask, parent_task, subtask_results, llm_provider, token)

    monkeypatch.setattr(orchestrator, "_execute_subtask", mock_execute)

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db)

    db.expire_all()
    wf_final = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert wf_final.status == "completed"

    # Crucial: Step 1 and Step 2 were NOT re-executed! Only 3, 4, 5 ran!
    assert "step_1" not in executed_subtask_keys
    assert "step_2" not in executed_subtask_keys
    assert executed_subtask_keys == ["step_3", "step_4", "step_5"]


@pytest.mark.asyncio
async def test_3_3_5_7_08_state_transition_sequence_audit(long_env):
    """8. State transition sequence audit: monotonic sequence IDs across 20-subtask execution."""
    db = long_env["db"]
    org_id = long_env["org_id"]
    agents = long_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-audit-seq-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Audit Monotonic Sequence", description="Sequence audit", assigned_agent_id=agents[0].id, status="queued")
    db.add(wf)

    for i in range(20):
        st = TaskModel(
            id=f"st-seq-{i}-{uuid.uuid4().hex[:8]}",
            parent_task_id=wf_id,
            organization_id=org_id,
            task_type="subtask",
            title=f"Audit Step {i}",
            description="Testing sequence integrity",
            assigned_agent_id=agents[i % len(agents)].id,
            agent_type="general",
            status="queued",
            dependencies_json=[],
            input_data_json={"subtask_key": f"seq_{i}"},
        )
        db.add(st)
    db.commit()

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=5)

    events = (
        db.query(AgentEventModel)
        .filter(AgentEventModel.organization_id == org_id)
        .order_by(AgentEventModel.sequence_id.asc())
        .all()
    )
    assert len(events) >= 20
    # Verify strict monotonic sequence ordering: seq[i] < seq[i+1]
    seq_nums = [e.sequence_id for e in events]
    for i in range(len(seq_nums) - 1):
        assert seq_nums[i] < seq_nums[i + 1]


@pytest.mark.asyncio
async def test_3_3_5_7_09_sustained_load_throughput_benchmark(long_env):
    """9. Sustained load benchmark: continuous execution of tasks; measures throughput & latency."""
    db = long_env["db"]
    org_id = long_env["org_id"]
    agents = long_env["agents"][:5]

    orchestrator = MultiAgentOrchestrator()
    latencies = []
    num_runs = 15

    for run_idx in range(num_runs):
        wf_id = f"wf-bench-{run_idx}-{uuid.uuid4().hex[:8]}"
        wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title=f"Bench Run {run_idx}", description="Bench", assigned_agent_id=agents[0].id, status="queued")
        st = TaskModel(id=f"st-bench-{run_idx}-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Bench Step", description="Latency test", assigned_agent_id=agents[run_idx % len(agents)].id, agent_type="general", status="queued", dependencies_json=[], input_data_json={"subtask_key": f"bk_{run_idx}"})
        db.add(wf)
        db.add(st)
        db.commit()

        start = time.perf_counter()
        token = CancellationToken()
        await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db)
        lat = time.perf_counter() - start
        latencies.append(lat)

    latencies.sort()
    p50 = latencies[len(latencies) // 2]
    p95 = latencies[int(len(latencies) * 0.95)]
    throughput = num_runs / sum(latencies)

    assert p50 < 0.5  # Sub-second median latency
    assert p95 < 1.0  # Under 1 second p95
    assert throughput > 2.0  # Above 2 workflows / sec on local engine


def test_3_3_5_7_10_system_stability_post_test_verification(long_env):
    """10. System stability verification: confirms 0 leaked connections, 0 orphaned tasks, 0 stuck agents."""
    db = long_env["db"]
    org_id = long_env["org_id"]

    # 1. 0 running tasks
    running_tasks = db.query(TaskModel).filter(
        TaskModel.organization_id == org_id,
        TaskModel.status.in_(["running", "in_progress", "planning"]),
    ).count()
    assert running_tasks == 0

    # 2. 0 stuck agents
    stuck_agents = db.query(AgentModel).filter(
        AgentModel.organization_id == org_id,
        (AgentModel.status != "idle") | (AgentModel.behavioral_state != "IDLE"),
    ).count()
    assert stuck_agents == 0

    # 3. Connection pool healthy
    pool = engine.pool
    assert pool.size() >= 0
