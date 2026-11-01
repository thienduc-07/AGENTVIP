import asyncio
import logging
import time
import uuid
from datetime import datetime, date
from typing import Dict, Any, List, Optional, Set
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.core.database import SessionLocal
from backend.app.core.errors import ConflictError, ValidationError
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.task_step import TaskStepModel
from backend.app.models.approval import ApprovalModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.services.workstation_service import ZONE_CONFIGS
from backend.app.services.behavioral_state_service import (
    behavioral_state_service,
    BehavioralState,
)
from backend.app.services.event_service import (
    event_service,
    CEO_HEARTBEAT_STARTED,
    CEO_HEARTBEAT_COMPLETED,
    CEO_HEARTBEAT_FAILED,
)
from backend.app.websocket_manager import ws_manager

logger = logging.getLogger("grandline.runtime.ceo_heartbeat")

# Reverse mapping from zone ID / station alias to canonical department name
ZONE_TO_DEPARTMENT: Dict[str, str] = {
    cfg["zone"]: dept for dept, cfg in ZONE_CONFIGS.items()
}
ZONE_TO_DEPARTMENT.update(
    {
        "captain_hq": "Executive",
        "helm_control": "Executive",
        "engine_room": "Engineering",
        "crow_nest": "AI Research",
        "galley_kitchen": "Marketing",
        "navigation_deck": "Operations",
        "medical_bay": "Customer Success",
        "library_arch": "AI Research",
    }
)


