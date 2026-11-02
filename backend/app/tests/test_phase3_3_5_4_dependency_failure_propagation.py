import asyncio
import uuid
import pytest
from datetime import datetime, timezone
from typing import Dict, Any

from backend.app.core.database import SessionLocal
from backend.app.models.agent import AgentModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.task import TaskModel
from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.orchestrator.multi_agent_orchestrator import MultiAgentOrchestrator
from backend.app.agent_runtime.planner.multi_agent_planner import DAGValidationError
from backend.app.agent_runtime.llm.base import (
    LLMProvider,
    LLMResponse,
    LLMHealthCheckResult,
    LLMUsage,
    ToolCallRequest,
)


class DependencyTestProvider(LLMProvider):
    provider_name = "dep_test"
    model = "dep-v1"
    is_live_provider = False

    def __init__(self):
        self.executed_tasks = []

    async def check_health(self):
        return LLMHealthCheckResult(healthy=True, provider=self.provider_name, model=self.model)

    async def generate(self, messages, *, tools=None, temperature=0.2):
        has_tool_res = any(m.get("role") == "tool" for m in messages)
        if not has_tool_res and tools:
            return LLMResponse(
                content=None,
                tool_calls=[ToolCallRequest(tool_name="calculator", arguments={"expression": "1 + 1"}, call_id="call_dep_1")],
                usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20, estimated_cost_usd=0.0),
                provider=self.provider_name,
                model=self.model,
            )
        return LLMResponse(
            content="Task completed successfully.",
            tool_calls=[],
            usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20, estimated_cost_usd=0.0),
            provider=self.provider_name,
            model=self.model,
        )


@pytest.fixture
def dep_env(monkeypatch):
    test_provider = DependencyTestProvider()
    monkeypatch.setattr(
        "backend.app.agent_runtime.orchestrator.multi_agent_orchestrator.get_llm_provider",
        lambda **kwargs: test_provider,
    )
    db = SessionLocal()
    u_tag = uuid.uuid4().hex[:8]
    org_id = f"org_dep_{u_tag}"
    org = OrganizationModel(id=org_id, name="Dependency Test Org", slug=org_id.lower(), is_active=True)
    db.add(org)

    agents = []
    for i in range(1, 10):
        ag = AgentModel(
            id=f"ag_dep_{i}_{u_tag}",
            name=f"Dep Agent {i}",
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
        "provider": test_provider,
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
async def test_3_3_5_4_01_linear_chain_dependency_failure(dep_env, monkeypatch):
    """1. Linear chain dependency (A -> B -> C): A fails; B and C fail transitively without executing."""
    db = dep_env["db"]
    org_id = dep_env["org_id"]
    agents = dep_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-lin-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Linear Fail Chain", description="A -> B -> C", assigned_agent_id=agents[0].id, status="queued")
    st_a = TaskModel(id=f"st-a-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask A", description="Root task", assigned_agent_id=agents[0].id, agent_type="general", status="queued", dependencies_json=[], input_data_json={"subtask_key": "step_a"}, max_retries=0)
    st_b = TaskModel(id=f"st-b-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask B", description="Depends on A", assigned_agent_id=agents[1].id, agent_type="general", status="pending", dependencies_json=["step_a"], input_data_json={"subtask_key": "step_b"}, max_retries=0)
    st_c = TaskModel(id=f"st-c-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask C", description="Depends on B", assigned_agent_id=agents[2].id, agent_type="general", status="pending", dependencies_json=["step_b"], input_data_json={"subtask_key": "step_c"}, max_retries=0)

    db.add(wf)
    db.add(st_a)
    db.add(st_b)
    db.add(st_c)
    db.commit()

    # Force subtask A to fail
    executed_subtasks = []
    original_execute = orchestrator._execute_subtask

    async def mock_execute(db, subtask, parent_task, subtask_results, llm_provider, token):
        executed_subtasks.append(subtask.id)
        if subtask.id == st_a.id:
            subtask.status = "failed"
            subtask.error_message = "Non-retryable root error in Task A"
            db.commit()
            return
        await original_execute(db, subtask, parent_task, subtask_results, llm_provider, token)

    monkeypatch.setattr(orchestrator, "_execute_subtask", mock_execute)

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db)

    db.expire_all()
    res_a = db.query(TaskModel).filter(TaskModel.id == st_a.id).first()
    res_b = db.query(TaskModel).filter(TaskModel.id == st_b.id).first()
    res_c = db.query(TaskModel).filter(TaskModel.id == st_c.id).first()
    res_wf = db.query(TaskModel).filter(TaskModel.id == wf_id).first()

    assert res_a.status == "failed"
    assert res_b.status == "failed"
    assert "dependency failed" in res_b.error_message.lower()
    assert res_c.status == "failed"
    assert "dependency failed" in res_c.error_message.lower()
    assert res_wf.status == "failed"

    # Crucial: B and C were NEVER executed!
    assert executed_subtasks == [st_a.id]


