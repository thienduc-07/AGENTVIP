import asyncio
from datetime import datetime, timedelta
import pytest

from backend.app.core.config import settings
from backend.app.core.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from backend.app.models.agent import AgentModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.models.approval import ApprovalModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.task import TaskModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.services.approval_service import approval_service
from backend.app.services.behavioral_state_service import (
    BehavioralState,
    behavioral_state_service,
)
from backend.app.services.event_service import event_service
from backend.app.services.navigation_service import navigation_service
from backend.app.services.workstation_service import workstation_service
from backend.app.services.world_service import world_service
from backend.app.agent_runtime.dispatcher.dispatcher import TaskDispatcher
from backend.app.agent_runtime.heartbeat.ceo_heartbeat import ceo_heartbeat


# ============================================================================
# SUBPHASE 3.3.3.1 — PERSISTENT BEHAVIORAL STATE MACHINE TESTS
# ============================================================================


def test_behavioral_state_valid_transitions_and_event_persistence(
    auth_client, db_session, seed_test_agent
):
    """
    Verifies all 9 required behavioral states (IDLE, PLANNING, THINKING, WORKING,
    COMMUNICATING, MOVING, WAITING, COMPLETED, ERROR), operational status mapping,
    EventService persistence, and world snapshot inclusion.
    """
    agent_id = seed_test_agent.id
    seed_test_agent.organization_id = "org_default_company"
    db_session.commit()

    # 1. IDLE -> PLANNING -> THINKING -> WORKING -> COMMUNICATING -> WORKING -> WAITING -> WORKING -> COMPLETED -> IDLE
    sequence = [
        ("PLANNING", "working"),
        ("THINKING", "working"),
        ("WORKING", "working"),
        ("COMMUNICATING", "working"),
        ("WORKING", "working"),
        ("WAITING", "waiting_approval"),
        ("WORKING", "working"),
        ("COMPLETED", "idle"),
        ("IDLE", "idle"),
        ("MOVING", "working"),
        ("IDLE", "idle"),
        ("PLANNING", "working"),
        ("ERROR", "error"),
        ("IDLE", "idle"),
    ]

    for target_state, expected_op_status in sequence:
        res = auth_client.post(
            f"/api/v1/agents/{agent_id}/behavioral-state",
            json={
                "behavioral_state": target_state,
                "reason": f"Test transition to {target_state}",
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["behavioral_state"] == target_state
        assert body["status"] == expected_op_status

    # Verify persisted events in EventService
    events = (
        db_session.query(AgentEventModel)
        .filter(
            AgentEventModel.agent_id == agent_id,
            AgentEventModel.event_type == "agent.behavioral_state_changed",
        )
        .all()
    )
    assert len(events) >= len(sequence)

    # Verify world snapshot includes behavioral_state
    snap_res = auth_client.get("/api/v1/world/snapshot")
    assert snap_res.status_code == 200
    snap_data = snap_res.json()
    agent_snap = next(
        (a for a in snap_data["agents"] if a["employee_id"] == agent_id), None
    )
    assert agent_snap is not None
    assert agent_snap["behavioral_state"] == "IDLE"


def test_behavioral_state_rejects_invalid_transitions(
    auth_client, db_session, seed_test_agent
):
    """Verifies that invalid behavioral state transitions are strictly rejected."""
    agent_id = seed_test_agent.id
    seed_test_agent.organization_id = "org_default_company"
    seed_test_agent.behavioral_state = "IDLE"
    seed_test_agent.status = "idle"
    db_session.commit()

    # IDLE -> COMPLETED is invalid (cannot complete without executing)
    res = auth_client.post(
        f"/api/v1/agents/{agent_id}/behavioral-state",
        json={"behavioral_state": "COMPLETED"},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "INVALID_BEHAVIORAL_TRANSITION"

    # Put agent in ERROR, then attempt ERROR -> WORKING directly (must recover via IDLE/PLANNING/THINKING)
    behavioral_state_service.transition_state(
        db=db_session,
        agent_id=agent_id,
        target_state=BehavioralState.ERROR,
        organization_id="org_default_company",
        force_recovery=True,
        commit=True,
    )
    res_err_work = auth_client.post(
        f"/api/v1/agents/{agent_id}/behavioral-state",
        json={"behavioral_state": "WORKING"},
    )
    assert res_err_work.status_code == 422
    assert res_err_work.json()["error"]["code"] == "INVALID_BEHAVIORAL_TRANSITION"


def test_behavioral_state_tenant_isolation(auth_client, db_session):
    """Verifies that an organization cannot inspect or transition another tenant's agent."""
    foreign_agent = AgentModel(
        id="agent-foreign-tenant-b",
        organization_id="org_foreign_tenant_b",
        name="Foreign Tenant Agent",
        role="Engineer",
        station="engineering_bay",
        status="idle",
        behavioral_state="IDLE",
    )
    db_session.add(foreign_agent)
    db_session.commit()

    res = auth_client.post(
        f"/api/v1/agents/{foreign_agent.id}/behavioral-state",
        json={"behavioral_state": "PLANNING"},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "CROSS_TENANT_BEHAVIORAL_TRANSITION"

    refreshed = (
        db_session.query(AgentModel)
        .filter(AgentModel.id == foreign_agent.id)
        .first()
    )
    assert refreshed.behavioral_state == "IDLE"


@pytest.mark.asyncio
async def test_failed_or_rejected_task_never_leaves_agent_working(db_session):
    """
    Verifies Requirement 8 of Decision 1:
    Failed, rejected, or unresolvable task execution NEVER leaves an Agent permanently WORKING.
    """
    agent = AgentModel(
        id="agent-unresolvable-spec",
        organization_id="org_default_company",
        name="Unresolvable Specialist",
        role="Unknown Role",
        station="engineering_bay",
        status="working",
        behavioral_state="WORKING",
    )
    task = TaskModel(
        id="task-fail-release-check",
        organization_id="org_default_company",
        title="Task Assigned to Unregistered Agent",
        description="Should fail cleanly and release agent from WORKING to IDLE",
        status="queued",
        assigned_agent_id=agent.id,
    )
    agent.current_task_id = task.id
    db_session.add_all([agent, task])
    db_session.commit()

    dispatcher = TaskDispatcher()
    await dispatcher._process_task(task.id, db=db_session)

    db_session.refresh(agent)
    db_session.refresh(task)
    assert task.status == "failed"
    assert agent.status == "idle"
    assert agent.behavioral_state == "IDLE"
    assert agent.current_task_id is None


def test_approval_rejection_releases_waiting_agent_to_idle(
    db_session, seed_test_agent
):
    """Verifies that rejecting a pending approval releases a WAITING agent back to IDLE."""
    seed_test_agent.organization_id = "org_default_company"
    seed_test_agent.status = "waiting_approval"
    seed_test_agent.behavioral_state = "WAITING"
    task = TaskModel(
        id="task-approval-reject-release",
        organization_id="org_default_company",
        title="Approval Gated Task",
        description="Requires approval",
        status="waiting_approval",
        assigned_agent_id=seed_test_agent.id,
    )
    seed_test_agent.current_task_id = task.id
    approval = ApprovalModel(
        id="appr-reject-release-1",
        task_id=task.id,
        action_type="high_risk_tool",
        description="Execute privileged tool",
        status="pending",
    )
    db_session.add_all([task, approval])
    db_session.commit()

    approval_service.decide_approval(
        db=db_session,
        approval_id=approval.id,
        decision="rejected",
        reason="Denied by security policy",
        organization_id="org_default_company",
    )

    db_session.refresh(seed_test_agent)
    db_session.refresh(task)
    assert task.status == "failed"
    assert seed_test_agent.status == "idle"
    assert seed_test_agent.behavioral_state == "IDLE"
    assert seed_test_agent.current_task_id is None


# ============================================================================
# SUBPHASE 3.3.3.2 — HYBRID SPATIAL NAVIGATION (BACKEND) TESTS
# ============================================================================


def test_office_navigation_topology_and_workstation_destinations(
    auth_client, db_session
):
    """
    Verifies office navigation topology graph (zones + corridors) and dynamic
    workstation destination resolution without hardcoded agent coordinates.
    """
    # Allocate a physical workstation for agent-eng-lead in Engineering
    ws = workstation_service.allocate_workstation(
        db=db_session,
        agent_id="agent-eng-lead",
        department="Engineering",
        organization_id="org_default_company",
    )
    db_session.commit()

    topo_res = auth_client.get("/api/v1/world/topology")
    assert topo_res.status_code == 200
    topo = topo_res.json()

    node_ids = {n["node_id"] for n in topo["nodes"]}
    assert "executive_suite" in node_ids
    assert "engineering_bay" in node_ids
    assert "research_lab" in node_ids
    assert "corridor_center" in node_ids
    assert len(topo["edges"]) >= 15

    ws_ids = {
        w["logical_workstation_id"] for w in topo["workstation_destinations"]
    }
    assert ws.logical_workstation_id in ws_ids


def test_agent_movement_lifecycle_and_conflict_prevention(
    auth_client, db_session
):
    """
    Verifies start_movement -> update_movement_progress -> complete_movement,
    conflict rejection when an agent is already moving, and interruption/rerouting.
    """
    agent_id = "agent-exec-ceo"
    agent = db_session.query(AgentModel).filter(AgentModel.id == agent_id).first()
    agent.pos_x = 0.0
    agent.pos_y = 1.0
    agent.pos_z = -12.0
    agent.behavioral_state = "IDLE"
    agent.status = "idle"
    agent.active_movement_id = None
    db_session.commit()

    # 1. Start movement from executive_suite to finance_office
    nav_res = auth_client.post(
        f"/api/v1/agents/{agent_id}/navigate",
        json={
            "destination": "finance_office",
            "speed": 5.0,
            "allow_interrupt": False,
        },
    )
    assert nav_res.status_code == 200, nav_res.text
    plan = nav_res.json()
    movement_id = plan["movement_id"]
    assert plan["behavioral_state"] == "MOVING"
    assert plan["destination"] == "finance_office"
    assert len(plan["waypoints"]) >= 3  # Routes via corridor nodes
    assert plan["total_distance"] > 20.0

    # 2. Conflicting movement command without allow_interrupt must be rejected with 409
    conflict_res = auth_client.post(
        f"/api/v1/agents/{agent_id}/navigate",
        json={
            "destination": "engineering_bay",
            "allow_interrupt": False,
        },
    )
    assert conflict_res.status_code == 409
    assert conflict_res.json()["error"]["code"] == "MOVEMENT_CONFLICT"

    # 3. Update movement progress with valid movement_id
    prog_res = auth_client.post(
        f"/api/v1/agents/{agent_id}/movement/progress",
        json={
            "movement_id": movement_id,
            "pos_x": 0.0,
            "pos_y": 1.0,
            "pos_z": 3.0,
            "waypoint_index": 2,
            "progress_ratio": 0.5,
        },
    )
    assert prog_res.status_code == 200
    assert prog_res.json()["pos_z"] == 3.0

    # 4. Stale/mismatched movement_id on progress must be rejected
    bad_prog_res = auth_client.post(
        f"/api/v1/agents/{agent_id}/movement/progress",
        json={
            "movement_id": "mov-stale-id",
            "pos_x": 1.0,
            "pos_y": 1.0,
            "pos_z": 4.0,
        },
    )
    assert bad_prog_res.status_code == 409
    assert bad_prog_res.json()["error"]["code"] == "MOVEMENT_ID_MISMATCH"

    # 5. Reroute with allow_interrupt=True interrupts previous movement and starts new movement
    reroute_res = auth_client.post(
        f"/api/v1/agents/{agent_id}/navigate",
        json={
            "destination": "engineering_bay",
            "allow_interrupt": True,
            "target_state_on_arrival": "WORKING",
        },
    )
    assert reroute_res.status_code == 200
    new_plan = reroute_res.json()
    new_movement_id = new_plan["movement_id"]
    assert new_movement_id != movement_id
    assert new_plan["destination"] == "engineering_bay"

    # 6. Complete the new movement and transition into WORKING
    done_res = auth_client.post(
        f"/api/v1/agents/{agent_id}/movement/complete",
        json={
            "movement_id": new_movement_id,
            "target_state": "WORKING",
        },
    )
    assert done_res.status_code == 200
    done_body = done_res.json()
    assert done_body["behavioral_state"] == "WORKING"
    assert done_body["status"] == "working"
    assert done_body["pos_x"] == -14.0
    assert done_body["pos_z"] == -4.0
    assert done_body["active_movement_id"] is None

    # Verify movement events persisted in EventService
    ev_types = [
        e.event_type
        for e in db_session.query(AgentEventModel)
        .filter(AgentEventModel.agent_id == agent_id)
        .all()
    ]
    assert "agent.movement_started" in ev_types
    assert "agent.movement_progress" in ev_types
    assert "agent.movement_interrupted" in ev_types
    assert "agent.movement_completed" in ev_types


def test_navigation_validates_destinations_and_cross_tenant_workstations(
    auth_client, db_session
):
    """
    Verifies that invalid destinations, virtual workstations, and cross-tenant
    workstations are strictly rejected.
    """
    agent_id = "agent-eng-lead"

    # 1. Unknown destination rejected with 422 ValidationError
    bad_dest = auth_client.post(
        f"/api/v1/agents/{agent_id}/navigate",
        json={"destination": "non_existent_moon_base"},
    )
    assert bad_dest.status_code == 422
    assert bad_dest.json()["error"]["code"] == "INVALID_MOVEMENT_DESTINATION"

    # 2. Virtual workstation cannot be navigated to physically
    virt_agent = AgentModel(
        id="agent-virtual-worker",
        organization_id="org_default_company",
        name="Virtual Worker",
        role="Remote Engineer",
        station="engineering_bay",
        status="idle",
    )
    db_session.add(virt_agent)
    db_session.flush()
    virt_ws = workstation_service.allocate_workstation(
        db=db_session,
        agent_id=virt_agent.id,
        department="Engineering",
        organization_id="org_default_company",
        force_virtual=True,
    )
    db_session.commit()

    virt_res = auth_client.post(
        f"/api/v1/agents/{agent_id}/navigate",
        json={"destination": virt_ws.logical_workstation_id},
    )
    assert virt_res.status_code == 422
    assert virt_res.json()["error"]["code"] == "INVALID_WORKSTATION_DESTINATION"

    # 3. Cross-tenant workstation destination rejected with 403 Forbidden
    foreign_agent = AgentModel(
        id="agent-org-b-desk-holder",
        organization_id="org_tenant_b",
        name="Org B Desk Holder",
        role="Engineer",
        station="engineering_bay",
        status="idle",
    )
    db_session.add(foreign_agent)
    db_session.flush()
    foreign_ws = workstation_service.allocate_workstation(
        db=db_session,
        agent_id=foreign_agent.id,
        department="Engineering",
        organization_id="org_tenant_b",
    )
    db_session.commit()

    cross_res = auth_client.post(
        f"/api/v1/agents/{agent_id}/navigate",
        json={"destination": foreign_ws.logical_workstation_id},
    )
    assert cross_res.status_code == 403
    assert cross_res.json()["error"]["code"] == "CROSS_TENANT_DESTINATION_DENIED"


# ============================================================================
# SUBPHASE 3.3.3.4 — AUTONOMOUS CEO SUPERVISORY HEARTBEAT TESTS
# ============================================================================


def test_ceo_heartbeat_disabled_by_default_in_dev_and_test(auth_client):
    """
    Verifies that the CEO supervisory heartbeat is safely disabled by default
    in development and testing environments and configured with 60s initial interval.
    """
    assert settings.CEO_HEARTBEAT_ENABLED is False
    assert settings.CEO_HEARTBEAT_INTERVAL_SECONDS == 60.0

    status_res = auth_client.get("/api/v1/world/heartbeat/status")
    assert status_res.status_code == 200
    data = status_res.json()
    assert data["enabled"] is False
    assert data["ceo_agent_id"] == "agent-exec-ceo"
    assert data["interval_seconds"] == 60.0


@pytest.mark.asyncio
async def test_ceo_heartbeat_detects_stalled_overdue_health_and_respects_approval_policy(
    db_session,
):
    """
    Verifies that CEO Heartbeat:
    1. Monitors active tasks, stalled tasks, and overdue work from real DB records only.
    2. Inspects department health accurately.
    3. Recommends task reassignment when appropriate.
    4. Respects approval policies by creating a pending ApprovalModel instead of silently
       reassigning the task, and never creates duplicate approvals or new tasks.
    5. Respects tenant isolation (ignores tasks/agents from other organizations).
    """
    ceo_heartbeat.reset_state_for_testing()
    now = datetime.utcnow()

    # Ensure an idle Engineering specialist exists in org_default_company as reassignment candidate
    idle_eng = AgentModel(
        id="agent-eng-idle-backup",
        organization_id="org_default_company",
        name="Idle Engineering Backup",
        role="Senior Backend Engineer",
        station="engineering_bay",
        status="idle",
        behavioral_state="IDLE",
    )
    db_session.add(idle_eng)

    # Mark agent-eng-lead as working on a stalled & overdue task
    eng_lead = (
        db_session.query(AgentModel)
        .filter(AgentModel.id == "agent-eng-lead")
        .first()
    )
    eng_lead.status = "working"
    eng_lead.behavioral_state = "WORKING"

    stalled_task = TaskModel(
        id="task-stalled-eng-1",
        organization_id="org_default_company",
        title="Stalled Infrastructure Migration",
        description="Running for 20 minutes without step progress",
        status="running",
        priority="high",
        assigned_agent_id="agent-eng-lead",
        created_at=now - timedelta(minutes=25),
        started_at=now - timedelta(minutes=20),
        updated_at=now - timedelta(minutes=20),
    )

    # Foreign tenant stalled task (must NOT appear in org_default_company heartbeat report)
    from backend.app.models.auth import OrganizationModel
    foreign_org = OrganizationModel(
        id="org_foreign_isolated",
        name="Foreign Isolated Org",
        slug="org-foreign-isolated",
        is_active=True,
    )
    db_session.add(foreign_org)
    db_session.flush()
    foreign_agent = AgentModel(
        id="agent-foreign-isolated-99",
        organization_id="org_foreign_isolated",
        name="Foreign Isolated Agent",
        role="Engineer",
        station="engineering_bay",
        status="working",
        behavioral_state="WORKING",
    )
    db_session.add(foreign_agent)
    db_session.flush()
    foreign_task = TaskModel(
        id="task-foreign-stalled-99",
        organization_id="org_foreign_isolated",
        title="Foreign Tenant Secret Task",
        description="Belongs to another organization",
        status="running",
        priority="urgent",
        assigned_agent_id=foreign_agent.id,
        created_at=now - timedelta(minutes=40),
        started_at=now - timedelta(minutes=40),
    )
    db_session.add_all([stalled_task, foreign_task])
    db_session.commit()

    initial_task_count = (
        db_session.query(TaskModel)
        .filter(TaskModel.organization_id == "org_default_company")
        .count()
    )

    report = await ceo_heartbeat.run_heartbeat_once(
        db=db_session,
        organization_id="org_default_company",
        stalled_threshold_seconds=300.0,
        overdue_threshold_seconds=900.0,
        require_approval_for_reassignment=True,
    )

    # 1. Verify no foreign tenant tasks leaked
    stalled_ids = {t["task_id"] for t in report["stalled_tasks"]}
    overdue_ids = {t["task_id"] for t in report["overdue_work"]}
    assert "task-stalled-eng-1" in stalled_ids
    assert "task-stalled-eng-1" in overdue_ids
    assert "task-foreign-stalled-99" not in stalled_ids
    assert "task-foreign-stalled-99" not in overdue_ids

    # 2. Verify Engineering department health reflects the stalled task
    eng_health = next(
        d for d in report["department_health"] if d["department"] == "Engineering"
    )
    assert eng_health["stalled_tasks"] >= 1
    assert eng_health["health_status"] == "critical"

    # 3. Verify reassignment recommendation & approval policy enforcement
    recs = report["reassignment_recommendations"]
    stalled_rec = next(
        (r for r in recs if r["task_id"] == "task-stalled-eng-1"), None
    )
    assert stalled_rec is not None
    assert stalled_rec["approval_required"] is True
    assert stalled_rec["approval_id"] is not None

    # Task must NOT have been silently reassigned without human approval
    db_session.refresh(stalled_task)
    assert stalled_task.assigned_agent_id == "agent-eng-lead"

    # Approval record must exist in pending status
    appr = (
        db_session.query(ApprovalModel)
        .filter(ApprovalModel.id == stalled_rec["approval_id"])
        .first()
    )
    assert appr is not None
    assert appr.status == "pending"
    assert appr.action_type == "task_reassignment"

    # 4. Running a second heartbeat pass must NOT create infinite tasks or duplicate approvals
    report_2 = await ceo_heartbeat.run_heartbeat_once(
        db=db_session,
        organization_id="org_default_company",
        stalled_threshold_seconds=300.0,
        overdue_threshold_seconds=900.0,
        require_approval_for_reassignment=True,
    )
    final_task_count = (
        db_session.query(TaskModel)
        .filter(TaskModel.organization_id == "org_default_company")
        .count()
    )
    assert final_task_count == initial_task_count

    pending_approvals_for_task = (
        db_session.query(ApprovalModel)
        .filter(
            ApprovalModel.task_id == "task-stalled-eng-1",
            ApprovalModel.action_type == "task_reassignment",
            ApprovalModel.status == "pending",
        )
        .all()
    )
    assert len(pending_approvals_for_task) == 1
    assert (
        report_2["reassignment_recommendations"][0]["approval_id"]
        == stalled_rec["approval_id"]
    )


@pytest.mark.asyncio
async def test_ceo_heartbeat_concurrency_timeout_and_budget_enforcement(
    db_session,
):
    """
    Verifies CEO Heartbeat safety invariants:
    - No duplicate concurrent heartbeat execution (`HEARTBEAT_ALREADY_RUNNING`).
    - Execution timeout enforcement (`HEARTBEAT_TIMEOUT`) with CEO agent released to IDLE.
    - Per-run and daily token/cost budget enforcement.
    """
    ceo_heartbeat.reset_state_for_testing()

    # 1. Duplicate concurrent execution guard
    entered_hook = asyncio.Event()
    release_hook = asyncio.Event()

    async def _slow_hook():
        entered_hook.set()
        await release_hook.wait()

    first_run = asyncio.create_task(
        ceo_heartbeat.run_heartbeat_once(
            db=db_session,
            organization_id="org_default_company",
            custom_step_hook=_slow_hook,
        )
    )
    await entered_hook.wait()

    with pytest.raises(ConflictError) as exc_info:
        await ceo_heartbeat.run_heartbeat_once(
            db=db_session,
            organization_id="org_default_company",
        )
    assert exc_info.value.code == "HEARTBEAT_ALREADY_RUNNING"

    release_hook.set()
    await first_run

    # 2. Execution timeout enforcement & CEO behavioral state recovery
    async def _hanging_hook():
        await asyncio.sleep(2.0)

    with pytest.raises(ConflictError) as timeout_exc:
        await ceo_heartbeat.run_heartbeat_once(
            db=db_session,
            organization_id="org_default_company",
            timeout_seconds=0.05,
            custom_step_hook=_hanging_hook,
        )
    assert timeout_exc.value.code == "HEARTBEAT_TIMEOUT"

    ceo_agent = (
        db_session.query(AgentModel)
        .filter(AgentModel.id == "agent-exec-ceo")
        .first()
    )
    assert ceo_agent.behavioral_state == "IDLE"
    assert ceo_agent.status == "idle"

    # 3. Token & Cost budget enforcement
    with pytest.raises(ConflictError) as token_exc:
        await ceo_heartbeat.run_heartbeat_once(
            db=db_session,
            organization_id="org_default_company",
            simulated_tokens=5000,
            max_tokens_per_run=2000,
        )
    assert token_exc.value.code == "HEARTBEAT_TOKEN_BUDGET_EXCEEDED"

    with pytest.raises(ConflictError) as cost_exc:
        await ceo_heartbeat.run_heartbeat_once(
            db=db_session,
            organization_id="org_default_company",
            simulated_tokens=100,
            simulated_cost_usd=0.25,
            max_cost_usd_per_run=0.05,
        )
    assert cost_exc.value.code == "HEARTBEAT_COST_BUDGET_EXCEEDED"

    with pytest.raises(ConflictError) as daily_exc:
        await ceo_heartbeat.run_heartbeat_once(
            db=db_session,
            organization_id="org_default_company",
            simulated_tokens=1500,
            max_tokens_per_run=2000,
            daily_token_budget=1000,
        )
    assert daily_exc.value.code == "HEARTBEAT_DAILY_TOKEN_BUDGET_EXCEEDED"
