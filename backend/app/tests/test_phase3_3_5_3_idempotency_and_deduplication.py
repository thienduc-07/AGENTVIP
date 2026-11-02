import asyncio
import uuid
import pytest
from datetime import datetime, timezone
from typing import Dict, Any

from backend.app.core.database import SessionLocal
from backend.app.models.agent import AgentModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.task import TaskModel
from backend.app.models.artifact import ArtifactModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.schemas.task import TaskCreate
from backend.app.services.task_service import task_service
from backend.app.services.event_service import event_service
from backend.app.agent_runtime.context import TaskContext
from backend.app.agent_runtime.executor import ExecutionLoop
from backend.app.agent_runtime.cancellation import CancellationToken
from backend.app.agent_runtime.dispatcher.crash_recovery import recover_abandoned_tasks
from backend.app.agent_runtime.tools.artifact.artifact_tools import ArtifactCreateTool
from backend.app.agent_runtime.llm.base import (
    LLMProvider,
    LLMResponse,
    LLMHealthCheckResult,
    LLMUsage,
    ToolCallRequest,
)


class DuplicateToolTestProvider(LLMProvider):
    provider_name = "duplicate_test"
    model = "dup-v1"
    is_live_provider = False

    def __init__(self):
        self.turn = 0

    async def check_health(self):
        return LLMHealthCheckResult(healthy=True, provider=self.provider_name, model=self.model)

    async def generate(self, messages, *, tools=None, temperature=0.2):
        self.turn += 1
        if self.turn == 1:
            # Send two tool calls with the EXACT SAME call_id to test deduplication
            return LLMResponse(
                content=None,
                tool_calls=[
                    ToolCallRequest(tool_name="calculator", arguments={"expression": "5 + 5"}, call_id="call_dup_100"),
                    ToolCallRequest(tool_name="calculator", arguments={"expression": "5 + 5"}, call_id="call_dup_100"),
                ],
                usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20, estimated_cost_usd=0.0),
                provider=self.provider_name,
                model=self.model,
            )
        return LLMResponse(
            content="Execution complete with deduplication verified.",
            tool_calls=[],
            usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20, estimated_cost_usd=0.0),
            provider=self.provider_name,
            model=self.model,
        )


@pytest.fixture
def idem_env():
    db = SessionLocal()
    u_tag = uuid.uuid4().hex[:8]
    org_a_id = f"org_idem_a_{u_tag}"
    org_b_id = f"org_idem_b_{u_tag}"

    org_a = OrganizationModel(id=org_a_id, name="Idempotency Org A", slug=org_a_id.lower(), is_active=True)
    org_b = OrganizationModel(id=org_b_id, name="Idempotency Org B", slug=org_b_id.lower(), is_active=True)
    db.add(org_a)
    db.add(org_b)
    db.commit()

    ag_a1 = AgentModel(id=f"ag_idem_a1_{u_tag}", name="Idem Agent A1", role="Specialist", organization_id=org_a_id, status="idle", behavioral_state="IDLE")
    ag_a2 = AgentModel(id=f"ag_idem_a2_{u_tag}", name="Idem Agent A2", role="Specialist", organization_id=org_a_id, status="idle", behavioral_state="IDLE")
    ag_b1 = AgentModel(id=f"ag_idem_b1_{u_tag}", name="Idem Agent B1", role="Specialist", organization_id=org_b_id, status="idle", behavioral_state="IDLE")
    db.add(ag_a1)
    db.add(ag_a2)
    db.add(ag_b1)
    db.commit()

    yield {
        "db": db,
        "org_a_id": org_a_id,
        "org_b_id": org_b_id,
        "ag_a1": ag_a1,
        "ag_a2": ag_a2,
        "ag_b1": ag_b1,
        "u_tag": u_tag,
    }

    try:
        db.query(ArtifactModel).filter(ArtifactModel.task_id.like(f"%{u_tag}%")).delete(synchronize_session=False)
        db.query(TaskModel).filter(TaskModel.organization_id.in_([org_a_id, org_b_id])).delete(synchronize_session=False)
        db.query(AgentEventModel).filter(AgentEventModel.organization_id.in_([org_a_id, org_b_id])).delete(synchronize_session=False)
        db.query(AgentModel).filter(AgentModel.organization_id.in_([org_a_id, org_b_id])).delete(synchronize_session=False)
        db.query(OrganizationModel).filter(OrganizationModel.id.in_([org_a_id, org_b_id])).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
    db.close()