@pytest.mark.asyncio
async def test_3_3_5_4_02_diamond_dependency_failure(dep_env, monkeypatch):
    """2. Diamond dependency (A -> B, A -> C, B & C -> D): B fails, C succeeds; D does not execute and fails."""
    db = dep_env["db"]
    org_id = dep_env["org_id"]
    agents = dep_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-diam-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Diamond Fail", description="Diamond pattern", assigned_agent_id=agents[0].id, status="queued")
    st_a = TaskModel(id=f"st-da-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask A", description="Root", assigned_agent_id=agents[0].id, agent_type="general", status="queued", dependencies_json=[], input_data_json={"subtask_key": "step_a"}, max_retries=0)
    st_b = TaskModel(id=f"st-db-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask B", description="Left branch", assigned_agent_id=agents[1].id, agent_type="general", status="pending", dependencies_json=["step_a"], input_data_json={"subtask_key": "step_b"}, max_retries=0)
    st_c = TaskModel(id=f"st-dc-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask C", description="Right branch", assigned_agent_id=agents[2].id, agent_type="general", status="pending", dependencies_json=["step_a"], input_data_json={"subtask_key": "step_c"}, max_retries=0)
    st_d = TaskModel(id=f"st-dd-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask D", description="Convergence", assigned_agent_id=agents[3].id, agent_type="general", status="pending", dependencies_json=["step_b", "step_c"], input_data_json={"subtask_key": "step_d"}, max_retries=0)

    db.add(wf)
    db.add(st_a)
    db.add(st_b)
    db.add(st_c)
    db.add(st_d)
    db.commit()

    executed = []
    original_execute = orchestrator._execute_subtask

    async def mock_execute(db, subtask, parent_task, subtask_results, llm_provider, token):
        executed.append(subtask.id)
        if subtask.id == st_b.id:
            subtask.status = "failed"
            subtask.error_message = "Branch B failed"
            db.commit()
            return
        await original_execute(db, subtask, parent_task, subtask_results, llm_provider, token)

    monkeypatch.setattr(orchestrator, "_execute_subtask", mock_execute)

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=4)

    db.expire_all()
    res_a = db.query(TaskModel).filter(TaskModel.id == st_a.id).first()
    res_b = db.query(TaskModel).filter(TaskModel.id == st_b.id).first()
    res_c = db.query(TaskModel).filter(TaskModel.id == st_c.id).first()
    res_d = db.query(TaskModel).filter(TaskModel.id == st_d.id).first()

    assert res_a.status == "completed"
    assert res_b.status == "failed"
    assert res_c.status == "completed"
    assert res_d.status == "failed"
    assert "dependency failed" in res_d.error_message.lower()

    # D was never executed because prerequisite B failed
    assert st_d.id not in executed


@pytest.mark.asyncio
async def test_3_3_5_4_03_transient_failure_then_retry_success(dep_env, monkeypatch):
    """3. Transient vs permanent dependency failure: A fails once, retries and succeeds; downstream B proceeds."""
    db = dep_env["db"]
    org_id = dep_env["org_id"]
    agents = dep_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-retry-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Transient Retry Flow", description="A retries then B runs", assigned_agent_id=agents[0].id, status="queued")
    st_a = TaskModel(id=f"st-ra-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask A", description="Transient failure task", assigned_agent_id=agents[0].id, agent_type="general", status="queued", dependencies_json=[], input_data_json={"subtask_key": "step_a"}, retry_count=0, max_retries=2)
    st_b = TaskModel(id=f"st-rb-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask B", description="Downstream task", assigned_agent_id=agents[1].id, agent_type="general", status="pending", dependencies_json=["step_a"], input_data_json={"subtask_key": "step_b"}, max_retries=1)

    db.add(wf)
    db.add(st_a)
    db.add(st_b)
    db.commit()

    attempt_count = 0
    original_execute = orchestrator._execute_subtask

    async def mock_execute(db, subtask, parent_task, subtask_results, llm_provider, token):
        nonlocal attempt_count
        if subtask.id == st_a.id:
            attempt_count += 1
            if attempt_count == 1:
                # First attempt fails transiently and is re-queued by retry policy
                subtask.status = "queued"
                subtask.retry_count = 1
                db.commit()
                return
        await original_execute(db, subtask, parent_task, subtask_results, llm_provider, token)

    monkeypatch.setattr(orchestrator, "_execute_subtask", mock_execute)

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db)

    db.expire_all()
    res_a = db.query(TaskModel).filter(TaskModel.id == st_a.id).first()
    res_b = db.query(TaskModel).filter(TaskModel.id == st_b.id).first()

    assert res_a.status == "completed"
    assert res_b.status == "completed"
    assert attempt_count >= 2


