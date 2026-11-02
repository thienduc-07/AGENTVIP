import uuid
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.task_step import TaskStepModel
from backend.app.models.approval import ApprovalModel
from backend.app.models.auth import OrganizationModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.agent_runtime.lifecycle.task_lifecycle import task_lifecycle_engine, TaskStatus
from backend.app.agent_runtime.dispatcher.dispatcher import task_dispatcher
from backend.app.agent_runtime.dispatcher.crash_recovery import recover_abandoned_tasks
from backend.app.services.approval_service import approval_service
from backend.app.core.errors import ConflictError, NotFoundError


def test_approval_granted_transitions_task_to_queued(auth_client, seed_test_agent, db_session):
    """Approving a pending approval transitions task from waiting_approval to queued."""
    task = TaskModel(
        id=f"t-appr-{uuid.uuid4().hex[:6]}",
        title="High Risk Sandbox Task",
        description="Task requiring authorization",
        status="waiting_approval",
        priority="high",
        assigned_agent_id=seed_test_agent.id,
        organization_id="org_default_company",
    )
    approval = ApprovalModel(
        id=f"appr-{uuid.uuid4().hex[:6]}",
        task_id=task.id,
        action_type="execute_sandbox_script",
        description="Execute python script modifying island firewall",
        status="pending",
        requested_at=datetime.utcnow(),
    )
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    decision_payload = {
        "decision": "approved",
        "reason": "Security officer verified script integrity",
    }
    with patch("backend.app.websocket_manager.ws_manager.broadcast_sync") as mock_broadcast:
        decide_res = auth_client.post(
            f"/api/v1/approvals/{approval.id}/decision",
            json=decision_payload
        )
        assert decide_res.status_code == 200
        data = decide_res.json()
        assert data["id"] == approval.id
        assert data["status"] == "approved"
        assert data["decision_reason"] == decision_payload["reason"]
        assert data["resolved_at"] is not None

        # Verify WebSocket broadcast occurred
        assert mock_broadcast.called
        envelopes = [call.args[0] for call in mock_broadcast.call_args_list]
        appr_envelopes = [e for e in envelopes if e.get("event_type") == "approval.approved"]
        assert len(appr_envelopes) >= 1

    # Verify task in DB
    db_session.expire_all()
    task_db = db_session.query(TaskModel).filter(TaskModel.id == task.id).first()
    assert task_db.status == "queued"
    assert "execute_sandbox_script" in (task_db.output_data_json or {}).get("approved_actions", [])

    # Verify authorization step added
    step = (
        db_session.query(TaskStepModel)
        .filter(TaskStepModel.task_id == task.id, TaskStepModel.title.contains("Authorization Granted"))
        .first()
    )
    assert step is not None
    assert step.status == "completed"

    # Verify audit event in DB
    ev = (
        db_session.query(AgentEventModel)
        .filter(AgentEventModel.task_id == task.id, AgentEventModel.event_type == "approval.approved")
        .first()
    )
    assert ev is not None
    assert (ev.payload_json or {}).get("action_type") == "execute_sandbox_script"


def test_approval_rejected_fails_task_and_releases_agent(auth_client, seed_test_agent, db_session):
    """Rejecting an approval fails the task, preserves reason, and releases assigned agent."""
    task = TaskModel(
        id=f"t-appr-rej-{uuid.uuid4().hex[:6]}",
        title="Unauthorized Port Scan",
        description="Probing external nodes",
        status="waiting_approval",
        assigned_agent_id=seed_test_agent.id,
        organization_id="org_default_company",
    )
    approval = ApprovalModel(
        id=f"appr-rej-{uuid.uuid4().hex[:6]}",
        task_id=task.id,
        action_type="execute_port_scan",
        description="Scan external perimeter IP range",
        status="pending",
        requested_at=datetime.utcnow(),
    )
    seed_test_agent.status = "waiting_approval"
    seed_test_agent.behavioral_state = "WAITING"
    seed_test_agent.current_task_id = task.id
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    rejection_payload = {
        "decision": "rejected",
        "reason": "External port scans violate corporate security policy"
    }
    decide_res = auth_client.post(
        f"/api/v1/approvals/{approval.id}/decision",
        json=rejection_payload
    )
    assert decide_res.status_code == 200
    data = decide_res.json()
    assert data["status"] == "rejected"
    assert data["decision_reason"] == rejection_payload["reason"]

    # Verify task failed in DB
    db_session.expire_all()
    task_db = db_session.query(TaskModel).filter(TaskModel.id == task.id).first()
    assert task_db.status == "failed"
    assert "rejected by operator" in (task_db.error_message or "")

    # Verify agent safely released
    agent_db = db_session.query(AgentModel).filter(AgentModel.id == seed_test_agent.id).first()
    assert agent_db.status == "idle"
    assert agent_db.behavioral_state == "IDLE"
    assert agent_db.current_task_id is None