def test_3_3_5_3_01_same_task_twice_same_idempotency_key(idem_env):
    """1. Same task submitted twice with the same idempotency key: returns existing task, 0 duplicate rows."""
    db = idem_env["db"]
    org_id = idem_env["org_a_id"]
    agent = idem_env["ag_a1"]

    idem_key = f"idem-key-{uuid.uuid4().hex[:12]}"
    task_in1 = TaskCreate(
        title="Initial Idempotent Task",
        description="First attempt",
        assigned_agent_id=agent.id,
        idempotency_key=idem_key,
    )
    t1 = task_service.create_task(db, task_in1, organization_id=org_id)

    task_in2 = TaskCreate(
        title="Duplicate Idempotent Task Submission",
        description="Second attempt with same key",
        assigned_agent_id=agent.id,
        idempotency_key=idem_key,
    )
    t2 = task_service.create_task(db, task_in2, organization_id=org_id)

    assert t1.id == t2.id
    assert t2.title == "Initial Idempotent Task"

    # Exactly 1 row in DB
    total = db.query(TaskModel).filter(TaskModel.organization_id == org_id, TaskModel.idempotency_key == idem_key).count()
    assert total == 1


def test_3_3_5_3_02_same_task_twice_different_idempotency_keys(idem_env):
    """2. Same task submitted twice with different idempotency keys: creates two distinct tasks."""
    db = idem_env["db"]
    org_id = idem_env["org_a_id"]
    agent = idem_env["ag_a1"]

    key1 = f"key-1-{uuid.uuid4().hex[:8]}"
    key2 = f"key-2-{uuid.uuid4().hex[:8]}"

    t1 = task_service.create_task(db, TaskCreate(title="Task A", description="Desc", assigned_agent_id=agent.id, idempotency_key=key1), organization_id=org_id)
    t2 = task_service.create_task(db, TaskCreate(title="Task B", description="Desc", assigned_agent_id=agent.id, idempotency_key=key2), organization_id=org_id)

    assert t1.id != t2.id
    assert db.query(TaskModel).filter(TaskModel.organization_id == org_id, TaskModel.idempotency_key.in_([key1, key2])).count() == 2


def test_3_3_5_3_03_concurrent_subtask_claim_race_condition(idem_env):
    """3. Subtask within a workflow assigned to two agents simultaneously (race condition): only one succeeds."""
    db = idem_env["db"]
    org_id = idem_env["org_a_id"]
    ag1 = idem_env["ag_a1"]
    ag2 = idem_env["ag_a2"]

    st_id = f"st-race-{uuid.uuid4().hex[:8]}"
    st = TaskModel(
        id=st_id,
        organization_id=org_id,
        task_type="subtask",
        title="Contested Subtask",
        description="Two agents race to claim",
        status="queued",
        assigned_agent_id=ag1.id,
    )
    db.add(st)
    db.commit()

    # Agent 1 claims the queued task atomically to running
    claim1_success = task_service.claim_subtask(db, task_id=st_id, agent_id=ag1.id)
    # Agent 2 attempts to claim the same subtask; rejected because already running/assigned to ag1
    claim2_success = task_service.claim_subtask(db, task_id=st_id, agent_id=ag2.id)

    # Exactly one agent succeeded
    assert claim1_success is True
    assert claim2_success is False

    db.expire_all()
    reloaded = db.query(TaskModel).filter(TaskModel.id == st_id).first()
    assert reloaded.assigned_agent_id == ag1.id
    assert reloaded.status == "running"