@pytest.mark.asyncio
async def test_3_3_5_4_04_preflight_cycle_rejection(dep_env):
    """4. Pre-flight DAG validation detects cycles: cyclical dependency (A -> B -> C -> A) rejected before execution."""
    db = dep_env["db"]
    org_id = dep_env["org_id"]
    agents = dep_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-cyc-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Cycle Workflow", description="Circular DAG", assigned_agent_id=agents[0].id, status="queued")
    st_a = TaskModel(id=f"st-ca-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask A", description="In cycle", assigned_agent_id=agents[0].id, agent_type="general", status="pending", dependencies_json=["step_c"], input_data_json={"subtask_key": "step_a"})
    st_b = TaskModel(id=f"st-cb-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask B", description="In cycle", assigned_agent_id=agents[1].id, agent_type="general", status="pending", dependencies_json=["step_a"], input_data_json={"subtask_key": "step_b"})
    st_c = TaskModel(id=f"st-cc-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask C", description="In cycle", assigned_agent_id=agents[2].id, agent_type="general", status="pending", dependencies_json=["step_b"], input_data_json={"subtask_key": "step_c"})

    db.add(wf)
    db.add(st_a)
    db.add(st_b)
    db.add(st_c)
    db.commit()

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db)

    db.expire_all()
    res_wf = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    # Cycle was caught in pre-flight: workflow terminated as failed
    assert res_wf.status == "failed"
    assert "circular dependency" in res_wf.error_message.lower()


@pytest.mark.asyncio
async def test_3_3_5_4_05_self_dependency_rejection(dep_env):
    """5. Self-dependency rejected: subtask depending on itself rejected."""
    db = dep_env["db"]
    org_id = dep_env["org_id"]
    agents = dep_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-self-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Self Dep Workflow", description="Self loop", assigned_agent_id=agents[0].id, status="queued")
    st_self = TaskModel(id=f"st-self-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Self Dep Task", description="Depends on itself", assigned_agent_id=agents[0].id, agent_type="general", status="pending", dependencies_json=["step_self"], input_data_json={"subtask_key": "step_self"})

    db.add(wf)
    db.add(st_self)
    db.commit()

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db)

    db.expire_all()
    res_wf = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert res_wf.status == "failed"
    assert "self-dependency" in res_wf.error_message.lower()


@pytest.mark.asyncio
async def test_3_3_5_4_06_nonexistent_dependency_rejection(dep_env):
    """6. Non-existent dependency rejected: subtask depending on a key that does not exist in the workflow rejected."""
    db = dep_env["db"]
    org_id = dep_env["org_id"]
    agents = dep_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-dangle-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Dangling Dep Workflow", description="Non-existent key", assigned_agent_id=agents[0].id, status="queued")
    st_dangle = TaskModel(id=f"st-dang-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Dangling Task", description="Depends on non-existent ghost step", assigned_agent_id=agents[0].id, agent_type="general", status="pending", dependencies_json=["step_ghost_xyz"], input_data_json={"subtask_key": "step_dangle"})

    db.add(wf)
    db.add(st_dangle)
    db.commit()

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db)

    db.expire_all()
    res_wf = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    assert res_wf.status == "failed"
    assert "non-existent" in res_wf.error_message.lower()


