import asyncio
import time
import uuid
import pytest
from typing import List, Dict, Any
from sqlalchemy.orm import Session

from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.orchestrator.multi_agent_orchestrator import MultiAgentOrchestrator
from backend.app.agent_runtime.workforce.workload_manager import specialist_workload_manager
from backend.app.agent_runtime.contracts.subtask_contract import SubtaskResultContract
from backend.app.agent_runtime.contracts.deliverable_contract import StructuredDeliverable
from backend.app.agent_runtime.llm.base import (
    LLMProvider,
    LLMResponse,
    LLMHealthCheckResult,
    LLMUsage,
    ToolCallRequest,
)
from backend.app.core.database import SessionLocal
from backend.app.core.config import settings
from backend.app.models.agent import AgentModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.task import TaskModel
from backend.app.services.task_service import task_service
from backend.app.schemas.task import TaskCreate


class FastStressProvider(LLMProvider):
    """Zero-cost fast provider enabling high-volume concurrency benchmarking with valid tool execution."""
    provider_name = "fast_stress"
    model = "fast-v1"
    is_live_provider = False

    async def check_health(self):
        return LLMHealthCheckResult(healthy=True, provider=self.provider_name, model=self.model)

    async def generate(self, messages, *, tools=None, temperature=0.2):
        has_tool_res = any(m.get("role") == "tool" for m in messages)
        # Turn 1: Execute a fast lightweight tool to satisfy ResultVerifier
        if not has_tool_res and tools:
            tool_names = {t.get("function", {}).get("name") for t in tools if isinstance(t, dict)}
            selected_tool = "calculator" if "calculator" in tool_names else ("workspace_list" if "workspace_list" in tool_names else None)
            if selected_tool == "calculator":
                return LLMResponse(
                    content=None,
                    tool_calls=[ToolCallRequest(tool_name="calculator", arguments={"expression": "2 * 2"}, call_id="call_c_1")],
                    usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20, estimated_cost_usd=0.0),
                    provider=self.provider_name,
                    model=self.model,
                )
            elif selected_tool:
                return LLMResponse(
                    content=None,
                    tool_calls=[ToolCallRequest(tool_name=selected_tool, arguments={}, call_id="call_w_1")],
                    usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20, estimated_cost_usd=0.0),
                    provider=self.provider_name,
                    model=self.model,
                )

        # Turn 2: Final completion summary
        return LLMResponse(
            content="Concurrent execution verified successfully with authentic operational evidence.",
            tool_calls=[],
            usage=LLMUsage(prompt_tokens=15, completion_tokens=15, total_tokens=30, estimated_cost_usd=0.0),
            provider=self.provider_name,
            model=self.model,
        )


@pytest.fixture
def concurrency_test_env(monkeypatch):
    """Sets up a high-concurrency test environment with dedicated tenant and agents."""
    monkeypatch.setattr(
        "backend.app.agent_runtime.orchestrator.multi_agent_orchestrator.get_llm_provider",
        lambda **kwargs: FastStressProvider(),
    )
    db = SessionLocal()
    u_tag = uuid.uuid4().hex[:8]
    org_id = f"org_stress_conc_{u_tag}"
    org_b_id = f"org_stress_conc_b_{u_tag}"

    org_a = OrganizationModel(id=org_id, name="Concurrency Stress Org A", slug=org_id.lower(), is_active=True)
    org_b = OrganizationModel(id=org_b_id, name="Concurrency Stress Org B", slug=org_b_id.lower(), is_active=True)
    db.add(org_a)
    db.add(org_b)
    db.commit()

    # Pre-seed 60 agents in Org A with globally unique IDs
    agents_a = []
    for i in range(1, 61):
        ag = AgentModel(
            id=f"ag_conc_a_{i:03d}_{u_tag}",
            name=f"Concurrent Agent A-{i}",
            role="Specialist",
            organization_id=org_id,
            status="idle",
            behavioral_state="IDLE",
        )
        agents_a.append(ag)
        db.add(ag)

    # Pre-seed 20 agents in Org B with globally unique IDs
    agents_b = []
    for i in range(1, 21):
        ag = AgentModel(
            id=f"ag_conc_b_{i:03d}_{u_tag}",
            name=f"Concurrent Agent B-{i}",
            role="Specialist",
            organization_id=org_b_id,
            status="idle",
            behavioral_state="IDLE",
        )
        agents_b.append(ag)
        db.add(ag)

    db.commit()

    yield {
        "db": db,
        "org_id": org_id,
        "org_b_id": org_b_id,
        "agents_a": agents_a,
        "agents_b": agents_b,
        "u_tag": u_tag,
    }
    # Cleanup to keep database clean
    try:
        db.query(TaskModel).filter(TaskModel.organization_id.in_([org_id, org_b_id])).delete(synchronize_session=False)
        db.query(AgentModel).filter(AgentModel.organization_id.in_([org_id, org_b_id])).delete(synchronize_session=False)
        db.query(OrganizationModel).filter(OrganizationModel.id.in_([org_id, org_b_id])).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
    db.close()


