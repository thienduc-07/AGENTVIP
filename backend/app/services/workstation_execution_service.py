import uuid
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc, func

from backend.app.core.database import commit_with_retry
from backend.app.models.execution import ExecutionModel, TerminalLineModel
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.services.event_service import (
    event_service,
    EXECUTION_STARTED,
    EXECUTION_PROGRESS,
    EXECUTION_COMPLETED,
    EXECUTION_FAILED,
    EXECUTION_CANCELLED,
    TERMINAL_OUTPUT,
    TERMINAL_ERROR,
    FILE_OPERATION,
    TOOL_CALL_STARTED,
    TOOL_CALL_COMPLETED,
    TOOL_CALL_FAILED,
)
from backend.app.websocket_manager import ws_manager
from backend.app.core.security_sanitizer import (
    redact_secrets,
    sanitize_terminal_text,
    sanitize_file_path,
)

logger = logging.getLogger("grandline.services.workstation_execution")

class WorkstationExecutionService:
    @staticmethod
    def start_execution(
        db: Session,
        agent_id: str,
        organization_id: str,
        task_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
    ) -> ExecutionModel:
        """
        Initializes an authoritative execution cycle for an agent at their workstation.
        Persists the ExecutionModel record and emits EXECUTION_STARTED via WebSocket.
        """
        exec_id = f"exec_{uuid.uuid4().hex[:12]}"

        execution = ExecutionModel(
            id=exec_id,
            organization_id=organization_id,
            agent_id=agent_id,
            task_id=task_id,
            status="running",
            started_at=datetime.utcnow(),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(execution)
        commit_with_retry(db)
        db.refresh(execution)

        # Emit EXECUTION_STARTED event
        ev = event_service.create_event(
            db=db,
            event_type=EXECUTION_STARTED,
            agent_id=agent_id,
            task_id=task_id,
            organization_id=organization_id,
            execution_id=exec_id,
            correlation_id=correlation_id or task_id or exec_id,
            payload={
                "execution_id": exec_id,
                "agent_id": agent_id,
                "task_id": task_id,
                "status": "running",
                "started_at": execution.started_at.isoformat(),
            },
            commit=True,
        )

        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(ws_manager.broadcast_envelope(ev.to_envelope()))
        except Exception as e:
            logger.debug(f"Async broadcast for start_execution deferred: {e}")

        # Record initial system terminal line
        WorkstationExecutionService.append_terminal_line(
            db=db,
            execution_id=exec_id,
            stream="system",
            content=f"[SYSTEM] Execution runtime initialized for Agent '{agent_id}' (Execution ID: {exec_id})",
            broadcast=True,
        )

        return execution

    @staticmethod
    def append_terminal_line(
        db: Session,
        execution_id: str,
        stream: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        broadcast: bool = True,
    ) -> Optional[TerminalLineModel]:
        """
        Appends a sanitized, bounded terminal line to the execution's output buffer.
        Broadcasts TERMINAL_OUTPUT or TERMINAL_ERROR event in real time.
        """
        execution = db.query(ExecutionModel).filter(ExecutionModel.id == execution_id).first()
        if not execution:
            logger.warning(f"Cannot append terminal line: Execution '{execution_id}' not found.")
            return None

        # Sanitize and bound content to avoid unbounded single-record bloat and terminal injection
        clean_content = sanitize_terminal_text(content or "", max_length=4000)

        execution.total_lines = (execution.total_lines or 0) + 1
        line_num = execution.total_lines
        execution.updated_at = datetime.utcnow()

        line = TerminalLineModel(
            id=f"line_{uuid.uuid4().hex[:12]}",
            execution_id=execution_id,
            organization_id=execution.organization_id,
            agent_id=execution.agent_id,
            task_id=execution.task_id,
            line_number=line_num,
            stream=stream if stream in ("stdout", "stderr", "system") else "stdout",
            content=clean_content,
            metadata_json=metadata or {},
            timestamp=datetime.utcnow(),
        )
        db.add(line)
        commit_with_retry(db)
        db.refresh(line)

        if broadcast:
            ev_type = TERMINAL_ERROR if stream == "stderr" else TERMINAL_OUTPUT
            ev = event_service.create_event(
                db=db,
                event_type=ev_type,
                agent_id=execution.agent_id,
                task_id=execution.task_id,
                organization_id=execution.organization_id,
                execution_id=execution_id,
                payload={
                    "execution_id": execution_id,
                    "line_id": line.id,
                    "line_number": line_num,
                    "stream": line.stream,
                    "content": clean_content,
                    "metadata": metadata or {},
                    "timestamp": line.timestamp.isoformat(),
                },
                commit=True,
            )
            try:
                import asyncio
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(ws_manager.broadcast_envelope(ev.to_envelope()))
            except Exception as e:
                logger.debug(f"Async broadcast for terminal line deferred: {e}")

        return line

    @staticmethod
    def complete_execution(
        db: Session,
        execution_id: str,
        status: str = "completed",
        summary: Optional[str] = None,
        error: Optional[str] = None,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        total_tokens: int = 0,
        estimated_cost_usd: float = 0.0,
        tool_calls_count: int = 0,
        files_count: int = 0,
    ) -> Optional[ExecutionModel]:
        """
        Finalizes an execution run with authoritative telemetry and emits terminal completion notice.
        """
        execution = db.query(ExecutionModel).filter(ExecutionModel.id == execution_id).first()
        if not execution:
            return None

        clean_status = status.lower()
        if clean_status not in ("completed", "failed", "cancelled", "waiting_approval", "paused"):
            clean_status = "completed"

        execution.status = clean_status
        execution.completed_at = datetime.utcnow()
        execution.summary = redact_secrets(summary) if summary else None
        execution.error_message = redact_secrets(error) if error else None
        if prompt_tokens:
            execution.prompt_tokens = prompt_tokens
        if completion_tokens:
            execution.completion_tokens = completion_tokens
        if total_tokens:
            execution.total_tokens = total_tokens
        if estimated_cost_usd:
            execution.estimated_cost_usd = estimated_cost_usd
        if tool_calls_count:
            execution.tool_calls_count = tool_calls_count
        if files_count:
            execution.files_count = files_count
        execution.updated_at = datetime.utcnow()

        commit_with_retry(db)
        db.refresh(execution)

        # Add terminal log line
        stream_type = "stderr" if clean_status == "failed" else "system"
        status_msg = (
            f"[SYSTEM] Execution {execution_id} finished with status '{clean_status.upper()}'."
        )
        if clean_status == "failed" and error:
            status_msg += f" Error: {redact_secrets(error)}"
        elif summary:
            status_msg += f" Summary: {redact_secrets(summary)[:200]}"

        WorkstationExecutionService.append_terminal_line(
            db=db,
            execution_id=execution_id,
            stream=stream_type,
            content=status_msg,
            broadcast=True,
        )

        # Emit completion lifecycle event
        ev_type = (
            EXECUTION_FAILED if clean_status == "failed"
            else EXECUTION_CANCELLED if clean_status == "cancelled"
            else EXECUTION_COMPLETED
        )

        ev = event_service.create_event(
            db=db,
            event_type=ev_type,
            agent_id=execution.agent_id,
            task_id=execution.task_id,
            organization_id=execution.organization_id,
            execution_id=execution_id,
            payload={
                "execution_id": execution_id,
                "status": clean_status,
                "summary": execution.summary,
                "error": execution.error_message,
                "duration_seconds": (
                    (execution.completed_at - execution.started_at).total_seconds()
                    if execution.completed_at and execution.started_at
                    else 0.0
                ),
                "total_tokens": execution.total_tokens,
                "estimated_cost_usd": execution.estimated_cost_usd,
                "tool_calls_count": execution.tool_calls_count,
            },
            commit=True,
        )

        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(ws_manager.broadcast_envelope(ev.to_envelope()))
        except Exception as e:
            logger.debug(f"Async broadcast for complete_execution deferred: {e}")

        return execution

    @staticmethod
    def record_tool_call_started(
        db: Session,
        execution_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
        call_id: Optional[str] = None,
    ) -> None:
        """
        Emits terminal trace and TOOL_CALL_STARTED event for real-time workstation observation.
        """
        execution = db.query(ExecutionModel).filter(ExecutionModel.id == execution_id).first()
        if not execution:
            return

        clean_args = redact_secrets(str(arguments or {}))[:300]
        WorkstationExecutionService.append_terminal_line(
            db=db,
            execution_id=execution_id,
            stream="stdout",
            content=f"[TOOL_START] Invoking tool '{tool_name}' with args: {clean_args}",
            metadata={"tool_name": tool_name, "call_id": call_id},
            broadcast=True,
        )

        ev = event_service.create_event(
            db=db,
            event_type=TOOL_CALL_STARTED,
            agent_id=execution.agent_id,
            task_id=execution.task_id,
            organization_id=execution.organization_id,
            execution_id=execution_id,
            payload={
                "execution_id": execution_id,
                "call_id": call_id,
                "tool_name": tool_name,
                "arguments": arguments,
                "status": "RUNNING",
                "started_at": datetime.utcnow().isoformat(),
            },
            commit=True,
        )
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(ws_manager.broadcast_envelope(ev.to_envelope()))
        except Exception as e:
            logger.debug(f"Async broadcast for tool start deferred: {e}")

    @staticmethod
    def record_tool_call_completed(
        db: Session,
        execution_id: str,
        tool_name: str,
        duration_ms: int,
        output_summary: Optional[str] = None,
        call_id: Optional[str] = None,
    ) -> None:
        """
        Emits terminal trace and TOOL_CALL_COMPLETED event.
        """
        execution = db.query(ExecutionModel).filter(ExecutionModel.id == execution_id).first()
        if not execution:
            return

        execution.tool_calls_count = (execution.tool_calls_count or 0) + 1
        commit_with_retry(db)

        clean_output = redact_secrets(output_summary or "")[:300]
        msg = f"[TOOL_DONE] Tool '{tool_name}' succeeded in {duration_ms}ms"
        if clean_output:
            msg += f" -> {clean_output}"

        WorkstationExecutionService.append_terminal_line(
            db=db,
            execution_id=execution_id,
            stream="stdout",
            content=msg,
            metadata={"tool_name": tool_name, "duration_ms": duration_ms, "call_id": call_id},
            broadcast=True,
        )

        ev = event_service.create_event(
            db=db,
            event_type=TOOL_CALL_COMPLETED,
            agent_id=execution.agent_id,
            task_id=execution.task_id,
            organization_id=execution.organization_id,
            execution_id=execution_id,
            payload={
                "execution_id": execution_id,
                "call_id": call_id,
                "tool_name": tool_name,
                "duration_ms": duration_ms,
                "status": "SUCCEEDED",
                "output_summary": clean_output,
                "completed_at": datetime.utcnow().isoformat(),
            },
            commit=True,
        )
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(ws_manager.broadcast_envelope(ev.to_envelope()))
        except Exception as e:
            logger.debug(f"Async broadcast for tool completed deferred: {e}")

    @staticmethod
    def record_tool_call_failed(
        db: Session,
        execution_id: str,
        tool_name: str,
        error: str,
        duration_ms: int = 0,
        call_id: Optional[str] = None,
    ) -> None:
        """
        Emits terminal error trace and TOOL_CALL_FAILED event.
        """
        execution = db.query(ExecutionModel).filter(ExecutionModel.id == execution_id).first()
        if not execution:
            return

        clean_err = redact_secrets(error or "Unknown tool error")[:400]
        WorkstationExecutionService.append_terminal_line(
            db=db,
            execution_id=execution_id,
            stream="stderr",
            content=f"[TOOL_ERROR] Tool '{tool_name}' failed after {duration_ms}ms: {clean_err}",
            metadata={"tool_name": tool_name, "error": clean_err, "call_id": call_id},
            broadcast=True,
        )

        ev = event_service.create_event(
            db=db,
            event_type=TOOL_CALL_FAILED,
            agent_id=execution.agent_id,
            task_id=execution.task_id,
            organization_id=execution.organization_id,
            execution_id=execution_id,
            payload={
                "execution_id": execution_id,
                "call_id": call_id,
                "tool_name": tool_name,
                "duration_ms": duration_ms,
                "status": "FAILED",
                "error": clean_err,
                "failed_at": datetime.utcnow().isoformat(),
            },
            commit=True,
        )
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(ws_manager.broadcast_envelope(ev.to_envelope()))
        except Exception as e:
            logger.debug(f"Async broadcast for tool failed deferred: {e}")

    @staticmethod
    def record_file_operation(
        db: Session,
        execution_id: str,
        file_path: str,
        operation: str = "WRITE",
        size_bytes: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Records a real file operation (WRITE, READ, VERIFY, DELETE) performed during execution.
        """
        execution = db.query(ExecutionModel).filter(ExecutionModel.id == execution_id).first()
        if not execution:
            return

        clean_path = sanitize_file_path(file_path)

        execution.files_count = (execution.files_count or 0) + 1
        commit_with_retry(db)

        WorkstationExecutionService.append_terminal_line(
            db=db,
            execution_id=execution_id,
            stream="stdout",
            content=f"[FILE] {operation.upper()}: {clean_path}" + (f" ({size_bytes} bytes)" if size_bytes else ""),
            metadata={"file_path": clean_path, "operation": operation.upper(), "size_bytes": size_bytes},
            broadcast=True,
        )

        ev = event_service.create_event(
            db=db,
            event_type=FILE_OPERATION,
            agent_id=execution.agent_id,
            task_id=execution.task_id,
            organization_id=execution.organization_id,
            execution_id=execution_id,
            payload={
                "execution_id": execution_id,
                "file_path": clean_path,
                "operation": operation.upper(),
                "size_bytes": size_bytes,
                "metadata": metadata or {},
                "timestamp": datetime.utcnow().isoformat(),
            },
            commit=True,
        )
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(ws_manager.broadcast_envelope(ev.to_envelope()))
        except Exception as e:
            logger.debug(f"Async broadcast for file operation deferred: {e}")

    # =========================================================================
    # QUERY & INSPECTION METHODS
    # =========================================================================

    @staticmethod
    def resolve_agent_id(
        db: Session,
        identifier: str,
        organization_id: str,
    ) -> Optional[str]:
        """
        Resolves an agent ID from either a direct employee ID or a workstation identifier.
        """
        agent = (
            db.query(AgentModel.id)
            .filter(AgentModel.id == identifier, AgentModel.organization_id == organization_id)
            .first()
        )
        if agent:
            return agent[0]

        alloc = (
            db.query(WorkstationAllocationModel.agent_id)
            .filter(
                (WorkstationAllocationModel.id == identifier) | (WorkstationAllocationModel.logical_workstation_id == identifier),
                WorkstationAllocationModel.organization_id == organization_id,
            )
            .first()
        )
        return alloc[0] if alloc else None

    @staticmethod
    def get_workstation_for_agent(
        db: Session,
        agent_id: str,
        organization_id: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieves authoritative workstation execution status, active task, and desk allocation.
        """
        resolved_id = WorkstationExecutionService.resolve_agent_id(db, agent_id, organization_id)
        if not resolved_id:
            return None

        agent = (
            db.query(AgentModel)
            .filter(AgentModel.id == resolved_id, AgentModel.organization_id == organization_id)
            .first()
        )
        if not agent:
            return None

        allocation = (
            db.query(WorkstationAllocationModel)
            .filter(
                WorkstationAllocationModel.agent_id == resolved_id,
                WorkstationAllocationModel.organization_id == organization_id,
            )
            .first()
        )

        active_task = (
            db.query(TaskModel)
            .filter(
                TaskModel.assigned_agent_id == resolved_id,
                TaskModel.organization_id == organization_id,
                TaskModel.status.in_(["planning", "running", "waiting_approval", "queued"]),
            )
            .order_by(TaskModel.updated_at.desc())
            .first()
        )

        latest_execution = (
            db.query(ExecutionModel)
            .filter(
                ExecutionModel.agent_id == resolved_id,
                ExecutionModel.organization_id == organization_id,
            )
            .order_by(ExecutionModel.started_at.desc())
            .first()
        )

        return {
            "agent_id": agent.id,
            "agent_name": agent.name,
            "agent_role": agent.role,
            "agent_status": agent.status,
            "behavioral_state": getattr(agent, "behavioral_state", "IDLE"),
            "organization_id": organization_id,
            "workstation": allocation.to_dict() if allocation else None,
            "current_task": {
                "id": active_task.id,
                "title": active_task.title,
                "description": active_task.description,
                "status": active_task.status,
                "priority": active_task.priority,
                "started_at": active_task.started_at.isoformat() if active_task.started_at else None,
            } if active_task else None,
            "active_execution": latest_execution.to_dict() if latest_execution else None,
        }

    @staticmethod
    def list_executions_for_agent(
        db: Session,
        agent_id: str,
        organization_id: str,
        limit: int = 20,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        Lists paginated executions for an agent within the tenant organization.
        """
        resolved_id = WorkstationExecutionService.resolve_agent_id(db, agent_id, organization_id) or agent_id
        base_query = db.query(ExecutionModel).filter(
            ExecutionModel.agent_id == resolved_id,
            ExecutionModel.organization_id == organization_id,
        )
        total = base_query.count()
        records = (
            base_query.order_by(ExecutionModel.started_at.desc())
            .offset(offset)
            .limit(min(limit, 100))
            .all()
        )
        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "items": [r.to_dict() for r in records],
        }

    @staticmethod
    def list_events_for_agent(
        db: Session,
        agent_id: str,
        organization_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        Lists paginated execution events for an agent.
        """
        resolved_id = WorkstationExecutionService.resolve_agent_id(db, agent_id, organization_id) or agent_id
        base_query = db.query(AgentEventModel).filter(
            AgentEventModel.agent_id == resolved_id,
            AgentEventModel.organization_id == organization_id,
        )
        total = base_query.count()
        records = (
            base_query.order_by(AgentEventModel.sequence_id.desc(), AgentEventModel.created_at.desc())
            .offset(offset)
            .limit(min(limit, 200))
            .all()
        )
        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "items": [r.to_envelope() for r in records],
        }

    @staticmethod
    def get_terminal_history_for_agent(
        db: Session,
        agent_id: str,
        organization_id: str,
        execution_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        Retrieves paginated terminal lines for the agent's active or specified execution.
        """
        resolved_id = WorkstationExecutionService.resolve_agent_id(db, agent_id, organization_id) or agent_id
        target_exec_id = execution_id
        if not target_exec_id:
            latest = (
                db.query(ExecutionModel.id)
                .filter(
                    ExecutionModel.agent_id == resolved_id,
                    ExecutionModel.organization_id == organization_id,
                )
                .order_by(ExecutionModel.started_at.desc())
                .first()
            )
            if latest:
                target_exec_id = latest[0]

        if not target_exec_id:
            return {"execution_id": None, "total": 0, "limit": limit, "offset": offset, "lines": []}

        base_query = db.query(TerminalLineModel).filter(
            TerminalLineModel.execution_id == target_exec_id,
            TerminalLineModel.organization_id == organization_id,
        )
        total = base_query.count()
        records = (
            base_query.order_by(TerminalLineModel.line_number.asc())
            .offset(offset)
            .limit(min(limit, 200))
            .all()
        )
        return {
            "execution_id": target_exec_id,
            "total": total,
            "limit": limit,
            "offset": offset,
            "lines": [r.to_dict() for r in records],
        }

    @staticmethod
    def get_execution(
        db: Session,
        execution_id: str,
        organization_id: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieves an execution record with strict tenant isolation.
        """
        record = (
            db.query(ExecutionModel)
            .filter(
                ExecutionModel.id == execution_id,
                ExecutionModel.organization_id == organization_id,
            )
            .first()
        )
        return record.to_dict() if record else None

    @staticmethod
    def list_events_for_execution(
        db: Session,
        execution_id: str,
        organization_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        Lists paginated events scoped to a specific execution run.
        """
        base_query = db.query(AgentEventModel).filter(
            AgentEventModel.execution_id == execution_id,
            AgentEventModel.organization_id == organization_id,
        )
        total = base_query.count()
        records = (
            base_query.order_by(AgentEventModel.sequence_id.asc(), AgentEventModel.created_at.asc())
            .offset(offset)
            .limit(min(limit, 200))
            .all()
        )
        return {
            "execution_id": execution_id,
            "total": total,
            "limit": limit,
            "offset": offset,
            "items": [r.to_envelope() for r in records],
        }

    @staticmethod
    def get_terminal_history_for_execution(
        db: Session,
        execution_id: str,
        organization_id: str,
        limit: int = 100,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        Retrieves paginated terminal lines for a specific execution.
        """
        base_query = db.query(TerminalLineModel).filter(
            TerminalLineModel.execution_id == execution_id,
            TerminalLineModel.organization_id == organization_id,
        )
        total = base_query.count()
        records = (
            base_query.order_by(TerminalLineModel.line_number.asc())
            .offset(offset)
            .limit(min(limit, 200))
            .all()
        )
        return {
            "execution_id": execution_id,
            "total": total,
            "limit": limit,
            "offset": offset,
            "lines": [r.to_dict() for r in records],
        }

workstation_execution_service = WorkstationExecutionService()