def test_duplicate_approval_decision_rejected(auth_client, seed_test_agent, db_session):
    """Deciding an already resolved approval raises 409 Conflict."""
    task = TaskModel(
        id=f"t-dup-{uuid.uuid4().hex[:6]}",
        title="Double Decision Task",
        description="Test duplicate resolution guard",
        status="waiting_approval",
        assigned_agent_id=seed_test_agent.id,
        organization_id="org_default_company",
    )
    approval = ApprovalModel(
        id=f"appr-dup-{uuid.uuid4().hex[:6]}",
        task_id=task.id,
        action_type="execute_restart",
        description="Restart core daemon",
        status="pending",
        requested_at=datetime.utcnow(),
    )
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    # First decision: approve
    res1 = auth_client.post(
        f"/api/v1/approvals/{approval.id}/decision",
        json={"decision": "approved", "reason": "First decision"}
    )
    assert res1.status_code == 200

    # Second decision: reject -> 409 Conflict
    res2 = auth_client.post(
        f"/api/v1/approvals/{approval.id}/decision",
        json={"decision": "rejected", "reason": "Second decision"}
    )
    assert res2.status_code == 409
    assert res2.json()["error"]["code"] == "APPROVAL_ALREADY_RESOLVED"


def test_invalid_approval_id_returns_404(auth_client):
    """Attempting to decide a non-existent approval returns 404."""
    res = auth_client.post(
        "/api/v1/approvals/non-existent-approval-id/decision",
        json={"decision": "approved", "reason": "Ghost approval"}
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "APPROVAL_NOT_FOUND"


def test_cross_tenant_approval_access_denied(auth_client, seed_test_agent, db_session):
    """Users cannot view or decide approvals belonging to another tenant."""
    foreign_org = OrganizationModel(
        id="org_foreign_corp",
        name="Foreign Corporation",
        slug="foreign-corp",
        is_active=True
    )
    db_session.add(foreign_org)
    db_session.flush()

    foreign_agent = AgentModel(
        id="foreign-agent-99",
        name="Foreign Agent",
        role="general",
        status="idle",
        organization_id=foreign_org.id
    )
    db_session.add(foreign_agent)
    db_session.flush()

    foreign_task = TaskModel(
        id=f"t-foreign-{uuid.uuid4().hex[:6]}",
        title="Secret Foreign Operation",
        description="Belongs to Foreign Corp",
        status="waiting_approval",
        assigned_agent_id=foreign_agent.id,
        organization_id=foreign_org.id
    )
    db_session.add(foreign_task)
    db_session.flush()

    foreign_approval = ApprovalModel(
        id=f"appr-foreign-{uuid.uuid4().hex[:6]}",
        task_id=foreign_task.id,
        action_type="export_trade_secrets",
        description="Export encrypted ledger",
        status="pending",
        requested_at=datetime.utcnow()
    )
    db_session.add(foreign_approval)
    db_session.commit()

    # auth_client belongs to org_default_company -> must 404
    get_res = auth_client.get(f"/api/v1/approvals/{foreign_approval.id}")
    assert get_res.status_code == 404
    assert get_res.json()["error"]["code"] == "APPROVAL_NOT_FOUND"

    decide_res = auth_client.post(
        f"/api/v1/approvals/{foreign_approval.id}/decision",
        json={"decision": "approved", "reason": "Unauthorized attempt"}
    )
    assert decide_res.status_code == 404
    assert decide_res.json()["error"]["code"] == "APPROVAL_NOT_FOUND"


def test_approval_after_task_cancellation_rejected(auth_client, seed_test_agent, db_session):
    """Cannot approve an action for a task that was already cancelled (no resurrection)."""
    task = TaskModel(
        id=f"t-canc-{uuid.uuid4().hex[:6]}",
        title="Cancelled Task With Approval",
        description="Verify no resurrection",
        status="cancelled",
        assigned_agent_id=seed_test_agent.id,
        organization_id="org_default_company",
    )
    approval = ApprovalModel(
        id=f"appr-canc-{uuid.uuid4().hex[:6]}",
        task_id=task.id,
        action_type="execute_delete_database",
        description="Delete dev db",
        status="pending",
        requested_at=datetime.utcnow(),
    )
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    decide_res = auth_client.post(
        f"/api/v1/approvals/{approval.id}/decision",
        json={"decision": "approved", "reason": "Try to resurrect"}
    )
    assert decide_res.status_code == 409
    assert decide_res.json()["error"]["code"] == "TASK_ALREADY_CANCELLED"

    # Verify task was NOT resurrected
    db_session.expire_all()
    task_db = db_session.query(TaskModel).filter(TaskModel.id == task.id).first()
    assert task_db.status == "cancelled"


def test_approval_after_task_completion_rejected(auth_client, seed_test_agent, db_session):
    """Cannot approve an action for a task that is already completed."""
    task = TaskModel(
        id=f"t-comp-{uuid.uuid4().hex[:6]}",
        title="Completed Task",
        description="Verify completed invariant",
        status="completed",
        assigned_agent_id=seed_test_agent.id,
        organization_id="org_default_company",
    )
    approval = ApprovalModel(
        id=f"appr-comp-{uuid.uuid4().hex[:6]}",
        task_id=task.id,
        action_type="execute_backup",
        description="Backup logs",
        status="pending",
        requested_at=datetime.utcnow(),
    )
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    decide_res = auth_client.post(
        f"/api/v1/approvals/{approval.id}/decision",
        json={"decision": "approved", "reason": "Post-completion approval"}
    )
    assert decide_res.status_code == 409
    assert decide_res.json()["error"]["code"] == "TASK_ALREADY_COMPLETED"


def test_approval_while_task_paused_preserves_paused_state(auth_client, seed_test_agent, db_session):
    """Approving an action while the task is paused records the approval but leaves task paused."""
    task = TaskModel(
        id=f"t-paused-appr-{uuid.uuid4().hex[:6]}",
        title="Paused Task Waiting Authorization",
        description="Task was paused by human operator",
        status="paused",
        assigned_agent_id=seed_test_agent.id,
        organization_id="org_default_company",
    )
    approval = ApprovalModel(
        id=f"appr-paused-{uuid.uuid4().hex[:6]}",
        task_id=task.id,
        action_type="modify_dns",
        description="Modify DNS records",
        status="pending",
        requested_at=datetime.utcnow(),
    )
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    decide_res = auth_client.post(
        f"/api/v1/approvals/{approval.id}/decision",
        json={"decision": "approved", "reason": "Approved while paused"}
    )
    assert decide_res.status_code == 200
    assert decide_res.json()["status"] == "approved"

    # Verify task remains in 'paused' state
    db_session.expire_all()
    task_db = db_session.query(TaskModel).filter(TaskModel.id == task.id).first()
    assert task_db.status == "paused"
    assert "modify_dns" in (task_db.output_data_json or {}).get("approved_actions", [])


def test_dispatcher_ignores_waiting_approval_tasks(seed_test_agent, db_session):
    """TaskDispatcher._claim_next_task() must strictly ignore tasks in waiting_approval state."""
    org_id = "org_default_company"
    task_id = f"t-disp-wait-{uuid.uuid4().hex[:6]}"

    task = TaskModel(
        id=task_id,
        title="Waiting Task Ignored By Dispatcher",
        description="Must not be claimed while waiting approval",
        status="waiting_approval",
        assigned_agent_id=seed_test_agent.id,
        organization_id=org_id,
    )
    approval = ApprovalModel(
        id=f"appr-disp-{uuid.uuid4().hex[:6]}",
        task_id=task.id,
        action_type="critical_upgrade",
        description="Upgrade firmware",
        status="pending",
        requested_at=datetime.utcnow(),
    )
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    class NonClosingSession:
        def __init__(self, session):
            self._session = session
        def close(self):
            pass
        def __getattr__(self, name):
            return getattr(self._session, name)

    # 1. While waiting_approval, dispatcher must NOT claim this task
    with patch("backend.app.agent_runtime.dispatcher.dispatcher.SessionLocal", side_effect=lambda: NonClosingSession(db_session)):
        claimed = task_dispatcher._claim_next_task()
        assert claimed != task_id

    # 2. Operator grants approval
    approval_service.decide_approval(
        db=db_session,
        approval_id=approval.id,
        decision="approved",
        reason="Granted for test",
        organization_id=org_id
    )

    db_session.expire_all()
    task_after = db_session.query(TaskModel).filter(TaskModel.id == task_id).first()
    assert task_after.status == "queued"

    # 3. Now dispatcher CAN claim the task
    with patch("backend.app.agent_runtime.dispatcher.dispatcher.SessionLocal", side_effect=lambda: NonClosingSession(db_session)):
        claimed_after = task_dispatcher._claim_next_task()
        assert claimed_after == task_id


@pytest.mark.asyncio
async def test_executor_permits_previously_approved_tool_execution(seed_test_agent, db_session):
    """ExecutionLoop proceeds with tool execution when an approved ApprovalModel exists."""
    from backend.app.agent_runtime.executor import ExecutionLoop
    from backend.app.agent_runtime.tools.registry import default_tool_registry
    from backend.app.agent_runtime.policies.engine import policy_engine
    from backend.app.agent_runtime.verifier import result_verifier
    from backend.app.agent_runtime.tools.base import Tool, ToolPermissionLevel, SideEffectLevel, ToolResult
    from backend.app.agent_runtime.llm.base import LLMResponse, ToolCallRequest, LLMUsage
    from backend.app.agent_runtime.policies.permissions import AgentPolicy
    from backend.app.agent_runtime.cancellation import CancellationToken

    # Create dummy high-risk tool
    class MockHighRiskTool:
        name: str = "mock_high_risk_deploy"
        description: str = "Deploys code to production"
        input_schema: dict = {"type": "object", "properties": {"target": {"type": "string"}}}
        permission_level: ToolPermissionLevel = ToolPermissionLevel.LEVEL_2_COMMAND_EXEC
        side_effect_level: SideEffectLevel = SideEffectLevel.HIGH_RISK
        requires_approval: bool = True
        timeout_seconds: int = 30

        async def execute(self, arguments: dict, context: any) -> ToolResult:
            return ToolResult(success=True, output=f"deployed_successfully to {arguments.get('target', 'prod')}")

    high_risk_tool = MockHighRiskTool()
    default_tool_registry.register(high_risk_tool)

    task_id = f"t-exec-appr-{uuid.uuid4().hex[:6]}"
    task = TaskModel(
        id=task_id,
        title="Execute High Risk Deploy",
        description="Deploying to prod",
        status="in_progress",
        assigned_agent_id=seed_test_agent.id,
        organization_id="org_default_company",
    )
    # Pre-seed approval with 'approved' status
    approval = ApprovalModel(
        id=f"appr-pre-{uuid.uuid4().hex[:6]}",
        task_id=task.id,
        action_type="execute_mock_high_risk_deploy",
        description="Deploy to prod",
        status="approved",
        requested_at=datetime.utcnow(),
        resolved_at=datetime.utcnow(),
        decision_reason="Pre-approved by operator",
    )
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    from unittest.mock import AsyncMock
    mock_llm = MagicMock()
    mock_llm.generate = AsyncMock(side_effect=[
        LLMResponse(
            content="Requesting deployment",
            tool_calls=[ToolCallRequest(call_id="call-1", tool_name="mock_high_risk_deploy", arguments={"target": "prod"})],
            usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20),
            provider="mock_llm",
            model="mock_model",
            is_live_provider=False,
        ),
        LLMResponse(
            content="Deployment to production completed successfully and verified with healthy status checks.",
            tool_calls=[],
            usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20),
            provider="mock_llm",
            model="mock_model",
            is_live_provider=False,
        ),
    ])

    executor = ExecutionLoop(
        tool_registry=default_tool_registry,
        policy_engine=policy_engine,
        verifier=result_verifier,
    )
    policy = AgentPolicy(
        agent_id=seed_test_agent.id,
        allowed_tools=["mock_high_risk_deploy"],
        max_permission_level=ToolPermissionLevel.LEVEL_2_COMMAND_EXEC,
    )

    result = await executor.run(
        task_id=task.id,
        agent_id=seed_test_agent.id,
        user_prompt="Deploy production update",
        llm_provider=mock_llm,
        agent_policy=policy,
        cancellation_token=CancellationToken(),
        db=db_session,
    )

    # Must complete successfully rather than pausing for approval
    assert result.status == "completed"
    assert result.requires_approval is False
    assert any("deployed_successfully" in str(tr.get("output")) for tr in result.tool_results)


