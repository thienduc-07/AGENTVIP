import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
from sqlalchemy.orm import Session

from backend.app.core.database import SessionLocal
from backend.app.core.config import settings
from backend.app.models.task import TaskModel
from backend.app.models.agent import AgentModel
from backend.app.agent_runtime.cancellation import CancellationToken, TaskCancelledException
from backend.app.agent_runtime.registry.agent_registry import default_agent_registry
from backend.app.agent_runtime.planner.multi_agent_planner import MultiAgentPlanner, WorkflowPlan
from backend.app.agent_runtime.executor import ExecutionLoop, ExecutionResult
from backend.app.agent_runtime.verifier import result_verifier
from backend.app.agent_runtime.tools.registry import default_tool_registry
from backend.app.agent_runtime.policies.engine import policy_engine
from backend.app.agent_runtime.contracts.subtask_contract import SubtaskResultContract
from backend.app.agent_runtime.contracts.deliverable_contract import StructuredDeliverable
from backend.app.agent_runtime.lifecycle.task_lifecycle import task_lifecycle_engine, TaskStatus
from backend.app.agent_runtime.lifecycle.retry_manager import retry_manager
from backend.app.agent_runtime.workforce.workload_manager import specialist_workload_manager
from backend.app.agent_runtime.aggregator.result_aggregator import ResultAggregator
from backend.app.agent_runtime.llm.factory import get_llm_provider
from backend.app.agent_runtime.memory.context_builder import memory_context_builder
from backend.app.agent_runtime.memory.extractor import memory_extractor
from backend.app.websocket_manager import ws_manager
from backend.app.services.event_service import (
    event_service,
    WORKFLOW_CREATED,
    WORKFLOW_PLANNED,
    WORKFLOW_STARTED,
    WORKFLOW_COMPLETED,
    WORKFLOW_FAILED,
    SUBTASK_CREATED,
    SUBTASK_ASSIGNED,
    SUBTASK_STARTED,
    SUBTASK_COMPLETED,
    SUBTASK_FAILED,
    AGENT_WORKING,
    AGENT_IDLE,
    AGENT_DELEGATED,
    AGENT_RESULT_RECEIVED,
    WORKFLOW_REVIEW_STARTED,
    WORKFLOW_REVIEW_COMPLETED,
)

logger = logging.getLogger("grandline.runtime.orchestrator")