@pytest.mark.asyncio
async def test_3_3_5_4_07_independent_branch_execution_continues(dep_env, monkeypatch):
    """7. Independent branch execution continues: Root A fails; independent Root B and child D continue to completion."""
    db = dep_env["db"]
    org_id = dep_env["org_id"]
    agents = dep_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-indep-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Independent Branches", description="Branch A and Branch B", assigned_agent_id=agents[0].id, status="queued")
    # Branch 1: A -> C (A fails, C aborted)
    st_a = TaskModel(id=f"st-ia-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Root A", description="Branch 1 Root", assigned_agent_id=agents[0].id, agent_type="general", status="queued", dependencies_json=[], input_data_json={"subtask_key": "step_a"}, max_retries=0)
    st_c = TaskModel(id=f"st-ic-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Child C", description="Branch 1 Child", assigned_agent_id=agents[1].id, agent_type="general", status="pending", dependencies_json=["step_a"], input_data_json={"subtask_key": "step_c"}, max_retries=0)
    # Branch 2: B -> D (B succeeds, D succeeds)
    st_b = TaskModel(id=f"st-ib-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Root B", description="Branch 2 Root", assigned_agent_id=agents[2].id, agent_type="general", status="queued", dependencies_json=[], input_data_json={"subtask_key": "step_b"}, max_retries=0)
    st_d = TaskModel(id=f"st-id-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Child D", description="Branch 2 Child", assigned_agent_id=agents[3].id, agent_type="general", status="pending", dependencies_json=["step_b"], input_data_json={"subtask_key": "step_d"}, max_retries=0)

    db.add(wf)
    db.add(st_a)
    db.add(st_b)
    db.add(st_c)
    db.add(st_d)
    db.commit()

    original_execute = orchestrator._execute_subtask
    async def mock_execute(db, subtask, parent_task, subtask_results, llm_provider, token):
        if subtask.id == st_a.id:
            subtask.status = "failed"
            subtask.error_message = "Branch 1 root failed"
            db.commit()
            return
        await original_execute(db, subtask, parent_task, subtask_results, llm_provider, token)

    monkeypatch.setattr(orchestrator, "_execute_subtask", mock_execute)

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=4)

    db.expire_all()
    res_a = db.query(TaskModel).filter(TaskModel.id == st_a.id).first()
    res_b = db.query(TaskModel).filter(TaskModel.id == st_b.id).first()
    res_c = db.query(TaskModel).filter(TaskModel.id == st_c.id).first()
    res_d = db.query(TaskModel).filter(TaskModel.id == st_d.id).first()

    assert res_a.status == "failed"
    assert res_c.status == "failed"  # Dependent of A aborted
    assert res_b.status == "completed"  # Independent B succeeded
    assert res_d.status == "completed"  # Child D of B succeeded


@pytest.mark.asyncio
async def test_3_3_5_4_08_dependency_output_propagation(dep_env, monkeypatch):
    """8. Dependency output propagation: verified deliverables from Task A are passed into Task B's context."""
    db = dep_env["db"]
    org_id = dep_env["org_id"]
    agents = dep_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-prop-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Output Prop Test", description="A gives output to B", assigned_agent_id=agents[0].id, status="queued")
    st_a = TaskModel(id=f"st-pa-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask A", description="Generate research finding", assigned_agent_id=agents[0].id, agent_type="general", status="queued", dependencies_json=[], input_data_json={"subtask_key": "step_a"})
    st_b = TaskModel(id=f"st-pb-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask B", description="Consume research finding", assigned_agent_id=agents[1].id, agent_type="general", status="pending", dependencies_json=["step_a"], input_data_json={"subtask_key": "step_b"})

    db.add(wf)
    db.add(st_a)
    db.add(st_b)
    db.commit()

    received_prompts = []
    original_execute = orchestrator._execute_subtask

    async def mock_execute(db, subtask, parent_task, subtask_results, llm_provider, token):
        if subtask.id == st_b.id:
            # Check upstream subtask_results passed to B
            assert "step_a" in subtask_results
            contract_a = subtask_results["step_a"]
            assert contract_a.status == "completed"
            assert contract_a.output is not None
        await original_execute(db, subtask, parent_task, subtask_results, llm_provider, token)

    monkeypatch.setattr(orchestrator, "_execute_subtask", mock_execute)

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db)

    db.expire_all()
    assert db.query(TaskModel).filter(TaskModel.id == st_b.id).first().status == "completed"