@pytest.mark.asyncio
async def test_executor_blocks_rejected_tool_operation(seed_test_agent, db_session):
    """ExecutionLoop rejects tool execution if an explicit rejection ApprovalModel exists."""
    from backend.app.agent_runtime.executor import ExecutionLoop
    from backend.app.agent_runtime.tools.registry import default_tool_registry
    from backend.app.agent_runtime.policies.engine import policy_engine
    from backend.app.agent_runtime.verifier import result_verifier
    from backend.app.agent_runtime.tools.base import Tool, ToolPermissionLevel, SideEffectLevel, ToolResult
    from backend.app.agent_runtime.llm.base import LLMResponse, ToolCallRequest, LLMUsage
    from backend.app.agent_runtime.policies.permissions import AgentPolicy
    from backend.app.agent_runtime.cancellation import CancellationToken

    class MockDangerousTool:
        name: str = "mock_dangerous_wipe"
        description: str = "Wipes disk partition"
        input_schema: dict = {"type": "object", "properties": {}}
        permission_level: ToolPermissionLevel = ToolPermissionLevel.LEVEL_2_COMMAND_EXEC
        side_effect_level: SideEffectLevel = SideEffectLevel.HIGH_RISK
        requires_approval: bool = True
        timeout_seconds: int = 30

        async def execute(self, arguments: dict, context: any) -> ToolResult:
            raise RuntimeError("WIPE MUST NEVER RUN!")

    class MockSafeStatusTool:
        name: str = "mock_safe_status"
        description: str = "Reports safe status"
        input_schema: dict = {"type": "object", "properties": {}}
        permission_level: ToolPermissionLevel = ToolPermissionLevel.LEVEL_0_READ_ONLY
        side_effect_level: SideEffectLevel = SideEffectLevel.READ_ONLY
        requires_approval: bool = False
        timeout_seconds: int = 10

        async def execute(self, arguments: dict, context: any) -> ToolResult:
            return ToolResult(success=True, output="system status: normal, wipe aborted")

    dangerous_tool = MockDangerousTool()
    safe_tool = MockSafeStatusTool()
    default_tool_registry.register(dangerous_tool)
    default_tool_registry.register(safe_tool)

    task_id = f"t-exec-rej-{uuid.uuid4().hex[:6]}"
    task = TaskModel(
        id=task_id,
        title="Execute Dangerous Wipe",
        description="Wiping disk",
        status="in_progress",
        assigned_agent_id=seed_test_agent.id,
        organization_id="org_default_company",
    )
    # Pre-seed rejection
    approval = ApprovalModel(
        id=f"appr-rej-db-{uuid.uuid4().hex[:6]}",
        task_id=task.id,
        action_type="execute_mock_dangerous_wipe",
        description="Wipe disk",
        status="rejected",
        requested_at=datetime.utcnow(),
        resolved_at=datetime.utcnow(),
        decision_reason="Destructive operations forbidden",
    )
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    from unittest.mock import AsyncMock
    mock_llm = MagicMock()
    mock_llm.generate = AsyncMock(side_effect=[
        LLMResponse(
            content="Attempting wipe",
            tool_calls=[ToolCallRequest(call_id="call-1", tool_name="mock_dangerous_wipe", arguments={})],
            usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20),
            provider="mock_llm",
            model="mock_model",
            is_live_provider=False,
        ),
        LLMResponse(
            content="Dangerous operation was rejected. Checking safe status instead.",
            tool_calls=[ToolCallRequest(call_id="call-2", tool_name="mock_safe_status", arguments={})],
            usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20),
            provider="mock_llm",
            model="mock_model",
            is_live_provider=False,
        ),
        LLMResponse(
            content="Disk wipe was aborted due to operator rejection. Verified safe status and logged security notice.",
            tool_calls=[],
            usage=LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20),
            provider="mock_llm",
            model="mock_model",
            is_live_provider=False,
        ),
    ])

    executor = ExecutionLoop(
        tool_registry=default_tool_registry,
        policy_engine=policy_engine,
        verifier=result_verifier,
    )
    policy = AgentPolicy(
        agent_id=seed_test_agent.id,
        allowed_tools=["mock_dangerous_wipe", "mock_safe_status"],
        max_permission_level=ToolPermissionLevel.LEVEL_2_COMMAND_EXEC,
    )

    result = await executor.run(
        task_id=task.id,
        agent_id=seed_test_agent.id,
        user_prompt="Run disk wipe",
        llm_provider=mock_llm,
        agent_policy=policy,
        cancellation_token=CancellationToken(),
        db=db_session,
    )

    # Tool was blocked and NEVER executed
    assert result.status == "completed"
    assert mock_llm.generate.call_count == 3
    # Verify rejection message was fed back to the LLM in turn 2
    call_args_turn2 = mock_llm.generate.call_args_list[1]
    messages_passed = call_args_turn2.kwargs.get("messages") or call_args_turn2.args[0]
    assert any("Tool execution rejected by operator" in str(m.get("content", "")) for m in messages_passed)
    assert any("wipe aborted" in str(tr.get("output", "")) for tr in result.tool_results)
    assert not any("WIPE MUST NEVER RUN" in str(tr.get("output", "")) for tr in result.tool_results)


def test_crash_recovery_preserves_waiting_approval_tasks(seed_test_agent, db_session):
    """Crash recovery leaves waiting_approval tasks intact across worker restarts."""
    org_id = "org_default_company"
    task_id = f"t-rec-appr-{uuid.uuid4().hex[:6]}"

    task = TaskModel(
        id=task_id,
        title="Pending Approval During Crash",
        description="Must stay in waiting_approval across restart",
        status="waiting_approval",
        assigned_agent_id=seed_test_agent.id,
        organization_id=org_id,
    )
    approval = ApprovalModel(
        id=f"appr-rec-{uuid.uuid4().hex[:6]}",
        task_id=task.id,
        action_type="high_impact_change",
        description="Change configuration",
        status="pending",
        requested_at=datetime.utcnow(),
    )
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    # Run crash recovery
    recover_abandoned_tasks(db_session)

    db_session.expire_all()
    task_db = db_session.query(TaskModel).filter(TaskModel.id == task_id).first()
    assert task_db.status == "waiting_approval"
    approval_db = db_session.query(ApprovalModel).filter(ApprovalModel.id == approval.id).first()
    assert approval_db.status == "pending"
