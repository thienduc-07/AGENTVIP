import asyncio
import logging
from datetime import datetime
from typing import Dict, Optional
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.core.database import SessionLocal
from backend.app.models.task import TaskModel
from backend.app.models.task_step import TaskStepModel
from backend.app.models.agent import AgentModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.models.approval import ApprovalModel
from backend.app.models.artifact import ArtifactModel
from backend.app.agent_runtime.cancellation import CancellationToken, TaskCancelledException
from backend.app.agent_runtime.llm.base import redact_secrets
from backend.app.agent_runtime.llm.factory import get_llm_provider
from backend.app.agent_runtime.tools.registry import default_tool_registry
from backend.app.agent_runtime.policies.engine import policy_engine
from backend.app.agent_runtime.verifier import result_verifier
from backend.app.agent_runtime.planner.planner import Planner
from backend.app.agent_runtime.executor import ExecutionLoop, ExecutionResult
from backend.app.agent_runtime.general_agent import GENERAL_AGENT
from backend.app.websocket_manager import ws_manager
from backend.app.services.event_service import (
    event_service,
    TASK_STARTED,
    TASK_STATUS_CHANGED,
    TASK_COMPLETED,
    TASK_FAILED,
    TASK_CANCELLED,
    AGENT_WORKING,
    AGENT_IDLE,
    AGENT_WAITING_FOR_APPROVAL,
    AGENT_STATUS_CHANGED,
    TASK_STEP_STARTED,
    TASK_STEP_COMPLETED,
    APPROVAL_REQUIRED,
)
from backend.app.agent_runtime.memory.context_builder import memory_context_builder
from backend.app.agent_runtime.memory.extractor import memory_extractor

logger = logging.getLogger("grandline.runtime.dispatcher")