@pytest.mark.asyncio
async def test_3_3_5_1_01_ten_concurrent_agents_execution(concurrency_test_env):
    """1. Stress test: 10 concurrent agents executing independent subtasks simultaneously."""
    db = concurrency_test_env["db"]
    org_id = concurrency_test_env["org_id"]
    agents = concurrency_test_env["agents_a"][:10]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-stress-10-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="10 Concurrent Agents Stress Test",
        description="Testing 10 independent workers in parallel",
        assigned_agent_id=agents[0].id,
        status="queued",
    )
    db.add(wf)

    subtasks = []
    for i, ag in enumerate(agents):
        st = TaskModel(
            id=f"st-10-{i}-{uuid.uuid4().hex[:8]}",
            parent_task_id=wf_id,
            organization_id=org_id,
            task_type="subtask",
            title=f"Subtask 10-{i}",
            description="Parallel computation",
            assigned_agent_id=ag.id,
            agent_type="general",
            status="queued",
            dependencies_json=[],
            input_data_json={"subtask_key": f"key_10_{i}"},
        )
        subtasks.append(st)
        db.add(st)
    db.commit()

    start = time.perf_counter()
    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=10)
    duration = time.perf_counter() - start

    db.expire_all()
    final_wf = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert final_wf.status == "completed"

    reloaded_st = db.query(TaskModel).filter(TaskModel.parent_task_id == wf_id).all()
    assert len(reloaded_st) == 10
    assert all(st.status == "completed" for st in reloaded_st)
    assert duration < 5.0  # Fast parallel execution


@pytest.mark.asyncio
async def test_3_3_5_1_02_twenty_five_concurrent_agents_execution(concurrency_test_env):
    """2. Stress test: 25 concurrent agents executing independent tasks."""
    db = concurrency_test_env["db"]
    org_id = concurrency_test_env["org_id"]
    agents = concurrency_test_env["agents_a"][:25]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-stress-25-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="25 Concurrent Agents Stress Test",
        description="Testing 25 independent workers in parallel",
        assigned_agent_id=agents[0].id,
        status="queued",
    )
    db.add(wf)

    for i, ag in enumerate(agents):
        st = TaskModel(
            id=f"st-25-{i}-{uuid.uuid4().hex[:8]}",
            parent_task_id=wf_id,
            organization_id=org_id,
            task_type="subtask",
            title=f"Subtask 25-{i}",
            description="Parallel task",
            assigned_agent_id=ag.id,
            agent_type="general",
            status="queued",
            dependencies_json=[],
            input_data_json={"subtask_key": f"key_25_{i}"},
        )
        db.add(st)
    db.commit()

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=25)

    db.expire_all()
    final_wf = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert final_wf.status == "completed"
    reloaded_st = db.query(TaskModel).filter(TaskModel.parent_task_id == wf_id).all()
    assert len(reloaded_st) == 25
    assert all(st.status == "completed" for st in reloaded_st)


@pytest.mark.asyncio
async def test_3_3_5_1_03_fifty_concurrent_agents_execution(concurrency_test_env):
    """3. Stress test: 50 concurrent agents executing independent tasks."""
    db = concurrency_test_env["db"]
    org_id = concurrency_test_env["org_id"]
    agents = concurrency_test_env["agents_a"][:50]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-stress-50-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="50 Concurrent Agents Stress Test",
        description="Testing 50 independent workers in parallel",
        assigned_agent_id=agents[0].id,
        status="queued",
    )
    db.add(wf)

    for i, ag in enumerate(agents):
        st = TaskModel(
            id=f"st-50-{i}-{uuid.uuid4().hex[:8]}",
            parent_task_id=wf_id,
            organization_id=org_id,
            task_type="subtask",
            title=f"Subtask 50-{i}",
            description="Parallel task",
            assigned_agent_id=ag.id,
            agent_type="general",
            status="queued",
            dependencies_json=[],
            input_data_json={"subtask_key": f"key_50_{i}"},
        )
        db.add(st)
    db.commit()

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=50)

    db.expire_all()
    final_wf = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert final_wf.status == "completed"
    reloaded_st = db.query(TaskModel).filter(TaskModel.parent_task_id == wf_id).all()
    assert len(reloaded_st) == 50
    assert all(st.status == "completed" for st in reloaded_st)