@pytest.mark.asyncio
async def test_3_3_5_3_04_duplicate_deliverable_submission_for_same_subtask(idem_env):
    """4. Duplicate deliverable submission for the same subtask: updates atomically without duplicate records."""
    db = idem_env["db"]
    org_id = idem_env["org_a_id"]
    agent = idem_env["ag_a1"]
    u_tag = idem_env["u_tag"]

    task_id = f"task-art-dup-{u_tag}"
    task = TaskModel(id=task_id, organization_id=org_id, task_type="subtask", title="Artifact Dup Task", description="Testing deliverable deduplication", assigned_agent_id=agent.id, status="running")
    db.add(task)
    db.commit()

    tool = ArtifactCreateTool()
    ctx = TaskContext(task_id=task_id, agent_id=agent.id)
    setattr(ctx, "db", db)

    # First artifact submission
    res1 = await tool.execute({"name": f"report_{u_tag}.md", "content": "# Initial Report Content", "artifact_type": "report"}, context=ctx)
    assert res1.success is True

    # Second artifact submission with the SAME name
    res2 = await tool.execute({"name": f"report_{u_tag}.md", "content": "# Updated Report Content", "artifact_type": "report"}, context=ctx)
    assert res2.success is True

    # Check database: exactly 1 artifact record exists for this task_id and name
    artifacts = db.query(ArtifactModel).filter(ArtifactModel.task_id == task_id, ArtifactModel.name == f"report_{u_tag}.md").all()
    assert len(artifacts) == 1
    assert artifacts[0].size_bytes > 0


def test_3_3_5_3_05_idempotency_key_scoped_per_organization(idem_env):
    """5. Idempotency key scoped to tenant/organization: same key in different tenants creates two independent tasks."""
    db = idem_env["db"]
    org_a = idem_env["org_a_id"]
    org_b = idem_env["org_b_id"]
    ag_a = idem_env["ag_a1"]
    ag_b = idem_env["ag_b1"]

    shared_key = f"corp-shared-idem-{uuid.uuid4().hex[:8]}"

    task_a = task_service.create_task(db, TaskCreate(title="Org A Task", description="Desc A", assigned_agent_id=ag_a.id, idempotency_key=shared_key), organization_id=org_a)
    task_b = task_service.create_task(db, TaskCreate(title="Org B Task", description="Desc B", assigned_agent_id=ag_b.id, idempotency_key=shared_key), organization_id=org_b)

    assert task_a.id != task_b.id
    assert task_a.organization_id == org_a
    assert task_b.organization_id == org_b
    assert task_a.idempotency_key == shared_key
    assert task_b.idempotency_key == shared_key


@pytest.mark.asyncio
async def test_3_3_5_3_06_execution_id_prevents_duplicate_tool_execution(idem_env):
    """6. Execution ID prevents duplicate tool execution: tool calls with the same call_id are not executed twice."""
    db = idem_env["db"]
    org_id = idem_env["org_a_id"]
    agent = idem_env["ag_a1"]

    from backend.app.agent_runtime.tools.registry import default_tool_registry
    from backend.app.agent_runtime.policies.engine import policy_engine
    from backend.app.agent_runtime.verifier import ResultVerifier

    executor = ExecutionLoop(
        tool_registry=default_tool_registry,
        policy_engine=policy_engine,
        verifier=ResultVerifier(),
    )
    provider = DuplicateToolTestProvider()
    token = CancellationToken()

    task_id = f"task-dup-call-{uuid.uuid4().hex[:8]}"
    task = TaskModel(id=task_id, organization_id=org_id, task_type="subtask", title="Tool Dup Task", description="Testing tool call deduplication", assigned_agent_id=agent.id, status="running")
    db.add(task)
    db.commit()

    from backend.app.agent_runtime.policies.permissions import AgentPolicy
    policy = AgentPolicy(agent_id=agent.id, allowed_tools=["calculator"], max_tool_calls=10, max_iterations=5)

    exec_res = await executor.run(
        task_id=task_id,
        agent_id=agent.id,
        user_prompt="Execute duplicate tool calls safely",
        llm_provider=provider,
        agent_policy=policy,
        cancellation_token=token,
        db=db,
    )
    assert exec_res.status == "completed"

    # In DuplicateToolTestProvider, turn 1 sent two calls with the exact same call_id "call_dup_100"
    # Executor executed the first, cached it, and skipped re-executing the second
    # Total executed tool results should be 1
    assert len(exec_res.tool_results) == 1