class MultiAgentOrchestrator:
    def __init__(self):
        self.planner = MultiAgentPlanner(registry=default_agent_registry)
        self.registry = default_agent_registry
        self.tool_registry = default_tool_registry
        self.policy_engine = policy_engine
        self.verifier = result_verifier

    async def execute_workflow(
        self,
        task_id: str,
        token: CancellationToken,
        db: Optional[Session] = None,
        max_concurrency: Optional[int] = None,
    ) -> None:
        """
        Executes a multi-agent workflow from end to end:
        1. Decomposes task into DAG subtasks
        2. Persists and broadcasts workflow structure
        3. Coordinates concurrent/sequential subtask dispatch adhering to DAG
        4. Transfers structured data contracts between agents
        5. Aggregates results, conducts quality review, and finalizes parent task
        """
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True

        try:
            parent_task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
            if not parent_task:
                logger.error(f"Workflow parent task '{task_id}' not found.")
                return

            logger.info(f"Starting Multi-Agent Orchestrator for workflow '{task_id}': {parent_task.title}")
            token.check()

            llm_provider = get_llm_provider(
                organization_id=parent_task.organization_id,
                task_id=parent_task.id,
                agent_id=parent_task.assigned_agent_id,
            )

            # 1. Plan Decomposition Phase
            from backend.app.services.behavioral_state_service import behavioral_state_service, BehavioralState
            if parent_task.assigned_agent_id:
                try:
                    behavioral_state_service.transition_state(
                        db=db,
                        agent_id=parent_task.assigned_agent_id,
                        target_state=BehavioralState.PLANNING,
                        organization_id=parent_task.organization_id,
                        task_id=parent_task.id,
                        reason="Decomposing multi-agent workflow DAG",
                        commit=False,
                        broadcast=True,
                    )
                except Exception as bs_err:
                    logger.debug(f"Workflow PLANNING state transition skipped: {bs_err}")

            if parent_task.status in ("created", "queued", "ready"):
                try:
                    task_lifecycle_engine.transition(
                        db=db,
                        task=parent_task,
                        target_status=TaskStatus.PLANNING,
                        reason="Decomposing multi-agent workflow DAG",
                        commit=False,
                        broadcast=False,
                    )
                except Exception as life_err:
                    logger.debug(f"Parent workflow transition to PLANNING skipped: {life_err}")

            existing_subtasks = db.query(TaskModel).filter(TaskModel.parent_task_id == task_id).all()
            if not existing_subtasks:
                logger.info(f"Planning subtasks for workflow '{task_id}'...")
                plan: WorkflowPlan = await self.planner.create_plan(
                    parent_task.title,
                    parent_task.description,
                    llm_provider
                )

                if parent_task.assigned_agent_id:
                    try:
                        behavioral_state_service.transition_state(
                            db=db,
                            agent_id=parent_task.assigned_agent_id,
                            target_state=BehavioralState.COMMUNICATING,
                            organization_id=parent_task.organization_id,
                            task_id=parent_task.id,
                            reason="Delegating subtasks across specialist workforce",
                            commit=False,
                            broadcast=True,
                        )
                    except Exception as bs_err:
                        logger.debug(f"Workflow COMMUNICATING state transition skipped: {bs_err}")

                # Broadcast workflow.planned
                ev_planned = event_service.create_event(
                    db=db,
                    event_type=WORKFLOW_PLANNED,
                    agent_id=parent_task.assigned_agent_id,
                    task_id=parent_task.id,
                    payload={
                        "workflow_id": parent_task.id,
                        "goal": plan.goal,
                        "subtasks_count": len(plan.subtasks),
                        "subtasks": [st.model_dump() for st in plan.subtasks]
                    },
                    commit=False
                )
                db.commit()
                await ws_manager.broadcast_envelope(ev_planned.to_envelope())

                # Persist subtasks as TaskModel records
                created_subtasks: List[TaskModel] = []
                for st_item in plan.subtasks:
                    agent_def = self.registry.get(st_item.agent_type) or self.registry.get("general")
                    preferred_id = agent_def.default_assigned_agent_id if agent_def else parent_task.assigned_agent_id

                    # Dynamic Capability & Workload-Aware Specialist Matching
                    matched_spec = specialist_workload_manager.find_best_specialist(
                        db=db,
                        organization_id=parent_task.organization_id,
                        required_agent_type=st_item.agent_type,
                        required_tools=agent_def.allowed_tools if agent_def else None,
                        required_permission_level=(
                            agent_def.permission_level.value
                            if hasattr(agent_def, "permission_level") and hasattr(agent_def.permission_level, "value")
                            else 0
                        ),
                        preferred_agent_id=preferred_id,
                    )
                    assigned_agent = matched_spec.id if matched_spec else preferred_id

                    initial_status = "queued" if len(st_item.dependencies) == 0 else "pending"
                    subtask_record = TaskModel(
                        parent_task_id=parent_task.id,
                        organization_id=parent_task.organization_id,
                        task_type="subtask",
                        agent_type=st_item.agent_type,
                        assigned_agent_id=assigned_agent,
                        title=st_item.title,
                        description=st_item.description,
                        status=initial_status,
                        priority=st_item.priority,
                        dependencies_json=st_item.dependencies,
                        input_data_json={
                            "subtask_key": st_item.subtask_key,
                            "expected_output": st_item.expected_output,
                            "dependencies": st_item.dependencies,
                        },
                        created_at=_utcnow(),
                    )
                    db.add(subtask_record)
                    db.flush()

                    # Emit specialist.assigned event
                    event_service.create_event(
                        db=db,
                        event_type="specialist.assigned",
                        agent_id=assigned_agent,
                        task_id=subtask_record.id,
                        organization_id=parent_task.organization_id,
                        payload={
                            "subtask_id": subtask_record.id,
                            "subtask_key": st_item.subtask_key,
                            "agent_id": assigned_agent,
                            "agent_type": st_item.agent_type,
                        },
                        commit=False,
                    )

                    ev_sub_created = event_service.create_event(
                        db=db,
                        event_type=SUBTASK_CREATED,
                        agent_id=assigned_agent,
                        task_id=subtask_record.id,
                        payload={
                            "subtask_id": subtask_record.id,
                            "subtask_key": st_item.subtask_key,
                            "parent_task_id": parent_task.id,
                            "title": subtask_record.title,
                            "agent_type": st_item.agent_type,
                            "assigned_agent_id": assigned_agent,
                            "dependencies": st_item.dependencies,
                            "status": initial_status,
                        },
                        commit=False
                    )
                    created_subtasks.append(subtask_record)

                db.commit()
                for st in created_subtasks:
                    # Broadcast subtask.created
                    env = db.query(TaskModel).filter(TaskModel.id == st.id).first()
                    # Trigger ws broadcast
                    await ws_manager.broadcast_envelope({
                        "schema_version": 1,
                        "event_id": f"evt_sub_{st.id[:8]}",
                        "event_type": SUBTASK_CREATED,
                        "occurred_at": _utcnow().isoformat() + "Z",
                        "sequence_id": None,
                        "agent_id": st.assigned_agent_id,
                        "task_id": st.id,
                        "payload": st.to_subtask_dict(),
                    })

            # 2. Transition Workflow to Running / In Progress
            try:
                task_lifecycle_engine.transition(
                    db=db,
                    task=parent_task,
                    target_status=TaskStatus.IN_PROGRESS,
                    reason="Starting multi-agent workflow execution DAG",
                    commit=False,
                    broadcast=False,
                )
            except Exception as life_err:
                parent_task.status = "running"
            parent_task.started_at = _utcnow()
            ev_wf_start = event_service.create_event(
                db=db,
                event_type=WORKFLOW_STARTED,
                agent_id=parent_task.assigned_agent_id,
                task_id=parent_task.id,
                payload={"workflow_id": parent_task.id, "status": "running"},
                commit=False
            )
            db.commit()
            await ws_manager.broadcast_envelope(ev_wf_start.to_envelope())

            # 2.5 Validate subtask DAG for circular dependencies before execution loop
            subtasks_for_validation = db.query(TaskModel).filter(TaskModel.parent_task_id == parent_task.id).all()
            try:
                self._validate_subtask_dag_cycles(subtasks_for_validation)
            except Exception as dag_err:
                logger.error(f"Workflow '{task_id}' DAG validation failed: {dag_err}")
                parent_task.status = "failed"
                parent_task.error_message = str(dag_err)
                parent_task.completed_at = _utcnow()
                for st in subtasks_for_validation:
                    if st.status not in ("completed", "cancelled"):
                        st.status = "failed"
                        st.error_message = f"Workflow DAG validation failed: {dag_err}"
                        st.completed_at = _utcnow()
                ev_wf_fail = event_service.create_event(
                    db=db,
                    event_type=WORKFLOW_FAILED,
                    agent_id=parent_task.assigned_agent_id,
                    task_id=parent_task.id,
                    payload={"workflow_id": parent_task.id, "status": "failed", "error": str(dag_err)},
                    commit=False
                )
                db.commit()
                await ws_manager.broadcast_envelope(ev_wf_fail.to_envelope())
                return

            # 3. Execution Coordinator Loop
            subtask_results: Dict[str, SubtaskResultContract] = {}
            max_workflow_duration = 300 # 5 minutes hard cap
            start_time = asyncio.get_event_loop().time()
            effective_concurrency = max_concurrency or getattr(settings, "MAX_WORKFLOW_CONCURRENCY", 4)

            while asyncio.get_event_loop().time() - start_time < max_workflow_duration:
                token.check()

                # Refresh subtasks from DB
                subtasks = db.query(TaskModel).filter(TaskModel.parent_task_id == parent_task.id).all()
                completed_keys = {
                    (st.input_data_json or {}).get("subtask_key")
                    for st in subtasks if st.status == "completed"
                }
                failed_keys = {
                    (st.input_data_json or {}).get("subtask_key")
                    for st in subtasks if st.status == "failed"
                }

                all_finished = all(st.status in ["completed", "failed", "cancelled"] for st in subtasks)
                if all_finished:
                    logger.info(f"All subtasks in workflow '{parent_task.id}' have terminated.")
                    break

                # Advance pending subtasks whose dependencies are complete
                for st in subtasks:
                    if st.status in ("pending", "ready"):
                        deps = st.dependencies_json or []
                        # If any dep failed, fail this subtask
                        if any(d in failed_keys for d in deps):
                            st.status = "failed"
                            st.error_message = "Dependency failed: Prerequisite subtask did not complete successfully."
                            st.completed_at = _utcnow()
                            ev_f = event_service.create_event(
                                db=db,
                                event_type=SUBTASK_FAILED,
                                agent_id=st.assigned_agent_id,
                                task_id=st.id,
                                payload={"subtask_id": st.id, "error": st.error_message},
                                commit=False
                            )
                            db.commit()
                            await ws_manager.broadcast_envelope(ev_f.to_envelope())
                            continue

                        # If all dependencies are completed, queue it
                        if all(d in completed_keys for d in deps):
                            st.status = "queued"
                            db.commit()
                            ev_q = event_service.create_event(
                                db=db,
                                event_type=SUBTASK_ASSIGNED,
                                agent_id=st.assigned_agent_id,
                                task_id=st.id,
                                payload={"subtask_id": st.id, "status": "queued"},
                                commit=False
                            )
                            db.commit()
                            await ws_manager.broadcast_envelope(ev_q.to_envelope())

                # Find queued subtasks ready for execution
                queued_subtasks = [st for st in subtasks if st.status == "queued"]
                if not queued_subtasks:
                    # Nothing ready right now, wait briefly for in-flight tasks
                    await asyncio.sleep(0.1)
                    continue

                # Process ready subtasks within concurrency limit (concurrent execution of independent subtasks)
                ready_batch = queued_subtasks[:effective_concurrency]
                if len(ready_batch) == 1:
                    token.check()
                    await self._execute_subtask(
                        db=db,
                        subtask=ready_batch[0],
                        parent_task=parent_task,
                        subtask_results=subtask_results,
                        llm_provider=llm_provider,
                        token=token
                    )
                elif len(ready_batch) > 1:
                    async def _run_subtask_isolated(st_item: TaskModel):
                        sub_db = None
                        executed = False
                        try:
                            from sqlalchemy.orm import sessionmaker
                            sub_session_factory = sessionmaker(bind=db.get_bind())
                            sub_db = sub_session_factory()
                            st_reloaded = sub_db.query(TaskModel).filter(TaskModel.id == st_item.id).first()
                            p_reloaded = sub_db.query(TaskModel).filter(TaskModel.id == parent_task.id).first()
                            if st_reloaded and p_reloaded:
                                executed = True
                                await self._execute_subtask(
                                    db=sub_db,
                                    subtask=st_reloaded,
                                    parent_task=p_reloaded,
                                    subtask_results=subtask_results,
                                    llm_provider=llm_provider,
                                    token=token,
                                )
                                return
                        except Exception as c_err:
                            logger.error(f"Concurrent subtask execution error for '{st_item.id}': {c_err}", exc_info=True)
                        finally:
                            if sub_db is not None:
                                sub_db.close()

                        # Only fallback to shared db session if isolated worker session could not resolve rows
                        if not executed:
                            await self._execute_subtask(
                                db=db,
                                subtask=st_item,
                                parent_task=parent_task,
                                subtask_results=subtask_results,
                                llm_provider=llm_provider,
                                token=token,
                            )

                    tasks_to_run = [_run_subtask_isolated(st) for st in ready_batch]
                    await asyncio.gather(*tasks_to_run, return_exceptions=True)
                    db.expire_all()

                await asyncio.sleep(0.05)

            # 4. Result Aggregation Phase
            subtasks = db.query(TaskModel).filter(TaskModel.parent_task_id == parent_task.id).all()
            aggregated = ResultAggregator.aggregate_workflow_results(
                parent_task=parent_task,
                subtasks=subtasks,
                subtask_results=subtask_results
            )

            parent_task.result_summary = aggregated["final_summary"]
            parent_task.completed_at = _utcnow()
            parent_task.output_data_json = {
                "evidence": aggregated["evidence"],
                "artifacts": aggregated["artifacts"],
                "reviewer_verdict": aggregated["reviewer_verdict"],
                "completed_count": aggregated["completed_count"],
                "total_subtasks": aggregated["total_subtasks"]
            }

            # CEO Supervisory Review & Deliverable Verification
            ev_ceo_review = event_service.create_event(
                db=db,
                event_type="ceo.review_completed",
                agent_id=parent_task.assigned_agent_id,
                task_id=parent_task.id,
                organization_id=parent_task.organization_id,
                payload={
                    "workflow_id": parent_task.id,
                    "reviewer_verdict": aggregated["reviewer_verdict"],
                    "is_success": aggregated["is_success"],
                    "completed_subtasks": aggregated["completed_count"],
                    "total_subtasks": aggregated["total_subtasks"],
                },
                commit=False,
            )

            try:
                parent_target = TaskStatus.COMPLETED if aggregated["is_success"] else TaskStatus.FAILED
                task_lifecycle_engine.transition(
                    db=db,
                    task=parent_task,
                    target_status=parent_target,
                    reason=f"Workflow finalized with verdict {aggregated['reviewer_verdict']}",
                    result_summary=parent_task.result_summary,
                    error_message=parent_task.error_message,
                    deliverable_verified=aggregated["is_success"],
                    commit=False,
                    broadcast=False,
                )
            except Exception as life_err:
                parent_task.status = "completed" if aggregated["is_success"] else "failed"

            if aggregated["is_success"]:
                ev_wf_end = event_service.create_event(
                    db=db,
                    event_type=WORKFLOW_COMPLETED,
                    agent_id=parent_task.assigned_agent_id,
                    task_id=parent_task.id,
                    payload={
                        "workflow_id": parent_task.id,
                        "status": "completed",
                        "summary": parent_task.result_summary[:300],
                        "reviewer_verdict": aggregated["reviewer_verdict"],
                    },
                    commit=False
                )
            else:
                parent_task.error_message = "One or more required subtasks failed during workflow execution."
                ev_wf_end = event_service.create_event(
                    db=db,
                    event_type=WORKFLOW_FAILED,
                    agent_id=parent_task.assigned_agent_id,
                    task_id=parent_task.id,
                    payload={
                        "workflow_id": parent_task.id,
                        "status": "failed",
                        "error": parent_task.error_message,
                    },
                    commit=False
                )

            # Reset primary agent status and behavioral state
            behavioral_state_service.safe_release_agent(
                db=db,
                agent_id=parent_task.assigned_agent_id,
                organization_id=parent_task.organization_id,
                task_id=parent_task.id,
                terminal_state=BehavioralState.COMPLETED if aggregated["is_success"] else BehavioralState.ERROR,
                reason=f"Workflow finalized with status {parent_task.status}",
                commit=False,
                broadcast=True,
            )

            db.commit()
            await ws_manager.broadcast_envelope(ev_wf_end.to_envelope())
            logger.info(f"Workflow '{parent_task.id}' finalized with status: {parent_task.status}")

            # Auto-persist verified shared memory for the successful workflow
            if aggregated["is_success"]:
                try:
                    await memory_extractor.extract_and_propose(
                        db=db,
                        task_id=parent_task.id,
                        agent_id=parent_task.assigned_agent_id,
                        task_title=parent_task.title,
                        task_description=parent_task.description,
                        execution_summary=parent_task.result_summary or "",
                        artifacts=aggregated.get("artifacts"),
                        confidence=0.95,
                        auto_activate=True,
                        scope_type="shared",
                        memory_type="shared",
                    )
                except Exception as mem_err:
                    logger.warning(f"Could not persist workflow memory for '{parent_task.id}': {mem_err}")

        except TaskCancelledException:
            logger.warning(f"Workflow '{task_id}' was cancelled by user.")
            from backend.app.services.behavioral_state_service import behavioral_state_service
            parent_task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
            if parent_task:
                parent_task.status = "cancelled"
                parent_task.error_message = "Workflow execution cancelled by user request."
                parent_task.completed_at = _utcnow()
                behavioral_state_service.safe_release_agent(
                    db=db,
                    agent_id=parent_task.assigned_agent_id,
                    organization_id=parent_task.organization_id,
                    task_id=parent_task.id,
                    reason="Workflow cancelled",
                    commit=False,
                    broadcast=True,
                )
                subtasks = db.query(TaskModel).filter(TaskModel.parent_task_id == parent_task.id).all()
                for st in subtasks:
                    if st.status in ("pending", "queued", "running"):
                        st.status = "cancelled"
                        st.completed_at = _utcnow()
                    behavioral_state_service.safe_release_agent(
                        db=db,
                        agent_id=st.assigned_agent_id,
                        organization_id=parent_task.organization_id,
                        task_id=st.id,
                        reason="Parent workflow cancelled",
                        commit=False,
                        broadcast=True,
                    )
                db.commit()
        except Exception as e:
            logger.error(f"Unhandled error in workflow '{task_id}': {e}", exc_info=True)
            db.rollback()
            from backend.app.services.behavioral_state_service import behavioral_state_service, BehavioralState
            parent_task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
            if parent_task:
                parent_task.status = "failed"
                parent_task.error_message = str(e)
                parent_task.completed_at = _utcnow()
                behavioral_state_service.safe_release_agent(
                    db=db,
                    agent_id=parent_task.assigned_agent_id,
                    organization_id=parent_task.organization_id,
                    task_id=parent_task.id,
                    terminal_state=BehavioralState.ERROR,
                    reason=str(e),
                    commit=False,
                    broadcast=True,
                )
                subtasks = db.query(TaskModel).filter(TaskModel.parent_task_id == parent_task.id).all()
                for st in subtasks:
                    if st.status in ("pending", "queued", "running"):
                        st.status = "failed"
                        st.error_message = f"Parent workflow aborted: {str(e)}"
                        st.completed_at = _utcnow()
                    behavioral_state_service.safe_release_agent(
                        db=db,
                        agent_id=st.assigned_agent_id,
                        organization_id=parent_task.organization_id,
                        task_id=st.id,
                        terminal_state=BehavioralState.ERROR,
                        reason=f"Parent workflow error: {str(e)}",
                        commit=False,
                        broadcast=True,
                    )
                db.commit()
        finally:
            if close_db:
                db.close()

    async def _execute_subtask(
        self,
        db: Session,
        subtask: TaskModel,
        parent_task: TaskModel,
        subtask_results: Dict[str, SubtaskResultContract],
        llm_provider: Any,
        token: CancellationToken,
    ) -> None:
        """Executes an individual specialized subtask."""
        from backend.app.services.behavioral_state_service import behavioral_state_service, BehavioralState
        subtask_key = (subtask.input_data_json or {}).get("subtask_key", subtask.id)
        agent_def = self.registry.get(subtask.agent_type) or self.registry.get("general")
        if agent_def is None:
            from backend.app.agent_runtime.registry.agent_registry import GENERAL_AGENT_DEF
            agent_def = GENERAL_AGENT_DEF
        assigned_agent_id = subtask.assigned_agent_id

        # 0. Check if subtask already has a verified deliverable from previous interrupted run
        existing_deliv = (subtask.output_data_json or {}).get("deliverable")
        if existing_deliv and existing_deliv.get("verification_status") == "VERIFIED":
            logger.info(f"Subtask '{subtask.id}' already has verified deliverable. Finalizing without re-execution.")
            subtask.status = "completed"
            subtask.completed_at = _utcnow()
            db.commit()
            contract = SubtaskResultContract(
                task_id=subtask.id,
                subtask_key=subtask_key,
                parent_task_id=parent_task.id,
                agent_id=assigned_agent_id,
                agent_type=subtask.agent_type or "general",
                status="completed",
                summary=existing_deliv.get("summary") or subtask.result_summary or "Recovered from verified deliverable",
                output=existing_deliv.get("summary") or subtask.result_summary or "Recovered from verified deliverable",
                evidence=existing_deliv.get("evidence", []),
                artifacts=existing_deliv.get("artifact_paths", []),
                raw_deliverable=existing_deliv,
            )
            subtask_results[subtask_key] = contract
            behavioral_state_service.safe_release_agent(
                db=db,
                agent_id=assigned_agent_id,
                reason="Subtask recovered from existing verified deliverable",
            )
            return

        # 1. Update subtask and agent to running
        subtask.status = "running"
        subtask.started_at = _utcnow()

        agent_entity = db.query(AgentModel).filter(AgentModel.id == assigned_agent_id).first()
        if agent_entity:
            agent_entity.status = "working"
            agent_entity.current_task_id = subtask.id
            try:
                from backend.app.services.navigation_service import navigation_service
                from backend.app.models.workstation import WorkstationAllocationModel

                ws_alloc = (
                    db.query(WorkstationAllocationModel)
                    .filter(
                        WorkstationAllocationModel.agent_id == assigned_agent_id,
                        WorkstationAllocationModel.organization_id == parent_task.organization_id,
                        WorkstationAllocationModel.allocation_status == "ASSIGNED",
                        WorkstationAllocationModel.is_virtual == False,  # noqa: E712
                    )
                    .first()
                )
                dest_target = (
                    ws_alloc.logical_workstation_id
                    if ws_alloc
                    else (getattr(agent_entity, "station", None) or "executive_suite")
                )
                nav_plan = navigation_service.start_movement(
                    db=db,
                    agent_id=assigned_agent_id,
                    destination=dest_target,
                    organization_id=parent_task.organization_id,
                    task_id=subtask.id,
                    allow_interrupt=True,
                    target_state_on_arrival="THINKING",
                    commit=False,
                    broadcast=True,
                )
                navigation_service.complete_movement(
                    db=db,
                    agent_id=assigned_agent_id,
                    movement_id=nav_plan.get("movement_id"),
                    target_state="THINKING",
                    organization_id=parent_task.organization_id,
                    task_id=subtask.id,
                    commit=False,
                    broadcast=True,
                )
            except Exception as nav_err:
                logger.debug(f"Subtask workstation navigation skipped: {nav_err}")
                try:
                    behavioral_state_service.transition_state(
                        db=db,
                        agent_id=assigned_agent_id,
                        target_state=BehavioralState.THINKING,
                        organization_id=parent_task.organization_id,
                        task_id=subtask.id,
                        reason=f"Starting subtask '{subtask.title}'",
                        commit=False,
                        broadcast=True,
                    )
                except Exception as bs_err:
                    logger.debug(f"Subtask THINKING state transition skipped: {bs_err}")

        ev_start = event_service.create_event(
            db=db,
            event_type=SUBTASK_STARTED,
            agent_id=assigned_agent_id,
            task_id=subtask.id,
            payload={
                "subtask_id": subtask.id,
                "subtask_key": subtask_key,
                "title": subtask.title,
                "agent_type": subtask.agent_type,
                "assigned_agent_id": assigned_agent_id,
            },
            commit=False
        )
        ev_ag_work = event_service.create_event(
            db=db,
            event_type=AGENT_WORKING,
            agent_id=assigned_agent_id,
            task_id=subtask.id,
            payload={"status": "working", "behavioral_state": "THINKING", "task_id": subtask.id},
            commit=False
        )
        db.commit()
        await ws_manager.broadcast_envelope(ev_start.to_envelope())
        await ws_manager.broadcast_envelope(ev_ag_work.to_envelope())

        # If reviewer subtask, emit review_started event
        if subtask.agent_type == "reviewer":
            ev_rev = event_service.create_event(
                db=db,
                event_type=WORKFLOW_REVIEW_STARTED,
                agent_id=assigned_agent_id,
                task_id=subtask.id,
                payload={"workflow_id": parent_task.id, "subtask_id": subtask.id},
                commit=False
            )
            db.commit()
            await ws_manager.broadcast_envelope(ev_rev.to_envelope())

        # 2. Build upstream context from data contract
        upstream_snippets = []
        deps = subtask.dependencies_json or []
        for dep_key in deps:
            # Find matching completed contract
            for contract in subtask_results.values():
                if contract.subtask_key == dep_key:
                    upstream_snippets.append(
                        f"--- Upstream Output from [{contract.agent_type}] ({dep_key}) ---\n"
                        f"Summary: {contract.summary}\n"
                        f"Content:\n{contract.output}\n"
                    )

        upstream_text = "\n".join(upstream_snippets)
        subtask_prompt = (
            f"Parent Workflow Objective: {parent_task.title}\n"
            f"Your Assigned Subtask: {subtask.title}\n"
            f"Detailed Directive: {subtask.description}\n"
        )
        if upstream_text:
            subtask_prompt += f"\nUpstream Findings & Inputs:\n{upstream_text}"

        # Build memory context for this specialized subtask
        subtask_memory_ctx = memory_context_builder.build_context(
            db=db,
            task_title=subtask.title,
            task_description=subtask.description,
            agent_id=assigned_agent_id,
            task_id=subtask.id,
        )

        # 3. Execute Loop (wrapped so unhandled exceptions never leave subtask agent WORKING)
        executor = ExecutionLoop(
            tool_registry=self.tool_registry,
            policy_engine=self.policy_engine,
            verifier=self.verifier,
        )

        agent_policy = agent_def.to_policy()
        agent_policy.agent_id = assigned_agent_id

        try:
            exec_res: ExecutionResult = await executor.run(
                task_id=subtask.id,
                agent_id=assigned_agent_id,
                user_prompt=subtask_prompt,
                llm_provider=llm_provider,
                agent_policy=agent_policy,
                cancellation_token=token,
                db=db,
                system_instruction=agent_def.system_prompt,
                memory_context=subtask_memory_ctx,
            )
        except TaskCancelledException:
            behavioral_state_service.safe_release_agent(
                db=db,
                agent_id=assigned_agent_id,
                organization_id=parent_task.organization_id,
                task_id=subtask.id,
                reason="Subtask cancelled",
                commit=False,
                broadcast=True,
            )
            db.commit()
            raise
        except Exception as sub_err:
            logger.error(f"Unhandled error in subtask '{subtask.id}': {sub_err}")
            exec_res = ExecutionResult(status="failed", error_message=str(sub_err))

        # 4. Handle Result & Emit Events
        if exec_res.success:
            artifact_str_list = [
                a.get("file_path", a.get("filepath", str(a))) if isinstance(a, dict) else str(a)
                for a in (exec_res.artifacts or [])
            ]
            artifact_hashes = {}
            for a_item in (exec_res.artifacts or []):
                p_str = a_item.get("file_path", a_item.get("filepath", str(a_item))) if isinstance(a_item, dict) else str(a_item)
                target_p = settings.WORKSPACE_ROOT / p_str
                if target_p.exists() and target_p.is_file():
                    try:
                        import hashlib
                        artifact_hashes[p_str] = hashlib.sha256(target_p.read_bytes()).hexdigest()
                    except Exception:
                        pass

            deliverable = StructuredDeliverable(
                task_id=subtask.id,
                parent_task_id=parent_task.id,
                agent_id=assigned_agent_id,
                organization_id=parent_task.organization_id,
                execution_id=f"exec_{subtask.id[:8]}",
                objective=subtask.title,
                actions_performed=[f"Executed subtask '{subtask_key}' via {assigned_agent_id}"],
                tools_invoked=exec_res.tool_results or [],
                evidence_references=artifact_str_list or [f"Verified by {assigned_agent_id}"],
                result_summary=exec_res.summary,
                artifact_paths=artifact_str_list,
                artifact_hashes=artifact_hashes,
                verification_status="VERIFIED",
                verification_notes="Deliverable output and artifacts verified by execution verifier.",
            )

            # Construct structured contract
            contract = SubtaskResultContract(
                task_id=subtask.id,
                subtask_key=subtask_key,
                parent_task_id=parent_task.id,
                agent_id=assigned_agent_id,
                agent_type=subtask.agent_type or "general",
                status="completed",
                summary=exec_res.summary,
                output=exec_res.summary,
                evidence=artifact_str_list or [f"Verified by {assigned_agent_id}"],
                artifact_ids=artifact_str_list,
                warnings=[],
                started_at=subtask.started_at.isoformat() if subtask.started_at else None,
                completed_at=_utcnow().isoformat(),
            )
            out_dict = contract.to_dict()
            out_dict["deliverable"] = deliverable.to_dict()
            subtask.output_data_json = out_dict
            subtask_results[subtask.id] = contract
            if subtask_key:
                subtask_results[subtask_key] = contract

            try:
                task_lifecycle_engine.transition(
                    db=db,
                    task=subtask,
                    target_status=TaskStatus.COMPLETED,
                    reason=f"Subtask '{subtask_key}' completed and verified",
                    deliverable=deliverable,
                    result_summary=exec_res.summary,
                    commit=False,
                    broadcast=False,
                )
            except Exception as life_err:
                subtask.status = "completed"
                subtask.completed_at = _utcnow()
                subtask.result_summary = exec_res.summary

            # Emit deliverable audit events
            ev_deliv_sub = event_service.create_event(
                db=db,
                event_type="deliverable.submitted",
                agent_id=assigned_agent_id,
                task_id=subtask.id,
                organization_id=parent_task.organization_id,
                payload=deliverable.to_dict(),
                commit=False,
            )
            ev_deliv_ver = event_service.create_event(
                db=db,
                event_type="deliverable.verified",
                agent_id=assigned_agent_id,
                task_id=subtask.id,
                organization_id=parent_task.organization_id,
                payload={"deliverable_id": deliverable.deliverable_id, "verification_status": "VERIFIED"},
                commit=False,
            )

            if agent_entity:
                try:
                    behavioral_state_service.transition_state(
                        db=db,
                        agent_id=assigned_agent_id,
                        target_state=BehavioralState.COMMUNICATING,
                        organization_id=parent_task.organization_id,
                        task_id=subtask.id,
                        reason=f"Transmitting subtask result '{subtask_key}'",
                        commit=False,
                        broadcast=True,
                    )
                except Exception as bs_err:
                    logger.debug(f"Subtask COMMUNICATING state transition skipped: {bs_err}")

            ev_done = event_service.create_event(
                db=db,
                event_type=SUBTASK_COMPLETED,
                agent_id=assigned_agent_id,
                task_id=subtask.id,
                payload={
                    "subtask_id": subtask.id,
                    "subtask_key": subtask_key,
                    "status": "completed",
                    "summary": subtask.result_summary[:200],
                },
                commit=False
            )
            ev_recv = event_service.create_event(
                db=db,
                event_type=AGENT_RESULT_RECEIVED,
                agent_id=assigned_agent_id,
                task_id=subtask.id,
                payload={"agent_id": assigned_agent_id, "subtask_key": subtask_key},
                commit=False
            )
            ev_idle = event_service.create_event(
                db=db,
                event_type=AGENT_IDLE,
                agent_id=assigned_agent_id,
                task_id=subtask.id,
                payload={"status": "idle", "behavioral_state": "IDLE"},
                commit=False
            )
            if agent_entity:
                behavioral_state_service.safe_release_agent(
                    db=db,
                    agent_id=assigned_agent_id,
                    organization_id=parent_task.organization_id,
                    task_id=subtask.id,
                    terminal_state=BehavioralState.COMPLETED,
                    reason=f"Subtask '{subtask_key}' completed",
                    commit=False,
                    broadcast=True,
                )

            db.commit()
            await ws_manager.broadcast_envelope(ev_deliv_sub.to_envelope())
            await ws_manager.broadcast_envelope(ev_deliv_ver.to_envelope())
            await ws_manager.broadcast_envelope(ev_done.to_envelope())
            await ws_manager.broadcast_envelope(ev_recv.to_envelope())
            await ws_manager.broadcast_envelope(ev_idle.to_envelope())

        else:
            # Check retry policy using RetryManager
            retry_decision = retry_manager.evaluate_retry(subtask, error_message=exec_res.error)
            if retry_decision.should_retry:
                retry_manager.record_retry_attempt(subtask, retry_decision, exec_res.error)
                try:
                    task_lifecycle_engine.transition(
                        db=db,
                        task=subtask,
                        target_status=TaskStatus.QUEUED,
                        reason=retry_decision.reason,
                        commit=False,
                        broadcast=False,
                    )
                except Exception as life_err:
                    subtask.status = "queued"

                if agent_entity:
                    behavioral_state_service.safe_release_agent(
                        db=db,
                        agent_id=assigned_agent_id,
                        organization_id=parent_task.organization_id,
                        task_id=subtask.id,
                        reason=f"Subtask retry {subtask.retry_count}/{subtask.max_retries}",
                        commit=False,
                        broadcast=True,
                    )
                ev_retry = event_service.create_event(
                    db=db,
                    event_type="task.retrying",
                    agent_id=assigned_agent_id,
                    task_id=subtask.id,
                    organization_id=parent_task.organization_id,
                    payload={"subtask_id": subtask.id, "attempt": subtask.retry_count, "backoff": retry_decision.backoff_seconds},
                    commit=False,
                )
                logger.warning(
                    f"Subtask '{subtask.id}' failed ({exec_res.error}). "
                    f"Retrying attempt {subtask.retry_count}/{subtask.max_retries}..."
                )
                db.commit()
                await ws_manager.broadcast_envelope(ev_retry.to_envelope())
            else:
                try:
                    task_lifecycle_engine.transition(
                        db=db,
                        task=subtask,
                        target_status=TaskStatus.FAILED,
                        error_message=exec_res.error or "Subtask execution failed.",
                        commit=False,
                        broadcast=False,
                    )
                except Exception as life_err:
                    subtask.status = "failed"
                    subtask.completed_at = _utcnow()
                    subtask.error_message = exec_res.error or "Subtask execution failed."

                ev_fail = event_service.create_event(
                    db=db,
                    event_type=SUBTASK_FAILED,
                    agent_id=assigned_agent_id,
                    task_id=subtask.id,
                    payload={"subtask_id": subtask.id, "error": subtask.error_message},
                    commit=False
                )
                ev_idle = event_service.create_event(
                    db=db,
                    event_type=AGENT_IDLE,
                    agent_id=assigned_agent_id,
                    task_id=subtask.id,
                    payload={"status": "idle", "behavioral_state": "IDLE"},
                    commit=False
                )
                if agent_entity:
                    behavioral_state_service.safe_release_agent(
                        db=db,
                        agent_id=assigned_agent_id,
                        organization_id=parent_task.organization_id,
                        task_id=subtask.id,
                        terminal_state=BehavioralState.ERROR,
                        reason=subtask.error_message,
                        commit=False,
                        broadcast=True,
                    )

                db.commit()
                await ws_manager.broadcast_envelope(ev_fail.to_envelope())
                await ws_manager.broadcast_envelope(ev_idle.to_envelope())

    def _validate_subtask_dag_cycles(self, subtasks: List[TaskModel]) -> None:
        """
        Validates the subtask dependency graph for cycles using topological sort.
        Raises DAGValidationError if a cycle is detected.
        """
        from backend.app.agent_runtime.planner.multi_agent_planner import DAGValidationError
        if not subtasks:
            return

        key_to_st = {}
        for st in subtasks:
            k = (st.input_data_json or {}).get("subtask_key") or st.id
            key_to_st[k] = st

        adj = {k: [] for k in key_to_st}
        in_degree = {k: 0 for k in key_to_st}

        for k, st in key_to_st.items():
            deps = st.dependencies_json or []
            for d in deps:
                if d == k:
                    raise DAGValidationError(f"Self-dependency detected: subtask '{k}' depends on itself.")
                if d not in key_to_st:
                    raise DAGValidationError(f"Non-existent dependency detected: subtask '{k}' depends on unknown '{d}'.")
                if d in adj:
                    adj[d].append(k)
                    in_degree[k] += 1

        queue = [k for k, deg in in_degree.items() if deg == 0]
        visited = 0
        while queue:
            curr = queue.pop(0)
            visited += 1
            for nxt in adj[curr]:
                in_degree[nxt] -= 1
                if in_degree[nxt] == 0:
                    queue.append(nxt)

        if visited != len(key_to_st):
            cycle_nodes = [k for k, deg in in_degree.items() if deg > 0]
            raise DAGValidationError(f"Circular dependency detected involving subtasks: {cycle_nodes}")

multi_agent_orchestrator = MultiAgentOrchestrator()