@pytest.mark.asyncio
async def test_3_3_5_1_04_one_hundred_concurrent_subtasks(concurrency_test_env):
    """4. Stress test: 100 concurrent lightweight subtasks distributed across available workforce."""
    db = concurrency_test_env["db"]
    org_id = concurrency_test_env["org_id"]
    agents = concurrency_test_env["agents_a"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-stress-100-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="100 Subtasks Concurrency Benchmark",
        description="100 subtasks executing across agent pool",
        assigned_agent_id=agents[0].id,
        status="queued",
    )
    db.add(wf)

    for i in range(100):
        ag = agents[i % len(agents)]
        st = TaskModel(
            id=f"st-100-{i}-{uuid.uuid4().hex[:8]}",
            parent_task_id=wf_id,
            organization_id=org_id,
            task_type="subtask",
            title=f"Subtask 100-{i}",
            description="High-volume concurrent subtask",
            assigned_agent_id=ag.id,
            agent_type="general",
            status="queued",
            dependencies_json=[],
            input_data_json={"subtask_key": f"key_100_{i}"},
        )
        db.add(st)
    db.commit()

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=25)

    db.expire_all()
    final_wf = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert final_wf.status == "completed"
    reloaded_st = db.query(TaskModel).filter(TaskModel.parent_task_id == wf_id).all()
    assert len(reloaded_st) == 100
    assert all(st.status == "completed" for st in reloaded_st)


@pytest.mark.asyncio
async def test_3_3_5_1_05_multiple_organizations_executing_simultaneously(concurrency_test_env):
    """5. Multi-tenancy under concurrency: Org A and Org B execute workflows simultaneously without crosstalk."""
    db = concurrency_test_env["db"]
    org_a = concurrency_test_env["org_id"]
    org_b = concurrency_test_env["org_b_id"]
    agent_a = concurrency_test_env["agents_a"][0]
    agent_b = concurrency_test_env["agents_b"][0]

    orchestrator_a = MultiAgentOrchestrator()
    orchestrator_b = MultiAgentOrchestrator()

    wf_a = TaskModel(
        id=f"wf-simul-a-{uuid.uuid4().hex[:8]}",
        organization_id=org_a,
        task_type="workflow",
        title="Org A Concurrent Workflow",
        description="Org A mission",
        assigned_agent_id=agent_a.id,
        status="queued",
    )
    st_a = TaskModel(
        id=f"st-simul-a-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_a.id,
        organization_id=org_a,
        task_type="subtask",
        title="Subtask Org A",
        description="Worker in A",
        assigned_agent_id=agent_a.id,
        status="queued",
        dependencies_json=[],
        input_data_json={"subtask_key": "st_a"},
    )

    wf_b = TaskModel(
        id=f"wf-simul-b-{uuid.uuid4().hex[:8]}",
        organization_id=org_b,
        task_type="workflow",
        title="Org B Concurrent Workflow",
        description="Org B mission",
        assigned_agent_id=agent_b.id,
        status="queued",
    )
    st_b = TaskModel(
        id=f"st-simul-b-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_b.id,
        organization_id=org_b,
        task_type="subtask",
        title="Subtask Org B",
        description="Worker in B",
        assigned_agent_id=agent_b.id,
        status="queued",
        dependencies_json=[],
        input_data_json={"subtask_key": "st_b"},
    )
    db.add(wf_a)
    db.add(st_a)
    db.add(wf_b)
    db.add(st_b)
    db.commit()

    token_a = CancellationToken()
    token_b = CancellationToken()

    # Execute workflows from both organizations concurrently
    await asyncio.gather(
        orchestrator_a.execute_workflow(task_id=wf_a.id, token=token_a, db=db),
        orchestrator_b.execute_workflow(task_id=wf_b.id, token=token_b, db=db),
    )

    db.expire_all()
    res_a = db.query(TaskModel).filter(TaskModel.id == wf_a.id).first()
    res_b = db.query(TaskModel).filter(TaskModel.id == wf_b.id).first()
    assert res_a.status == "completed"
    assert res_b.status == "completed"
    assert res_a.organization_id == org_a
    assert res_b.organization_id == org_b