class TaskDispatcher:
    def __init__(self):
        self._running = False
        self._loop_task: Optional[asyncio.Task] = None
        self._active_cancellations: Dict[str, CancellationToken] = {}
        self.planner = Planner(tool_registry=default_tool_registry)
        self.executor = ExecutionLoop(
            tool_registry=default_tool_registry,
            policy_engine=policy_engine,
            verifier=result_verifier,
        )

    def request_cancellation(self, task_id: str, reason: str = "User requested cancellation") -> bool:
        token = self._active_cancellations.get(task_id)
        if token:
            token.cancel(reason)
            logger.info(f"Cancellation dispatched for active task '{task_id}'")
            return True
        return False

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._loop_task = asyncio.create_task(self._poll_loop())
        logger.info("Task Dispatcher worker started.")

    async def stop(self) -> None:
        self._running = False
        if self._loop_task:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass
        logger.info("Task Dispatcher worker stopped.")

    async def _poll_loop(self) -> None:
        while self._running:
            try:
                claimed_task_id = self._claim_next_task()
                if claimed_task_id:
                    await self._process_task(claimed_task_id)
                else:
                    await asyncio.sleep(settings.DISPATCHER_POLL_INTERVAL)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in dispatcher loop: {str(e)}", exc_info=True)
                await asyncio.sleep(settings.DISPATCHER_POLL_INTERVAL)

    def _claim_next_task(self) -> Optional[str]:
        db = SessionLocal()
        try:
            # Query oldest queued task
            task = (
                db.query(TaskModel)
                .filter(TaskModel.status == "queued")
                .order_by(TaskModel.created_at.asc())
                .first()
            )

            if not task:
                return None

            # Lifecycle guard before dispatch: check if assigned employee is ACTIVE
            from backend.app.models.recruitment import RecruitmentRecordModel
            rec = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == task.assigned_agent_id).first()
            agent = db.query(AgentModel).filter(AgentModel.id == task.assigned_agent_id).first()

            # 1. Lifecycle and Active guard
            if (rec and rec.lifecycle_state != "ACTIVE") or (agent and agent.status == "offline"):
                task_id = task.id
                task.status = "cancelled"
                state_desc = rec.lifecycle_state if rec else "offline"
                task.error_message = f"Task cancelled: assigned employee '{task.assigned_agent_id}' is in lifecycle state '{state_desc}'."
                task.completed_at = datetime.utcnow()
                task.updated_at = datetime.utcnow()
                db.commit()
                logger.warning(f"Task '{task_id}' auto-cancelled at dispatch: agent '{task.assigned_agent_id}' is {state_desc}.")
                return None

            # 2. Cross-tenant assignment integrity guard
            agent_org = rec.organization_id if rec else (agent.organization_id if agent else None)
            if agent_org and task.organization_id and agent_org != task.organization_id:
                task_id = task.id
                task.status = "cancelled"
                task.error_message = f"Task cancelled: cross-tenant assignment rejected. Agent '{agent.id if agent else task.assigned_agent_id}' belongs to organization '{agent_org}', not '{task.organization_id}'."
                task.completed_at = datetime.utcnow()
                task.updated_at = datetime.utcnow()
                db.commit()
                logger.error(f"Task '{task_id}' rejected at dispatch: cross-tenant assignment.")
                return None

            # 3. Missing or unpinned specialist version guard (VER-01 / VER-02)
            if rec and (getattr(rec, "is_legacy_unpinned", False) or not rec.specialist_version_id):
                task_id = task.id
                task.status = "cancelled"
                task.error_message = f"Execution blocked: Employee '{task.assigned_agent_id}' has an unpinned legacy version and requires administrative review."
                task.completed_at = datetime.utcnow()
                task.updated_at = datetime.utcnow()

                ev_diag = event_service.create_event(
                    db=db,
                    event_type="agent.version_integrity_blocked",
                    agent_id=task.assigned_agent_id,
                    task_id=task.id,
                    payload={
                        "task_id": task.id,
                        "agent_id": task.assigned_agent_id,
                        "organization_id": task.organization_id,
                        "reason": "Missing or unpinned specialist version",
                        "status": "REQUIRES_ADMINISTRATIVE_REVIEW",
                    },
                    commit=False
                )
                db.commit()
                ws_manager.broadcast_sync(ev_diag.to_envelope())
                logger.error(f"Task '{task_id}' blocked: agent '{task.assigned_agent_id}' has unpinned legacy version.")
                return None

            task_id = task.id
            task.status = "planning"
            task.started_at = datetime.utcnow()
            task.updated_at = datetime.utcnow()

            if agent:
                agent.status = "working"
                agent.behavioral_state = "PLANNING"
                agent.current_task_id = task.id
                agent.updated_at = datetime.utcnow()
                try:
                    from backend.app.services.behavioral_state_service import behavioral_state_service, BehavioralState
                    behavioral_state_service.transition_state(
                        db=db,
                        agent_id=agent.id,
                        target_state=BehavioralState.PLANNING,
                        organization_id=task.organization_id,
                        task_id=task.id,
                        reason="Task claimed for planning",
                        commit=False,
                        broadcast=True,
                    )
                except Exception as bs_err:
                    logger.debug(f"Behavioral state PLANNING transition on claim skipped: {bs_err}")

            # Record transactional events with monotonic sequence_id
            ev_task = event_service.create_event(
                db=db,
                event_type=TASK_STARTED,
                agent_id=task.assigned_agent_id,
                task_id=task.id,
                payload={"status": "planning", "previous_status": "queued", "organization_id": task.organization_id},
                commit=False
            )
            ev_agent = event_service.create_event(
                db=db,
                event_type=AGENT_WORKING,
                agent_id=task.assigned_agent_id,
                task_id=task.id,
                payload={"status": "working", "task_id": task.id, "organization_id": task.organization_id},
                commit=False
            )
            db.commit()

            # Broadcast envelopes to WebSocket clients
            ws_manager.broadcast_sync(ev_task.to_envelope())
            ws_manager.broadcast_sync(ev_agent.to_envelope())

            logger.info(f"Dispatcher claimed task '{task_id}' (Agent: '{task.assigned_agent_id}')")
            return task_id
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to claim task: {str(e)}")
            return None
        finally:
            db.close()

    async def _process_task(self, task_id: str, db: Optional[Session] = None) -> None:
        token = CancellationToken()
        self._active_cancellations[task_id] = token

        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True

        try:
            task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
            if not task:
                return

            # Lifecycle guard immediately before execution
            from backend.app.models.recruitment import RecruitmentRecordModel
            from backend.app.services.behavioral_state_service import behavioral_state_service, BehavioralState
            rec = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == task.assigned_agent_id).first()
            agent = db.query(AgentModel).filter(AgentModel.id == task.assigned_agent_id).first()
            if (rec and rec.lifecycle_state != "ACTIVE") or (agent and agent.status == "offline"):
                task.status = "cancelled"
                state_desc = rec.lifecycle_state if rec else "offline"
                task.error_message = f"Task execution rejected: employee '{task.assigned_agent_id}' is in lifecycle state '{state_desc}'."
                task.completed_at = datetime.utcnow()
                task.updated_at = datetime.utcnow()
                behavioral_state_service.safe_release_agent(
                    db=db,
                    agent_id=task.assigned_agent_id,
                    task_id=task.id,
                    reason=task.error_message,
                    commit=False,
                    broadcast=True,
                )
                db.commit()
                logger.warning(f"Task '{task_id}' rejected immediately before execution: agent is {state_desc}.")
                return

            # Cross-tenant integrity guard immediately before execution
            agent_org = rec.organization_id if rec else (agent.organization_id if agent else None)
            if agent_org and task.organization_id and agent_org != task.organization_id:
                task.status = "cancelled"
                task.error_message = f"Task execution rejected: cross-tenant violation. Employee '{task.assigned_agent_id}' belongs to organization '{agent_org}', not '{task.organization_id}'."
                task.completed_at = datetime.utcnow()
                task.updated_at = datetime.utcnow()
                behavioral_state_service.safe_release_agent(
                    db=db,
                    agent_id=task.assigned_agent_id,
                    task_id=task.id,
                    reason=task.error_message,
                    commit=False,
                    broadcast=True,
                )
                db.commit()
                logger.error(f"Task '{task_id}' rejected immediately before execution: cross-tenant violation.")
                return

            # Unpinned legacy version guard
            if rec and (getattr(rec, "is_legacy_unpinned", False) or not rec.specialist_version_id):
                task.status = "cancelled"
                task.error_message = f"Task execution rejected: employee '{task.assigned_agent_id}' has an unpinned legacy version."
                task.completed_at = datetime.utcnow()
                task.updated_at = datetime.utcnow()
                behavioral_state_service.safe_release_agent(
                    db=db,
                    agent_id=task.assigned_agent_id,
                    task_id=task.id,
                    reason=task.error_message,
                    commit=False,
                    broadcast=True,
                )
                db.commit()
                logger.error(f"Task '{task_id}' rejected immediately before execution: unpinned version.")
                return

            if getattr(task, "task_type", "single") == "workflow":
                from backend.app.agent_runtime.orchestrator.multi_agent_orchestrator import multi_agent_orchestrator
                await multi_agent_orchestrator.execute_workflow(task_id=task.id, token=token, db=db)
                return

            # Resolve authoritative agent definition and pinned specialist prompt
            from backend.app.agent_runtime.registry.agent_registry import default_agent_registry
            # Dual resolution: employee ID first, then specialized agent_type
            agent_def = default_agent_registry.get_by_employee_id(task.assigned_agent_id)
            if not agent_def and getattr(task, "agent_type", None):
                agent_def = default_agent_registry.get_by_type(task.agent_type)
            if not agent_def:
                agent_def = default_agent_registry.get(task.assigned_agent_id)

            if not agent_def and rec:
                from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel
                spec = db.query(SpecialistDefinitionModel).filter(SpecialistDefinitionModel.id == rec.specialist_definition_id).first()
                ver = db.query(SpecialistVersionModel).filter(SpecialistVersionModel.id == rec.specialist_version_id).first() if rec.specialist_version_id else None
                if spec and agent and ver:
                    from backend.app.services.recruitment_service import recruitment_service
                    recruitment_service._register_in_runtime(agent, spec, rec.department, ver)
                    agent_def = default_agent_registry.get_by_employee_id(task.assigned_agent_id) or default_agent_registry.get(task.assigned_agent_id)

            if agent_def:
                if not agent_def.enabled:
                    task.status = "cancelled"
                    task.error_message = f"Task execution rejected: agent '{task.assigned_agent_id}' is disabled in registry."
                    task.completed_at = datetime.utcnow()
                    task.updated_at = datetime.utcnow()
                    behavioral_state_service.safe_release_agent(
                        db=db,
                        agent_id=task.assigned_agent_id,
                        task_id=task.id,
                        reason=task.error_message,
                        commit=False,
                        broadcast=True,
                    )
                    db.commit()
                    logger.error(f"Task '{task_id}' rejected: agent '{task.assigned_agent_id}' is disabled.")
                    return

                agent_policy = agent_def.to_policy()
                agent_policy.agent_id = task.assigned_agent_id
                agent_role = agent_def.description
                effective_system_instruction = agent_def.system_prompt
                logger.info(
                    f"Resolved authoritative pinned instruction for task '{task.id}': "
                    f"agent='{task.assigned_agent_id}', agent_type='{agent_def.agent_type}', "
                    f"version_id='{getattr(rec, 'specialist_version_id', 'n/a')}', "
                    f"version_num='{getattr(rec, 'specialist_version_num', 1)}'"
                )
            elif task.assigned_agent_id in ("agent-general", "general") or getattr(task, "agent_type", None) == "general":
                # Explicit general agent execution
                gen_def = default_agent_registry.get("general")
                if gen_def and gen_def.enabled:
                    agent_role = gen_def.description
                    agent_policy = gen_def.to_policy()
                    agent_policy.agent_id = task.assigned_agent_id or "agent-general"
                    effective_system_instruction = gen_def.system_prompt
                else:
                    agent_role = "Executive General Agent"
                    agent_policy = GENERAL_AGENT.to_policy()
                    agent_policy.agent_id = task.assigned_agent_id or "agent-general"
                    effective_system_instruction = GENERAL_AGENT.system_prompt
            else:
                # Reject unresolvable employee identity without silent generic fallback
                task.status = "failed"
                task.error_message = f"Task execution rejected: unresolvable agent identity '{task.assigned_agent_id}'. No active AgentDefinition found."
                task.completed_at = datetime.utcnow()
                task.updated_at = datetime.utcnow()
                behavioral_state_service.safe_release_agent(
                    db=db,
                    agent_id=task.assigned_agent_id,
                    task_id=task.id,
                    terminal_state=BehavioralState.ERROR,
                    reason=task.error_message,
                    commit=False,
                    broadcast=True,
                )
                db.commit()
                logger.error(f"Task '{task_id}' rejected: unresolvable agent identity '{task.assigned_agent_id}'.")
                return

            # Transition to PLANNING behavioral state & broadcast initial WebSocket update
            if agent:
                try:
                    behavioral_state_service.transition_state(
                        db=db,
                        agent_id=agent.id,
                        target_state=BehavioralState.PLANNING,
                        organization_id=task.organization_id,
                        task_id=task.id,
                        reason="Generating execution plan",
                        commit=False,
                        broadcast=True,
                    )
                except Exception as bs_err:
                    logger.debug(f"Behavioral state PLANNING transition skipped: {bs_err}")
            ev_thinking = event_service.create_event(
                db,
                event_type=event_service.EVENT_AGENT_STATUS_CHANGED,
                agent_id=task.assigned_agent_id,
                task_id=task.id,
                payload={"status": "working", "sub_status": "THINKING", "behavioral_state": "PLANNING"}
            )
            db.commit()
            await ws_manager.broadcast_envelope(ev_thinking.to_envelope())

            # Check cancellation
            token.check()

            # 1. Plan Generation Phase
            llm_provider = get_llm_provider(
                organization_id=task.organization_id,
                task_id=task.id,
                agent_id=task.assigned_agent_id,
            )
            if hasattr(llm_provider, "bind_context"):
                llm_provider.bind_context(
                    organization_id=task.organization_id,
                    task_id=task.id,
                    agent_id=task.assigned_agent_id,
                    task_priority=getattr(task, "priority", None),
                )
            logger.info(f"Generating plan for task '{task_id}' via {getattr(llm_provider, 'provider_name', settings.LLM_PROVIDER)}")
            plan = await self.planner.create_plan(
                task_title=task.title,
                task_description=task.description,
                llm_provider=llm_provider,
                agent_role=agent_role,
            )

            # Persist plan steps to database
            # Clear any initial placeholder steps
            db.query(TaskStepModel).filter(TaskStepModel.task_id == task.id).delete()
            plan_step_dicts = []
            for step in plan.steps:
                db_step = TaskStepModel(
                    task_id=task.id,
                    step_index=step.step_index,
                    title=step.title,
                    description=step.description,
                    status=step.status,
                )
                db.add(db_step)
                plan_step_dicts.append({
                    "step_index": step.step_index,
                    "title": step.title,
                    "description": step.description,
                    "required_tool": step.required_tool,
                })

            if hasattr(llm_provider, "bind_context"):
                llm_provider.bind_context(plan_steps_count=len(plan_step_dicts))

            task.status = "running"
            task.updated_at = datetime.utcnow()
            ev_plan = event_service.create_event(
                db=db,
                event_type="task.plan_created",
                agent_id=task.assigned_agent_id,
                task_id=task.id,
                payload={"objective": plan.objective, "total_steps": len(plan.steps)},
                commit=False
            )
            ev_step_start = event_service.create_event(
                db=db,
                event_type=TASK_STEP_STARTED,
                agent_id=task.assigned_agent_id,
                task_id=task.id,
                payload={"step_index": 1, "title": plan.steps[0].title if plan.steps else "Execution"},
                commit=False
            )
            db.commit()

            await ws_manager.broadcast_envelope(ev_plan.to_envelope())
            await ws_manager.broadcast_envelope(ev_step_start.to_envelope())

            # Build memory context from persistent knowledge
            memory_context = memory_context_builder.build_context(
                db=db,
                task_title=task.title,
                task_description=task.description,
                agent_id=task.assigned_agent_id,
                task_id=task.id,
            )

            # 2. Execution Loop Phase
            exec_result: ExecutionResult = await self.executor.run(
                task_id=task.id,
                agent_id=task.assigned_agent_id,
                user_prompt=f"{task.title}\n{task.description}",
                llm_provider=llm_provider,
                agent_policy=agent_policy,
                cancellation_token=token,
                plan_steps=plan_step_dicts,
                db=db,
                system_instruction=effective_system_instruction,
                memory_context=memory_context,
            )

            # 3. Finalize State in Database
            task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
            if not task:
                return

            if exec_result.requires_approval and exec_result.approval_details:
                # Transition to waiting_approval
                task.status = "waiting_approval"
                task.updated_at = datetime.utcnow()
                if agent:
                    agent.status = "waiting_approval"
                    agent.behavioral_state = "WAITING"
                    agent.updated_at = datetime.utcnow()
                    try:
                        behavioral_state_service.transition_state(
                            db=db,
                            agent_id=agent.id,
                            target_state=BehavioralState.WAITING,
                            organization_id=task.organization_id,
                            task_id=task.id,
                            reason=exec_result.approval_details.get("description", "Requires authorization"),
                            commit=False,
                            broadcast=True,
                        )
                    except Exception as bs_err:
                        logger.debug(f"Behavioral state WAITING transition skipped: {bs_err}")

                approval = ApprovalModel(
                    task_id=task.id,
                    action_type=exec_result.approval_details.get("action_type", "high_risk_action"),
                    description=exec_result.approval_details.get("description", "Requires authorization"),
                    status="pending",
                    requested_at=datetime.utcnow(),
                )
                db.add(approval)
                db.flush()

                ev_appr = event_service.create_event(
                    db=db,
                    event_type=APPROVAL_REQUIRED,
                    agent_id=task.assigned_agent_id,
                    task_id=task.id,
                    payload={"approval_id": approval.id, "action_type": approval.action_type, "description": approval.description},
                    commit=False
                )
                ev_agent_wait = event_service.create_event(
                    db=db,
                    event_type=AGENT_WAITING_FOR_APPROVAL,
                    agent_id=task.assigned_agent_id,
                    task_id=task.id,
                    payload={"status": "waiting_approval", "behavioral_state": "WAITING"},
                    commit=False
                )
                db.commit()

                await ws_manager.broadcast_envelope(ev_appr.to_envelope())
                await ws_manager.broadcast_envelope(ev_agent_wait.to_envelope())

            elif exec_result.status == "completed":
                task.status = "completed"
                task.result_summary = exec_result.result_summary
                task.completed_at = datetime.utcnow()
                task.updated_at = datetime.utcnow()

                if agent:
                    behavioral_state_service.safe_release_agent(
                        db=db,
                        agent_id=agent.id,
                        organization_id=task.organization_id,
                        task_id=task.id,
                        terminal_state=BehavioralState.COMPLETED,
                        reason="Task completed successfully",
                        commit=False,
                        broadcast=True,
                    )

                # Mark all steps completed
                steps = db.query(TaskStepModel).filter(TaskStepModel.task_id == task.id).all()
                for s in steps:
                    s.status = "completed"
                    s.completed_at = datetime.utcnow()
                    event_service.create_event(
                        db=db,
                        event_type=TASK_STEP_COMPLETED,
                        agent_id=task.assigned_agent_id,
                        task_id=task.id,
                        payload={"step_index": s.step_index, "title": s.title},
                        commit=False
                    )

                # Persist artifacts metadata
                for art in exec_result.artifacts:
                    artifact_record = ArtifactModel(
                        task_id=task.id,
                        name=art.get("filename", "output_artifact"),
                        artifact_type="file",
                        storage_path=art.get("filepath", ""),
                        size_bytes=art.get("size_bytes", 0),
                        created_at=datetime.utcnow(),
                    )
                    db.add(artifact_record)

                ev_done = event_service.create_event(
                    db=db,
                    event_type=TASK_COMPLETED,
                    agent_id=task.assigned_agent_id,
                    task_id=task.id,
                    payload={
                        "result_summary": task.result_summary,
                        "artifacts_count": len(exec_result.artifacts),
                        "llm_provider": exec_result.llm_provider_name,
                        "llm_model": exec_result.llm_model_name,
                        "is_live_provider": exec_result.is_live_provider,
                        "prompt_tokens": exec_result.prompt_tokens,
                        "completion_tokens": exec_result.completion_tokens,
                        "total_tokens": exec_result.total_tokens,
                        "estimated_cost_usd": exec_result.estimated_cost_usd,
                    },
                    commit=False
                )
                ev_idle = event_service.create_event(
                    db=db,
                    event_type=AGENT_IDLE,
                    agent_id=task.assigned_agent_id,
                    task_id=task.id,
                    payload={"status": "idle", "behavioral_state": "IDLE"},
                    commit=False
                )
                db.commit()

                await ws_manager.broadcast_envelope(ev_done.to_envelope())
                await ws_manager.broadcast_envelope(ev_idle.to_envelope())

                # Propose candidate memory from successful execution
                try:
                    await memory_extractor.extract_and_propose(
                        db=db,
                        task_id=task.id,
                        agent_id=task.assigned_agent_id,
                        task_title=task.title,
                        task_description=task.description,
                        execution_summary=exec_result.summary or task.result_summary or "",
                        artifacts=exec_result.artifacts,
                        confidence=0.9,
                        auto_activate=False,
                    )
                except Exception as mem_err:
                    logger.warning(f"Could not extract memory from task '{task.id}': {mem_err}")

            else: # failed
                task.status = "failed"
                task.error_message = redact_secrets(exec_result.error_message or "Execution failed")
                task.result_summary = exec_result.result_summary
                task.completed_at = datetime.utcnow()
                task.updated_at = datetime.utcnow()

                if agent:
                    behavioral_state_service.safe_release_agent(
                        db=db,
                        agent_id=agent.id,
                        organization_id=task.organization_id,
                        task_id=task.id,
                        terminal_state=BehavioralState.ERROR,
                        reason=task.error_message,
                        commit=False,
                        broadcast=True,
                    )

                ev_fail = event_service.create_event(
                    db=db,
                    event_type=TASK_FAILED,
                    agent_id=task.assigned_agent_id,
                    task_id=task.id,
                    payload={
                        "error": task.error_message,
                        "llm_provider": exec_result.llm_provider_name,
                        "llm_model": exec_result.llm_model_name,
                        "is_live_provider": exec_result.is_live_provider,
                        "prompt_tokens": exec_result.prompt_tokens,
                        "completion_tokens": exec_result.completion_tokens,
                        "total_tokens": exec_result.total_tokens,
                        "estimated_cost_usd": exec_result.estimated_cost_usd,
                    },
                    commit=False
                )
                ev_idle = event_service.create_event(
                    db=db,
                    event_type=AGENT_IDLE,
                    agent_id=task.assigned_agent_id,
                    task_id=task.id,
                    payload={"status": "idle", "behavioral_state": "IDLE"},
                    commit=False
                )
                db.commit()

                await ws_manager.broadcast_envelope(ev_fail.to_envelope())
                await ws_manager.broadcast_envelope(ev_idle.to_envelope())

        except TaskCancelledException as e:
            logger.info(f"Task '{task_id}' aborted by cancellation token: {e}")
            try:
                from backend.app.services.behavioral_state_service import behavioral_state_service
                task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
                if task:
                    task.status = "cancelled"
                    task.updated_at = datetime.utcnow()
                    behavioral_state_service.safe_release_agent(
                        db=db,
                        agent_id=task.assigned_agent_id,
                        organization_id=task.organization_id,
                        task_id=task.id,
                        reason=str(e),
                        commit=False,
                        broadcast=True,
                    )
                    ev_cancel = event_service.create_event(
                        db=db,
                        event_type=TASK_CANCELLED,
                        agent_id=task.assigned_agent_id,
                        task_id=task.id,
                        payload={"reason": str(e)},
                        commit=False
                    )
                    ev_idle = event_service.create_event(
                        db=db,
                        event_type=AGENT_IDLE,
                        agent_id=task.assigned_agent_id,
                        task_id=task.id,
                        payload={"status": "idle", "behavioral_state": "IDLE"},
                        commit=False
                    )
                    db.commit()
                    await ws_manager.broadcast_envelope(ev_cancel.to_envelope())
                    await ws_manager.broadcast_envelope(ev_idle.to_envelope())
            except Exception as rollback_err:
                db.rollback()
                logger.error(f"Error handling task cancellation rollback: {rollback_err}")

        except Exception as e:
            safe_err = redact_secrets(str(e))
            logger.error(f"Unhandled error processing task '{task_id}': {safe_err}", exc_info=True)
            try:
                from backend.app.services.behavioral_state_service import behavioral_state_service, BehavioralState
                task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
                if task:
                    task.status = "failed"
                    task.error_message = safe_err
                    task.updated_at = datetime.utcnow()
                    behavioral_state_service.safe_release_agent(
                        db=db,
                        agent_id=task.assigned_agent_id,
                        organization_id=task.organization_id,
                        task_id=task.id,
                        terminal_state=BehavioralState.ERROR,
                        reason=safe_err,
                        commit=False,
                        broadcast=True,
                    )
                    db.commit()
            except Exception:
                db.rollback()
        finally:
            self._active_cancellations.pop(task_id, None)
            if close_db:
                db.close()

task_dispatcher = TaskDispatcher()