@pytest.mark.asyncio
async def test_3_3_5_4_09_cancellation_propagation(dep_env, monkeypatch):
    """9. Cancellation propagation: user cancels parent workflow; all pending and running subtasks transition to cancelled."""
    db = dep_env["db"]
    org_id = dep_env["org_id"]
    agents = dep_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-abort-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Cancellation Test", description="Abort midway", assigned_agent_id=agents[0].id, status="queued")
    st1 = TaskModel(id=f"st-ab1-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask 1", description="In progress", assigned_agent_id=agents[0].id, agent_type="general", status="queued", dependencies_json=[], input_data_json={"subtask_key": "st1"})
    st2 = TaskModel(id=f"st-ab2-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask 2", description="Pending", assigned_agent_id=agents[1].id, agent_type="general", status="pending", dependencies_json=["st1"], input_data_json={"subtask_key": "st2"})

    db.add(wf)
    db.add(st1)
    db.add(st2)
    db.commit()

    token = CancellationToken()

    async def mock_execute(db, subtask, parent_task, subtask_results, llm_provider, token):
        # Trigger cancellation while subtask 1 is running
        token.cancel("User aborted workflow")
        token.check()

    monkeypatch.setattr(orchestrator, "_execute_subtask", mock_execute)

    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db)

    db.expire_all()
    wf_r = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    st1_r = db.query(TaskModel).filter(TaskModel.id == st1.id).first()
    st2_r = db.query(TaskModel).filter(TaskModel.id == st2.id).first()

    assert wf_r.status == "cancelled"
    assert st1_r.status == "cancelled"
    assert st2_r.status == "cancelled"


@pytest.mark.asyncio
async def test_3_3_5_4_10_partial_workflow_completion_status(dep_env, monkeypatch):
    """10. Partial workflow completion: 2 subtasks succeed and 1 leaf subtask fails; workflow finalizes as failed with audit."""
    db = dep_env["db"]
    org_id = dep_env["org_id"]
    agents = dep_env["agents"]

    orchestrator = MultiAgentOrchestrator()
    wf_id = f"wf-part-{uuid.uuid4().hex[:8]}"
    wf = TaskModel(id=wf_id, organization_id=org_id, task_type="workflow", title="Partial Success Flow", description="2 succeed, 1 fails", assigned_agent_id=agents[0].id, status="queued")
    st1 = TaskModel(id=f"st-p1-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask 1", description="Succeeds", assigned_agent_id=agents[0].id, agent_type="general", status="queued", dependencies_json=[], input_data_json={"subtask_key": "p1"})
    st2 = TaskModel(id=f"st-p2-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask 2", description="Succeeds", assigned_agent_id=agents[1].id, agent_type="general", status="queued", dependencies_json=[], input_data_json={"subtask_key": "p2"})
    st3 = TaskModel(id=f"st-p3-{uuid.uuid4().hex[:8]}", parent_task_id=wf_id, organization_id=org_id, task_type="subtask", title="Subtask 3", description="Fails", assigned_agent_id=agents[2].id, agent_type="general", status="queued", dependencies_json=[], input_data_json={"subtask_key": "p3"}, max_retries=0)

    db.add(wf)
    db.add(st1)
    db.add(st2)
    db.add(st3)
    db.commit()

    original_execute = orchestrator._execute_subtask
    async def mock_execute(db, subtask, parent_task, subtask_results, llm_provider, token):
        if subtask.id == st3.id:
            subtask.status = "failed"
            subtask.error_message = "Non-retryable leaf task error"
            db.commit()
            return
        await original_execute(db, subtask, parent_task, subtask_results, llm_provider, token)

    monkeypatch.setattr(orchestrator, "_execute_subtask", mock_execute)

    token = CancellationToken()
    await orchestrator.execute_workflow(task_id=wf_id, token=token, db=db, max_concurrency=3)

    db.expire_all()
    wf_r = db.query(TaskModel).filter(TaskModel.id == wf_id).first()
    st1_r = db.query(TaskModel).filter(TaskModel.id == st1.id).first()
    st2_r = db.query(TaskModel).filter(TaskModel.id == st2.id).first()
    st3_r = db.query(TaskModel).filter(TaskModel.id == st3.id).first()

    assert st1_r.status == "completed"
    assert st2_r.status == "completed"
    assert st3_r.status == "failed"
    # Workflow properly reflects failure
    assert wf_r.status == "failed"
    # Completed count is accurately recorded
    assert (wf_r.output_data_json or {}).get("completed_count") == 2