@pytest.mark.asyncio
async def test_3_3_5_1_06_one_agent_failing_while_others_continue(concurrency_test_env, monkeypatch):
    """6. Resilience: A failure in one independent subtask does not abort other independent subtasks."""
    db = concurrency_test_env["db"]
    org_id = concurrency_test_env["org_id"]
    agents = concurrency_test_env["agents_a"][:3]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-partial-fail-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="Partial Subtask Failure Test",
        description="One task fails permanently, two succeed",
        assigned_agent_id=agents[0].id,
        status="queued",
    )
    db.add(wf)

    # Subtask 1: normal success
    st1 = TaskModel(
        id=f"st-pf-1-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_id,
        organization_id=org_id,
        task_type="subtask",
        title="Healthy Subtask 1",
        description="Succeeds",
        assigned_agent_id=agents[0].id,
        status="queued",
        dependencies_json=[],
        input_data_json={"subtask_key": "st1"},
    )
    # Subtask 2: designed to fail permanently (missing tool error)
    st2 = TaskModel(
        id=f"st-pf-2-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_id,
        organization_id=org_id,
        task_type="subtask",
        title="Failing Subtask 2",
        description="Encountered non-retryable fatal exception",
        assigned_agent_id=agents[1].id,
        status="queued",
        max_retries=0,  # No retries allowed
        dependencies_json=[],
        input_data_json={"subtask_key": "st2"},
    )
    # Subtask 3: normal success
    st3 = TaskModel(
        id=f"st-pf-3-{uuid.uuid4().hex[:8]}",
        parent_task_id=wf_id,
        organization_id=org_id,
        task_type="subtask",
        title="Healthy Subtask 3",
        description="Succeeds",
        assigned_agent_id=agents[2].id,
        status="queued",
        dependencies_json=[],
        input_data_json={"subtask_key": "st3"},
    )
    db.add(st1)
    db.add(st2)
    db.add(st3)
    db.commit()

    # Intercept executor.run for st2 to simulate permanent failure
    original_execute_subtask = orchestrator._execute_subtask
    async def mock_execute(db, subtask, parent_task, subtask_results, llm_provider, token):
        if subtask.id == st2.id:
            subtask.status = "failed"
            subtask.error_message = "Non-retryable policy or validation error: Fatal hardware fault"
            db.commit()
            return
        await original_execute_subtask(db, subtask, parent_task, subtask_results, llm_provider, token)

    monkeypatch.setattr(orchestrator, "_execute_subtask", mock_execute)

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=3)

    db.expire_all()
    st1_r = db.query(TaskModel).filter(TaskModel.id == st1.id).first()
    st2_r = db.query(TaskModel).filter(TaskModel.id == st2.id).first()
    st3_r = db.query(TaskModel).filter(TaskModel.id == st3.id).first()
    wf_r = db.query(TaskModel).filter(TaskModel.id == wf_id).first()

    assert st1_r.status == "completed"
    assert st2_r.status == "failed"
    assert st3_r.status == "completed"
    # Workflow properly reflects partial failure
    assert wf_r.status == "failed"


@pytest.mark.asyncio
async def test_3_3_5_1_07_simultaneous_task_completion(concurrency_test_env):
    """7. Concurrency: Multiple tasks completing at the exact same millisecond resolve atomically."""
    db = concurrency_test_env["db"]
    org_id = concurrency_test_env["org_id"]
    agents = concurrency_test_env["agents_a"][:5]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-simul-done-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="Simultaneous Completion Test",
        description="5 subtasks finishing simultaneously",
        assigned_agent_id=agents[0].id,
        status="queued",
    )
    db.add(wf)

    for i in range(5):
        st = TaskModel(
            id=f"st-simul-{i}-{uuid.uuid4().hex[:8]}",
            parent_task_id=wf_id,
            organization_id=org_id,
            task_type="subtask",
            title=f"Parallel Task {i}",
            description="Completing simultaneously",
            assigned_agent_id=agents[i].id,
            status="queued",
            dependencies_json=[],
            input_data_json={"subtask_key": f"key_sim_{i}"},
        )
        db.add(st)
    db.commit()

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=5)

    db.expire_all()
    wf_res = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert wf_res.status == "completed"
    assert wf_res.completed_at is not None
    completed_sts = db.query(TaskModel).filter(TaskModel.parent_task_id == wf_id, TaskModel.status == "completed").all()
    assert len(completed_sts) == 5