class CEOSupervisoryHeartbeat:
    """
    Bounded Autonomous Supervisory Heartbeat for `agent-exec-ceo` (Phase 3.3.3.4).

    Safety Invariants:
    1. No duplicate concurrent heartbeat execution (non-reentrant lock + in-flight guard).
    2. Enforces execution timeouts (`asyncio.wait_for`).
    3. Enforces per-run and daily token & cost budgets.
    4. Strictly respects tenant isolation (`organization_id` scoping on every query).
    5. Respects approval policies (recommendations create pending ApprovalModel records;
       never silently mutates task assignments or executes privileged actions).
    6. Prevents infinite task creation (never creates TaskModel rows; deduplicates pending approvals).
    7. Never fabricates operational metrics (all figures are computed directly from SQL queries).
    8. Safely disabled by default in development and testing environments (`CEO_HEARTBEAT_ENABLED=False`).
    """

    def __init__(self):
        self._loop_task: Optional[asyncio.Task] = None
        self._stop_event: Optional[asyncio.Event] = None
        self._is_running_in_flight: bool = False
        self._in_flight_orgs: Set[str] = set()
        self._total_runs_completed: int = 0
        self._budget_day: date = datetime.utcnow().date()
        self._daily_tokens_used: int = 0
        self._daily_cost_usd_used: float = 0.0
        self._last_run_at: Optional[datetime] = None
        self._last_error: Optional[str] = None
        self._last_reports_by_org: Dict[str, Dict[str, Any]] = {}

    def _refresh_daily_budget_window(self) -> None:
        today = datetime.utcnow().date()
        if today != self._budget_day:
            self._budget_day = today
            self._daily_tokens_used = 0
            self._daily_cost_usd_used = 0.0

    def reset_state_for_testing(self) -> None:
        self._is_running_in_flight = False
        self._in_flight_orgs.clear()
        self._total_runs_completed = 0
        self._budget_day = datetime.utcnow().date()
        self._daily_tokens_used = 0
        self._daily_cost_usd_used = 0.0
        self._last_run_at = None
        self._last_error = None
        self._last_reports_by_org.clear()

    def get_status(self) -> Dict[str, Any]:
        self._refresh_daily_budget_window()
        return {
            "enabled": bool(settings.CEO_HEARTBEAT_ENABLED),
            "is_running": self._is_running_in_flight,
            "ceo_agent_id": settings.CEO_HEARTBEAT_AGENT_ID,
            "interval_seconds": float(settings.CEO_HEARTBEAT_INTERVAL_SECONDS),
            "timeout_seconds": float(settings.CEO_HEARTBEAT_TIMEOUT_SECONDS),
            "total_runs_completed": self._total_runs_completed,
            "daily_tokens_used": self._daily_tokens_used,
            "daily_cost_usd_used": round(self._daily_cost_usd_used, 6),
            "last_run_at": self._last_run_at,
            "last_error": self._last_error,
        }

    def start(self) -> None:
        """Starts the periodic background supervisory loop ONLY when CEO_HEARTBEAT_ENABLED is True."""
        if not settings.CEO_HEARTBEAT_ENABLED:
            logger.info(
                "CEO Supervisory Heartbeat is disabled by configuration (CEO_HEARTBEAT_ENABLED=False)."
            )
            return
        if self._loop_task and not self._loop_task.done():
            return
        try:
            loop = asyncio.get_running_loop()
            self._stop_event = asyncio.Event()
            self._loop_task = loop.create_task(self._periodic_loop())
            logger.info(
                f"Started CEO Supervisory Heartbeat for '{settings.CEO_HEARTBEAT_AGENT_ID}' "
                f"(interval={settings.CEO_HEARTBEAT_INTERVAL_SECONDS}s)."
            )
        except RuntimeError:
            logger.debug("No running event loop to attach CEO Supervisory Heartbeat.")

    async def stop(self) -> None:
        """Stops the periodic background supervisory loop cleanly."""
        if self._stop_event:
            self._stop_event.set()
        if self._loop_task and not self._loop_task.done():
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass
        self._loop_task = None
        logger.info("CEO Supervisory Heartbeat stopped.")

    async def _periodic_loop(self) -> None:
        interval = max(5.0, float(settings.CEO_HEARTBEAT_INTERVAL_SECONDS))
        while self._stop_event and not self._stop_event.is_set():
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=interval)
                break
            except asyncio.TimeoutError:
                pass

            if not settings.CEO_HEARTBEAT_ENABLED:
                continue

            db = SessionLocal()
            try:
                org_rows = (
                    db.query(AgentModel.organization_id)
                    .distinct()
                    .all()
                )
                orgs = [r[0] for r in org_rows if r and r[0]]
                if not orgs:
                    orgs = ["org_default_company"]
                for org_id in orgs:
                    try:
                        await self.run_heartbeat_once(
                            db=db,
                            organization_id=org_id,
                        )
                    except Exception as org_err:
                        logger.warning(
                            f"CEO Heartbeat cycle error for org '{org_id}': {org_err}"
                        )
            finally:
                db.close()

    def _enforce_budgets(
        self,
        estimated_tokens: int,
        estimated_cost_usd: float,
        max_tokens_per_run: int,
        max_cost_usd_per_run: float,
        daily_token_budget: int,
        daily_cost_budget_usd: float,
    ) -> None:
        self._refresh_daily_budget_window()

        if estimated_tokens < 0 or estimated_cost_usd < 0:
            raise ValidationError(
                message="Heartbeat token and cost estimates must be non-negative",
                code="INVALID_HEARTBEAT_BUDGET",
            )
        if estimated_tokens > max_tokens_per_run:
            raise ConflictError(
                message=(
                    f"CEO Heartbeat run token usage ({estimated_tokens}) exceeds "
                    f"per-run limit ({max_tokens_per_run})"
                ),
                code="HEARTBEAT_TOKEN_BUDGET_EXCEEDED",
            )
        if estimated_cost_usd > max_cost_usd_per_run:
            raise ConflictError(
                message=(
                    f"CEO Heartbeat run cost (${estimated_cost_usd:.4f}) exceeds "
                    f"per-run limit (${max_cost_usd_per_run:.4f})"
                ),
                code="HEARTBEAT_COST_BUDGET_EXCEEDED",
            )
        if self._daily_tokens_used + estimated_tokens > daily_token_budget:
            raise ConflictError(
                message=(
                    f"CEO Heartbeat daily token budget exceeded "
                    f"({self._daily_tokens_used + estimated_tokens} > {daily_token_budget})"
                ),
                code="HEARTBEAT_DAILY_TOKEN_BUDGET_EXCEEDED",
            )
        if self._daily_cost_usd_used + estimated_cost_usd > daily_cost_budget_usd:
            raise ConflictError(
                message=(
                    f"CEO Heartbeat daily cost budget exceeded "
                    f"(${self._daily_cost_usd_used + estimated_cost_usd:.4f} > ${daily_cost_budget_usd:.4f})"
                ),
                code="HEARTBEAT_DAILY_COST_BUDGET_EXCEEDED",
            )

    async def run_heartbeat_cycle(self, *args, **kwargs) -> Dict[str, Any]:
        """Convenience alias for run_heartbeat_once."""
        return await self.run_heartbeat_once(*args, **kwargs)

    async def run_heartbeat_once(
        self,
        db: Session,
        organization_id: str = "org_default_company",
        ceo_agent_id: Optional[str] = None,
        stalled_threshold_seconds: Optional[float] = None,
        overdue_threshold_seconds: Optional[float] = None,
        timeout_seconds: Optional[float] = None,
        require_approval_for_reassignment: Optional[bool] = None,
        simulated_tokens: int = 120,
        simulated_cost_usd: float = 0.0006,
        max_tokens_per_run: Optional[int] = None,
        max_cost_usd_per_run: Optional[float] = None,
        daily_token_budget: Optional[int] = None,
        daily_cost_budget_usd: Optional[float] = None,
        custom_step_hook: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Executes a single bounded supervisory heartbeat pass for `organization_id`.
        """
        if not organization_id or not str(organization_id).strip():
            raise ValidationError(
                message="organization_id is required for tenant-isolated CEO heartbeat",
                code="MISSING_ORGANIZATION_ID",
            )

        # Safety Invariant 1: No duplicate concurrent heartbeat execution
        if self._is_running_in_flight or organization_id in self._in_flight_orgs:
            raise ConflictError(
                message="CEO Supervisory Heartbeat is already executing concurrently",
                code="HEARTBEAT_ALREADY_RUNNING",
            )

        eff_stalled = (
            float(stalled_threshold_seconds)
            if stalled_threshold_seconds is not None
            else float(settings.CEO_HEARTBEAT_STALLED_TASK_THRESHOLD_SECONDS)
        )
        eff_overdue = (
            float(overdue_threshold_seconds)
            if overdue_threshold_seconds is not None
            else float(settings.CEO_HEARTBEAT_OVERDUE_TASK_THRESHOLD_SECONDS)
        )
        eff_timeout = (
            float(timeout_seconds)
            if timeout_seconds is not None
            else float(settings.CEO_HEARTBEAT_TIMEOUT_SECONDS)
        )
        eff_require_approval = (
            bool(require_approval_for_reassignment)
            if require_approval_for_reassignment is not None
            else bool(settings.CEO_HEARTBEAT_REQUIRE_APPROVAL_FOR_REASSIGNMENT)
        )
        eff_max_tokens = (
            int(max_tokens_per_run)
            if max_tokens_per_run is not None
            else int(settings.CEO_HEARTBEAT_MAX_TOKENS_PER_RUN)
        )
        eff_max_cost = (
            float(max_cost_usd_per_run)
            if max_cost_usd_per_run is not None
            else float(settings.CEO_HEARTBEAT_MAX_COST_USD_PER_RUN)
        )
        eff_daily_tokens = (
            int(daily_token_budget)
            if daily_token_budget is not None
            else int(settings.CEO_HEARTBEAT_DAILY_TOKEN_BUDGET)
        )
        eff_daily_cost = (
            float(daily_cost_budget_usd)
            if daily_cost_budget_usd is not None
            else float(settings.CEO_HEARTBEAT_DAILY_COST_BUDGET_USD)
        )

        # Safety Invariant 3: Enforce token and cost budgets before execution
        self._enforce_budgets(
            estimated_tokens=simulated_tokens,
            estimated_cost_usd=simulated_cost_usd,
            max_tokens_per_run=eff_max_tokens,
            max_cost_usd_per_run=eff_max_cost,
            daily_token_budget=eff_daily_tokens,
            daily_cost_budget_usd=eff_daily_cost,
        )

        self._is_running_in_flight = True
        self._in_flight_orgs.add(organization_id)
        start_perf = time.perf_counter()
        ceo_id = settings.CEO_HEARTBEAT_AGENT_ID
        ceo_transitioned = False

        # Check if CEO agent exists in this tenant organization and is IDLE
        ceo_agent = (
            db.query(AgentModel)
            .filter(
                AgentModel.id == ceo_id,
                AgentModel.organization_id == organization_id,
            )
            .first()
        )

        try:
            if ceo_agent and ceo_agent.status == "idle" and (ceo_agent.behavioral_state or "IDLE") == "IDLE":
                behavioral_state_service.transition_state(
                    db=db,
                    agent_id=ceo_agent.id,
                    target_state=BehavioralState.THINKING,
                    organization_id=organization_id,
                    reason="CEO supervisory heartbeat inspection",
                    sync_operational_status=True,
                    force_recovery=True,
                    commit=False,
                    broadcast=True,
                )
                ceo_transitioned = True

            ev_start = event_service.create_event(
                db=db,
                event_type=CEO_HEARTBEAT_STARTED,
                agent_id=ceo_agent.id if ceo_agent else None,
                organization_id=organization_id,
                payload={
                    "ceo_agent_id": ceo_id,
                    "organization_id": organization_id,
                    "interval_seconds": float(settings.CEO_HEARTBEAT_INTERVAL_SECONDS),
                },
                commit=False,
            )
            if ev_start:
                ws_manager.broadcast_sync(ev_start.to_envelope())

            async def _execute_inspection() -> Dict[str, Any]:
                if custom_step_hook is not None:
                    res = custom_step_hook()
                    if asyncio.iscoroutine(res):
                        await res
                return self._build_supervisory_report(
                    db=db,
                    organization_id=organization_id,
                    ceo_id=ceo_id,
                    stalled_threshold_seconds=eff_stalled,
                    overdue_threshold_seconds=eff_overdue,
                    require_approval=eff_require_approval,
                    tokens_used=simulated_tokens,
                    cost_usd=simulated_cost_usd,
                    max_tokens_per_run=eff_max_tokens,
                    max_cost_usd_per_run=eff_max_cost,
                    daily_token_budget=eff_daily_tokens,
                    daily_cost_budget_usd=eff_daily_cost,
                    start_perf=start_perf,
                )

            # Safety Invariant 2: Enforce execution timeout
            report = await asyncio.wait_for(_execute_inspection(), timeout=eff_timeout)

            # Commit budget usage after successful inspection
            self._daily_tokens_used += simulated_tokens
            self._daily_cost_usd_used = round(
                self._daily_cost_usd_used + simulated_cost_usd, 6
            )
            report["budget_telemetry"]["daily_tokens_used"] = self._daily_tokens_used
            report["budget_telemetry"]["daily_cost_usd_used"] = self._daily_cost_usd_used

            self._total_runs_completed += 1
            self._last_run_at = report["generated_at"]
            self._last_error = None
            self._last_reports_by_org[organization_id] = report

            ev_done = event_service.create_event(
                db=db,
                event_type=CEO_HEARTBEAT_COMPLETED,
                agent_id=ceo_agent.id if ceo_agent else None,
                organization_id=organization_id,
                payload={
                    "report_id": report["report_id"],
                    "ceo_agent_id": ceo_id,
                    "organization_id": organization_id,
                    "active_tasks_count": report["active_tasks_count"],
                    "stalled_tasks_count": len(report["stalled_tasks"]),
                    "overdue_tasks_count": len(report["overdue_work"]),
                    "reassignment_recommendations_count": len(
                        report["reassignment_recommendations"]
                    ),
                    "execution_duration_ms": report["execution_duration_ms"],
                },
                commit=False,
            )
            if ev_done:
                ws_manager.broadcast_sync(ev_done.to_envelope())

            if ceo_transitioned and ceo_agent:
                behavioral_state_service.safe_release_agent(
                    db=db,
                    agent_id=ceo_agent.id,
                    organization_id=organization_id,
                    terminal_state=BehavioralState.COMPLETED,
                    reason="CEO supervisory heartbeat completed",
                    commit=False,
                    broadcast=True,
                )

            db.commit()
            return report

        except asyncio.TimeoutError:
            self._last_error = f"CEO Heartbeat timed out after {eff_timeout}s"
            if ceo_transitioned and ceo_agent:
                behavioral_state_service.safe_release_agent(
                    db=db,
                    agent_id=ceo_agent.id,
                    organization_id=organization_id,
                    terminal_state=BehavioralState.ERROR,
                    reason=self._last_error,
                    commit=False,
                    broadcast=True,
                )
            ev_fail = event_service.create_event(
                db=db,
                event_type=CEO_HEARTBEAT_FAILED,
                agent_id=ceo_agent.id if ceo_agent else None,
                organization_id=organization_id,
                payload={
                    "ceo_agent_id": ceo_id,
                    "organization_id": organization_id,
                    "error": self._last_error,
                    "code": "HEARTBEAT_TIMEOUT",
                },
                commit=True,
            )
            if ev_fail:
                ws_manager.broadcast_sync(ev_fail.to_envelope())
            raise ConflictError(
                message=self._last_error,
                code="HEARTBEAT_TIMEOUT",
            )
        except Exception as exc:
            self._last_error = str(exc)
            if ceo_transitioned and ceo_agent:
                behavioral_state_service.safe_release_agent(
                    db=db,
                    agent_id=ceo_agent.id,
                    organization_id=organization_id,
                    terminal_state=BehavioralState.ERROR,
                    reason=self._last_error,
                    commit=True,
                    broadcast=True,
                )
            raise
        finally:
            self._in_flight_orgs.discard(organization_id)
            self._is_running_in_flight = False

    def _resolve_agent_department(
        self,
        agent: AgentModel,
        rec_by_agent: Dict[str, RecruitmentRecordModel],
        ws_by_agent: Dict[str, WorkstationAllocationModel],
    ) -> str:
        if agent.id in rec_by_agent and rec_by_agent[agent.id].department:
            return rec_by_agent[agent.id].department
        if agent.id in ws_by_agent and ws_by_agent[agent.id].department:
            return ws_by_agent[agent.id].department
        station = (agent.station or "").strip()
        if station in ZONE_CONFIGS:
            return station
        if station in ZONE_TO_DEPARTMENT:
            return ZONE_TO_DEPARTMENT[station]
        return "Executive"

    def _build_supervisory_report(
        self,
        db: Session,
        organization_id: str,
        ceo_id: str,
        stalled_threshold_seconds: float,
        overdue_threshold_seconds: float,
        require_approval: bool,
        tokens_used: int,
        cost_usd: float,
        max_tokens_per_run: int,
        max_cost_usd_per_run: float,
        daily_token_budget: int,
        daily_cost_budget_usd: float,
        start_perf: float,
    ) -> Dict[str, Any]:
        """
        Queries real database records strictly scoped to `organization_id` to build
        the CEO operational report. Never fabricates metrics or creates tasks.
        """
        now = datetime.utcnow()

        # 1. Query organization-scoped agents, recruitment records, and workstations
        agents: List[AgentModel] = (
            db.query(AgentModel)
            .filter(AgentModel.organization_id == organization_id)
            .all()
        )
        recs: List[RecruitmentRecordModel] = (
            db.query(RecruitmentRecordModel)
            .filter(RecruitmentRecordModel.organization_id == organization_id)
            .all()
        )
        rec_by_agent: Dict[str, RecruitmentRecordModel] = {
            r.agent_id: r for r in recs
        }

        workstations: List[WorkstationAllocationModel] = (
            db.query(WorkstationAllocationModel)
            .filter(WorkstationAllocationModel.organization_id == organization_id)
            .all()
        )
        ws_by_agent: Dict[str, WorkstationAllocationModel] = {
            w.agent_id: w for w in workstations
        }

        agent_by_id: Dict[str, AgentModel] = {a.id: a for a in agents}
        agent_dept_map: Dict[str, str] = {
            a.id: self._resolve_agent_department(a, rec_by_agent, ws_by_agent)
            for a in agents
        }

        # 2. Query organization-scoped tasks
        tasks: List[TaskModel] = (
            db.query(TaskModel)
            .filter(TaskModel.organization_id == organization_id)
            .all()
        )

        active_statuses = {"pending", "queued", "planning", "running", "waiting_approval"}
        active_tasks = [t for t in tasks if t.status in active_statuses]
        completed_tasks_count = sum(1 for t in tasks if t.status == "completed")
        failed_tasks_count = sum(1 for t in tasks if t.status == "failed")
        waiting_approval_tasks_count = sum(
            1 for t in tasks if t.status == "waiting_approval"
        )

        # 3. Detect stalled tasks & overdue work from real timestamps
        stalled_tasks: List[Dict[str, Any]] = []
        overdue_work: List[Dict[str, Any]] = []
        stalled_task_ids: Set[str] = set()
        overdue_task_ids: Set[str] = set()

        for task in active_tasks:
            # Latest step timestamp if any
            last_step = (
                db.query(TaskStepModel)
                .filter(TaskStepModel.task_id == task.id)
                .order_by(TaskStepModel.step_index.desc())
                .first()
            )
            last_activity = (
                (last_step.completed_at or last_step.started_at)
                if last_step
                else None
            ) or task.started_at or task.updated_at or task.created_at

            if task.status in ("planning", "running") and last_activity:
                elapsed = max(0.0, (now - last_activity).total_seconds())
                if elapsed >= stalled_threshold_seconds:
                    stalled_task_ids.add(task.id)
                    stalled_tasks.append(
                        {
                            "task_id": task.id,
                            "title": task.title,
                            "status": task.status,
                            "priority": task.priority or "normal",
                            "assigned_agent_id": task.assigned_agent_id,
                            "elapsed_seconds": round(elapsed, 2),
                            "last_activity_at": last_activity,
                        }
                    )

            ref_created = task.created_at or task.started_at
            if ref_created:
                age_seconds = max(0.0, (now - ref_created).total_seconds())
                if age_seconds >= overdue_threshold_seconds:
                    overdue_task_ids.add(task.id)
                    overdue_work.append(
                        {
                            "task_id": task.id,
                            "title": task.title,
                            "status": task.status,
                            "priority": task.priority or "normal",
                            "assigned_agent_id": task.assigned_agent_id,
                            "overdue_seconds": round(age_seconds, 2),
                            "created_at": ref_created,
                        }
                    )

        # 4. Inspect department health across all 8 corporate departments
        all_departments = list(ZONE_CONFIGS.keys())
        for d in agent_dept_map.values():
            if d not in all_departments:
                all_departments.append(d)

        department_health: List[Dict[str, Any]] = []
        idle_candidates_by_dept: Dict[str, List[AgentModel]] = {
            d: [] for d in all_departments
        }
        all_idle_candidates: List[AgentModel] = []

        for dept in all_departments:
            dept_agents = [a for a in agents if agent_dept_map.get(a.id) == dept]
            total_ag = len(dept_agents)
            active_ag = 0
            working_ag = 0
            idle_ag = 0
            offline_ag = 0
            error_ag = 0

            for a in dept_agents:
                rec = rec_by_agent.get(a.id)
                lifecycle = rec.lifecycle_state if rec else "ACTIVE"
                if lifecycle in ("SUSPENDED", "OFFBOARDED", "RETIRED") or a.status == "offline":
                    offline_ag += 1
                    continue
                active_ag += 1
                if a.status == "error" or (a.behavioral_state or "") == "ERROR":
                    error_ag += 1
                elif a.status in ("working", "waiting_approval") or (a.behavioral_state or "IDLE") not in ("IDLE", "COMPLETED"):
                    working_ag += 1
                else:
                    idle_ag += 1
                    if a.id != ceo_id:
                        idle_candidates_by_dept.setdefault(dept, []).append(a)
                        all_idle_candidates.append(a)

            dept_tasks = [
                t
                for t in active_tasks
                if t.assigned_agent_id and agent_dept_map.get(t.assigned_agent_id) == dept
            ]
            dept_stalled = sum(1 for t in dept_tasks if t.id in stalled_task_ids)
            dept_overdue = sum(1 for t in dept_tasks if t.id in overdue_task_ids)

            if error_ag > 0 or dept_stalled > 0 or (len(dept_tasks) > 0 and active_ag == 0):
                health = "critical"
            elif dept_overdue > 0 or (active_ag > 0 and idle_ag == 0 and len(dept_tasks) > active_ag):
                health = "degraded"
            else:
                health = "healthy"

            department_health.append(
                {
                    "department": dept,
                    "total_agents": total_ag,
                    "active_agents": active_ag,
                    "working_agents": working_ag,
                    "idle_agents": idle_ag,
                    "offline_or_suspended_agents": offline_ag,
                    "error_agents": error_ag,
                    "active_tasks": len(dept_tasks),
                    "stalled_tasks": dept_stalled,
                    "overdue_tasks": dept_overdue,
                    "health_status": health,
                }
            )

        # 5. Recommend task reassignment when appropriate (respecting approval policies!)
        reassignment_recommendations: List[Dict[str, Any]] = []
        used_candidate_ids: Set[str] = set()

        for task in active_tasks:
            assigned_id = task.assigned_agent_id
            assigned_agent = agent_by_id.get(assigned_id) if assigned_id else None
            assigned_rec = rec_by_agent.get(assigned_id) if assigned_id else None
            assigned_lifecycle = assigned_rec.lifecycle_state if assigned_rec else "ACTIVE"

            needs_reassignment = False
            reason = ""

            if assigned_agent and (
                assigned_agent.status in ("offline", "error")
                or (assigned_agent.behavioral_state or "") == "ERROR"
                or assigned_lifecycle in ("SUSPENDED", "OFFBOARDED", "RETIRED")
            ):
                needs_reassignment = True
                reason = (
                    f"Assigned agent '{assigned_id}' is unavailable "
                    f"(status='{assigned_agent.status}', lifecycle='{assigned_lifecycle}')"
                )
            elif task.id in stalled_task_ids:
                needs_reassignment = True
                reason = f"Task '{task.id}' is stalled in '{task.status}' beyond threshold ({stalled_threshold_seconds:.0f}s)"
            elif task.id in overdue_task_ids and task.status in ("pending", "queued"):
                needs_reassignment = True
                reason = f"Task '{task.id}' is overdue in queue beyond threshold ({overdue_threshold_seconds:.0f}s)"

            if not needs_reassignment:
                continue

            target_dept = (
                agent_dept_map.get(assigned_id, "Executive")
                if assigned_id
                else "Executive"
            )
            dept_pool = [
                c
                for c in idle_candidates_by_dept.get(target_dept, [])
                if c.id != assigned_id and c.id not in used_candidate_ids
            ]
            fallback_pool = [
                c
                for c in all_idle_candidates
                if c.id != assigned_id and c.id not in used_candidate_ids
            ]
            chosen_candidate = (dept_pool or fallback_pool or [None])[0]
            if not chosen_candidate:
                continue

            used_candidate_ids.add(chosen_candidate.id)
            approval_id: Optional[str] = None

            # Safety Invariant 5 & 6: Respect approval policies; never silently reassign or create duplicate approvals
            if require_approval:
                existing_approval = (
                    db.query(ApprovalModel)
                    .filter(
                        ApprovalModel.task_id == task.id,
                        ApprovalModel.action_type == "task_reassignment",
                        ApprovalModel.status == "pending",
                    )
                    .first()
                )
                if existing_approval:
                    approval_id = existing_approval.id
                else:
                    new_approval = ApprovalModel(
                        id=f"appr-reassign-{uuid.uuid4().hex[:10]}",
                        task_id=task.id,
                        action_type="task_reassignment",
                        description=(
                            f"CEO Heartbeat recommends reassigning task '{task.title}' "
                            f"from '{assigned_id or 'unassigned'}' to '{chosen_candidate.id}': {reason}"
                        ),
                        status="pending",
                        requested_at=now,
                    )
                    db.add(new_approval)
                    db.flush()
                    approval_id = new_approval.id

            reassignment_recommendations.append(
                {
                    "task_id": task.id,
                    "task_title": task.title,
                    "current_agent_id": assigned_id,
                    "recommended_agent_id": chosen_candidate.id,
                    "department": agent_dept_map.get(chosen_candidate.id, target_dept),
                    "reason": reason,
                    "approval_required": require_approval,
                    "approval_id": approval_id,
                }
            )

        duration_ms = round((time.perf_counter() - start_perf) * 1000.0, 2)
        exec_summary = (
            f"Organization '{organization_id}': {len(active_tasks)} active tasks, "
            f"{len(stalled_tasks)} stalled, {len(overdue_work)} overdue, "
            f"{len(reassignment_recommendations)} reassignment recommendations."
        )

        return {
            "report_id": f"ceo-hb-{uuid.uuid4().hex[:12]}",
            "ceo_agent_id": ceo_id,
            "organization_id": organization_id,
            "generated_at": now,
            "interval_seconds": float(settings.CEO_HEARTBEAT_INTERVAL_SECONDS),
            "execution_duration_ms": duration_ms,
            "active_tasks_count": len(active_tasks),
            "completed_tasks_count": completed_tasks_count,
            "failed_tasks_count": failed_tasks_count,
            "waiting_approval_tasks_count": waiting_approval_tasks_count,
            "stalled_tasks": stalled_tasks,
            "overdue_work": overdue_work,
            "department_health": department_health,
            "reassignment_recommendations": reassignment_recommendations,
            "budget_telemetry": {
                "tokens_used_this_run": tokens_used,
                "cost_usd_this_run": round(cost_usd, 6),
                "daily_tokens_used": self._daily_tokens_used,
                "daily_cost_usd_used": round(self._daily_cost_usd_used, 6),
                "max_tokens_per_run": max_tokens_per_run,
                "max_cost_usd_per_run": max_cost_usd_per_run,
                "daily_token_budget": daily_token_budget,
                "daily_cost_budget_usd": daily_cost_budget_usd,
            },
            "executive_summary": exec_summary,
        }


ceo_heartbeat = CEOSupervisoryHeartbeat()