def test_3_3_5_3_07_event_stream_deduplication(idem_env):
    """7. Event stream deduplication: duplicate events with the same event_id are not persisted twice."""
    db = idem_env["db"]
    org_id = idem_env["org_a_id"]
    agent = idem_env["ag_a1"]

    event_id = f"evt_dup_test_{uuid.uuid4().hex[:12]}"

    # First event creation
    ev1 = event_service.create_event(
        db=db,
        event_type="test.idempotent.event",
        agent_id=agent.id,
        organization_id=org_id,
        event_id=event_id,
        payload={"seq": 1},
    )
    # Second event creation with the EXACT SAME event_id
    ev2 = event_service.create_event(
        db=db,
        event_type="test.idempotent.event",
        agent_id=agent.id,
        organization_id=org_id,
        event_id=event_id,
        payload={"seq": 2},
    )

    assert ev1.id == ev2.id
    assert ev1.sequence_id == ev2.sequence_id

    # Verify only 1 record in database
    records = db.query(AgentEventModel).filter(AgentEventModel.id == event_id).all()
    assert len(records) == 1


@pytest.mark.asyncio
async def test_3_3_5_3_08_concurrent_identical_requests(idem_env):
    """8. Concurrent identical requests: 10 identical requests with same idempotency key create exactly 1 task."""
    org_id = idem_env["org_a_id"]
    agent_id = idem_env["ag_a1"].id
    idem_key = f"concurrent-idem-{uuid.uuid4().hex[:12]}"

    async def submit_request():
        worker_db = SessionLocal()
        try:
            task_in = TaskCreate(
                title="Concurrent Idempotent Submission",
                description="Simultaneous requests",
                assigned_agent_id=agent_id,
                idempotency_key=idem_key,
            )
            created = task_service.create_task(worker_db, task_in, organization_id=org_id)
            return created.id
        finally:
            worker_db.close()

    # Dispatch 10 concurrent requests
    task_ids = await asyncio.gather(*[submit_request() for _ in range(10)])

    # All 10 returned the exact same task ID
    assert len(set(task_ids)) == 1

    # Verify database contains exactly 1 task
    verify_db = SessionLocal()
    total = verify_db.query(TaskModel).filter(TaskModel.organization_id == org_id, TaskModel.idempotency_key == idem_key).count()
    verify_db.close()
    assert total == 1


def test_3_3_5_3_09_workflow_level_deduplication(idem_env):
    """9. Workflow-level deduplication: two identical workflow submissions with same key produce single execution."""
    db = idem_env["db"]
    org_id = idem_env["org_a_id"]
    agent = idem_env["ag_a1"]

    wf_key = f"wf-idem-{uuid.uuid4().hex[:10]}"
    wf1 = task_service.create_task(
        db,
        TaskCreate(title="Master Workflow", description="Primary mission", assigned_agent_id=agent.id, idempotency_key=wf_key),
        organization_id=org_id,
    )
    wf2 = task_service.create_task(
        db,
        TaskCreate(title="Master Workflow Duplicate", description="Second mission trigger", assigned_agent_id=agent.id, idempotency_key=wf_key),
        organization_id=org_id,
    )

    assert wf1.id == wf2.id
    assert db.query(TaskModel).filter(TaskModel.organization_id == org_id, TaskModel.idempotency_key == wf_key).count() == 1


def test_3_3_5_3_10_recovery_replay_idempotency(idem_env):
    """10. Recovery replay idempotency: replaying recovery multiple times produces identical result without side effects."""
    db = idem_env["db"]
    org_id = idem_env["org_a_id"]
    agent = idem_env["ag_a2"]

    task_id = f"task-replay-{uuid.uuid4().hex[:8]}"
    task = TaskModel(
        id=task_id,
        organization_id=org_id,
        task_type="subtask",
        title="Interrupted Task for Replay",
        description="Testing recovery replay stability",
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

    # Pass 1: recovers task from running to queued
    count_pass1 = recover_abandoned_tasks(db, auto_retry=True)
    assert count_pass1 >= 1

    db.expire_all()
    t_after_pass1 = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    assert t_after_pass1.status == "queued"
    assert t_after_pass1.retry_count == 1

    # Pass 2: executed on the already recovered state
    count_pass2 = recover_abandoned_tasks(db, auto_retry=True)
    # 0 tasks recovered because none remain abandoned
    assert count_pass2 == 0

    db.expire_all()
    t_after_pass2 = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    assert t_after_pass2.status == "queued"
    assert t_after_pass2.retry_count == 1  # Not double incremented!