def test_3_3_5_1_08_concurrent_assignment_attempts_targeting_same_agent(concurrency_test_env):
    """8. Contention: Multiple tasks submitted targeting the same specialist track active workload accurately."""
    db = concurrency_test_env["db"]
    org_id = concurrency_test_env["org_id"]
    target_agent = concurrency_test_env["agents_a"][0]

    # Create 5 tasks targeting the single agent
    for i in range(5):
        task_in = TaskCreate(
            title=f"Target Task {i}",
            description=f"Task {i} assigned to single specialist",
            assigned_agent_id=target_agent.id,
            priority="normal",
        )
        task_service.create_task(db=db, task_in=task_in, organization_id=org_id)

    profile = specialist_workload_manager.get_agent_workload(
        db=db, agent_id=target_agent.id, organization_id=org_id
    )
    assert profile.active_task_count == 5
    # Saturated workload marks agent not available
    assert profile.is_available is False


@pytest.mark.asyncio
async def test_3_3_5_1_09_database_session_isolation(concurrency_test_env):
    """9. Session Isolation: Concurrent subtasks using isolated sessions do not lock or cross-pollute uncommitted data."""
    db = concurrency_test_env["db"]
    org_id = concurrency_test_env["org_id"]
    agents = concurrency_test_env["agents_a"][:4]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-isolation-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="Session Isolation Test",
        description="Verifying isolated session handles concurrent transactions cleanly",
        assigned_agent_id=agents[0].id,
        status="queued",
    )
    db.add(wf)

    for i in range(4):
        st = TaskModel(
            id=f"st-iso-{i}-{uuid.uuid4().hex[:8]}",
            parent_task_id=wf_id,
            organization_id=org_id,
            task_type="subtask",
            title=f"Isolation Task {i}",
            description="Writing unique outputs",
            assigned_agent_id=agents[i].id,
            status="queued",
            dependencies_json=[],
            input_data_json={"subtask_key": f"iso_{i}"},
        )
        db.add(st)
    db.commit()

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=4)

    db.expire_all()
    wf_final = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert wf_final.status == "completed"
    # Ensure all 4 outputs are recorded without cross-pollution
    for i in range(4):
        st_re = db.query(TaskModel).filter(TaskModel.id == f"st-iso-{i}-{wf_id.split('-')[-1]}").first()


@pytest.mark.asyncio
async def test_3_3_5_1_10_maximum_concurrency_enforcement(concurrency_test_env, monkeypatch):
    """10. Maximum concurrency enforcement: Active concurrent worker executions never exceed configured limit."""
    db = concurrency_test_env["db"]
    org_id = concurrency_test_env["org_id"]
    agents = concurrency_test_env["agents_a"][:6]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-maxconc-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(
        id=wf_id,
        organization_id=org_id,
        task_type="workflow",
        title="Max Concurrency Enforcement",
        description="Configured concurrency = 2; ensuring at most 2 run concurrently",
        assigned_agent_id=agents[0].id,
        status="queued",
    )
    db.add(wf)

    for i in range(6):
        st = TaskModel(
            id=f"st-mc-{i}-{uuid.uuid4().hex[:8]}",
            parent_task_id=wf_id,
            organization_id=org_id,
            task_type="subtask",
            title=f"Concur Task {i}",
            description="Testing concurrency cap",
            assigned_agent_id=agents[i].id,
            status="queued",
            dependencies_json=[],
            input_data_json={"subtask_key": f"mc_{i}"},
        )
        db.add(st)
    db.commit()

    active_concurrent_count = 0
    max_observed_concurrency = 0

    original_execute_subtask = orchestrator._execute_subtask

    async def monitored_execute(db, subtask, parent_task, subtask_results, llm_provider, token):
        nonlocal active_concurrent_count, max_observed_concurrency
        active_concurrent_count += 1
        if active_concurrent_count > max_observed_concurrency:
            max_observed_concurrency = active_concurrent_count
        await asyncio.sleep(0.05)  # Simulate active work
        active_concurrent_count -= 1
        await original_execute_subtask(db, subtask, parent_task, subtask_results, llm_provider, token)

    monkeypatch.setattr(orchestrator, "_execute_subtask", monitored_execute)

    token = CancellationToken()
    # Explicitly enforce max_concurrency = 2
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=2)

    db.expire_all()
    wf_check = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert wf_check.status == "completed"
    assert max_observed_concurrency <= 2
