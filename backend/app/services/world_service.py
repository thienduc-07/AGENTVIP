import uuid
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.task_step import TaskStepModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.services.workstation_service import ZONE_CONFIGS
from backend.app.agent_runtime.registry.agent_registry import default_agent_registry
from backend.app.schemas.world import (
    ActiveTaskSummary,
    AgentSnapshotItem,
    ActivitySnapshotItem,
    SpatialCoordinates,
    WorkstationSnapshotItem,
    OrganizationSummary,
    WorldSnapshotResponse,
)

logger = logging.getLogger("agency.world")

ZONE_METADATA: Dict[str, Dict[str, Any]] = {
    "Executive": {
        "zone": "executive_suite",
        "orientation": 0.0,
        "capabilities": ["secure_enclave", "board_terminal", "holographic_display"],
    },
    "Engineering": {
        "zone": "engineering_bay",
        "orientation": 90.0,
        "capabilities": ["code_sandbox", "high_compute", "dual_monitor"],
    },
    "AI Research": {
        "zone": "research_lab",
        "orientation": 270.0,
        "capabilities": ["gpu_cluster", "neural_indexing", "dual_monitor"],
    },
    "Marketing": {
        "zone": "marketing_studio",
        "orientation": 90.0,
        "capabilities": ["creative_suite", "media_rendering", "analytics_display"],
    },
    "Sales": {
        "zone": "sales_wing",
        "orientation": 270.0,
        "capabilities": ["crm_terminal", "comms_hub", "voip_station"],
    },
    "Finance": {
        "zone": "finance_office",
        "orientation": 0.0,
        "capabilities": ["ledger_vault", "audit_terminal", "secure_enclave"],
    },
    "Operations": {
        "zone": "operations_hub",
        "orientation": 0.0,
        "capabilities": ["workforce_monitor", "telemetry_hub", "access_control"],
    },
    "Customer Success": {
        "zone": "support_lounge",
        "orientation": 180.0,
        "capabilities": ["omnichannel_desk", "sla_monitor", "support_terminal"],
    },
}

TOTAL_PHYSICAL_DESK_CAPACITY = sum(z["max_physical_desks"] for z in ZONE_CONFIGS.values())

class WorldService:
    @staticmethod
    def build_world_snapshot(db: Session, organization_id: str) -> WorldSnapshotResponse:
        """
        Constructs an authoritative, point-in-time state representation of an organization's
        workforce, active execution activities, and physical/virtual workstations.
        Adheres strictly to zero-hallucination principles: only real database records are represented.
        """
        # 1. Authoritative sequence watermark from agent_events
        seq_query = db.query(func.coalesce(func.max(AgentEventModel.sequence_id), 0))
        if organization_id:
            seq_query = seq_query.filter(AgentEventModel.organization_id == organization_id)
        authoritative_sequence_id = int(seq_query.scalar() or 0)

        # 2. Batch-fetch all agents belonging to the tenant organization
        agents = (
            db.query(AgentModel)
            .filter(AgentModel.organization_id == organization_id)
            .order_by(AgentModel.created_at.asc())
            .all()
        )
        agent_ids = [a.id for a in agents]

        # 3. Batch-fetch recruitment records for lifecycle state & department
        rec_records: Dict[str, RecruitmentRecordModel] = {}
        if agent_ids:
            for r in (
                db.query(RecruitmentRecordModel)
                .filter(RecruitmentRecordModel.agent_id.in_(agent_ids))
                .all()
            ):
                rec_records[r.agent_id] = r

        # 4. Batch-fetch workstation allocations
        allocations = (
            db.query(WorkstationAllocationModel)
            .filter(WorkstationAllocationModel.organization_id == organization_id)
            .all()
        )
        alloc_by_agent: Dict[str, WorkstationAllocationModel] = {
            alloc.agent_id: alloc for alloc in allocations if alloc.agent_id
        }

        # 5. Batch-fetch referenced active tasks (avoiding N+1 queries)
        referenced_task_ids = [a.current_task_id for a in agents if a.current_task_id]
        tasks_map: Dict[str, TaskModel] = {}
        if referenced_task_ids:
            for t in db.query(TaskModel).filter(TaskModel.id.in_(referenced_task_ids)).all():
                tasks_map[t.id] = t

        # Batch-fetch active running steps for running tasks
        running_task_ids = [t.id for t in tasks_map.values() if t.status == "running"]
        active_steps_map: Dict[str, TaskStepModel] = {}
        if running_task_ids:
            for s in (
                db.query(TaskStepModel)
                .filter(
                    TaskStepModel.task_id.in_(running_task_ids),
                    TaskStepModel.status == "running",
                )
                .all()
            ):
                active_steps_map[s.task_id] = s

        # 6. Count total active tasks for the organization
        active_task_count = (
            db.query(func.count(TaskModel.id))
            .filter(
                TaskModel.organization_id == organization_id,
                TaskModel.status.in_(["queued", "planning", "running", "waiting_approval"]),
            )
            .scalar()
            or 0
        )

        agent_items: List[AgentSnapshotItem] = []
        activity_items: List[ActivitySnapshotItem] = []

        agent_model_map = {a.id: a for a in agents}

        for agent in agents:
            alloc = alloc_by_agent.get(agent.id)
            rec = rec_records.get(agent.id)

            # Resolve authoritative department
            if alloc and alloc.department:
                dept = alloc.department
            elif rec and rec.department:
                dept = rec.department
            else:
                agent_def = default_agent_registry.get_by_employee_id(agent.id)
                if agent_def and hasattr(agent_def, "department") and agent_def.department:
                    dept = agent_def.department
                else:
                    station_to_dept = {
                        "executive_suite": "Executive",
                        "engineering_bay": "Engineering",
                        "research_lab": "AI Research",
                        "ws-ai_research-01": "AI Research",
                        "marketing_studio": "Marketing",
                        "sales_wing": "Sales",
                        "finance_office": "Finance",
                        "operations_hub": "Operations",
                        "support_lounge": "Customer Success",
                    }
                    role_lower = (agent.role or "").lower()
                    id_lower = (agent.id or "").lower()
                    if agent.station in station_to_dept:
                        dept = station_to_dept[agent.station]
                    elif "engineer" in role_lower or "software" in role_lower or "mlops" in role_lower or "dev" in role_lower or "eng" in id_lower:
                        dept = "Engineering"
                    elif "research" in role_lower or "scientist" in role_lower or "ai" in id_lower:
                        dept = "AI Research"
                    elif "market" in role_lower or "growth" in role_lower or "brand" in role_lower or "mkt" in id_lower:
                        dept = "Marketing"
                    elif "sale" in role_lower:
                        dept = "Sales"
                    elif "finan" in role_lower or "treasur" in role_lower:
                        dept = "Finance"
                    elif "operat" in role_lower or "recruit" in role_lower or "ops" in id_lower:
                        dept = "Operations"
                    elif "support" in role_lower or "customer" in role_lower:
                        dept = "Customer Success"
                    else:
                        dept = "Executive"

            # Resolve authoritative lifecycle state
            if rec:
                lifecycle_state = rec.lifecycle_state
            else:
                agent_def = default_agent_registry.get_by_employee_id(agent.id)
                if agent_def and not agent_def.enabled:
                    lifecycle_state = "SUSPENDED"
                else:
                    lifecycle_state = "ACTIVE"

            # Resolve operational status, behavioral state & active task guard
            op_status = agent.status or "idle"
            behav_state = getattr(agent, "behavioral_state", None) or "IDLE"
            active_task: Optional[ActiveTaskSummary] = None
            task_obj: Optional[TaskModel] = None

            if agent.current_task_id and agent.current_task_id in tasks_map:
                t = tasks_map[agent.current_task_id]
                # Stale execution guard: if task has completed, failed, or cancelled, status cannot be working
                if t.status in ("completed", "failed", "cancelled"):
                    if op_status == "working":
                        op_status = "idle"
                    if behav_state in ("PLANNING", "THINKING", "WORKING", "COMMUNICATING"):
                        behav_state = "IDLE"
                else:
                    task_obj = t
                    active_task = ActiveTaskSummary(
                        task_id=t.id,
                        title=t.title,
                        status=t.status,
                        priority=t.priority,
                    )
            else:
                if op_status == "working" and behav_state != "MOVING":
                    # Stale working status with no matching active task
                    op_status = "idle"
                if behav_state in ("PLANNING", "THINKING", "WORKING", "COMMUNICATING"):
                    behav_state = "IDLE"

            # Synchronize behavioral_state if legacy code modified agent.status directly
            if lifecycle_state in ("SUSPENDED", "OFFBOARDED") or op_status == "offline":
                behav_state = "IDLE"
            elif op_status == "waiting_approval":
                behav_state = "WAITING"
            elif op_status == "error":
                behav_state = "ERROR"
            elif op_status == "working" and behav_state == "IDLE":
                if task_obj and task_obj.status == "planning":
                    behav_state = "PLANNING"
                else:
                    behav_state = "WORKING"

            assigned_ws_id = alloc.logical_workstation_id if alloc else None
            agent_pos = SpatialCoordinates(
                x=agent.pos_x if agent.pos_x is not None else (alloc.pos_x if alloc and alloc.pos_x is not None else 0.0),
                y=agent.pos_y if agent.pos_y is not None else (alloc.pos_y if alloc and alloc.pos_y is not None else 1.0),
                z=agent.pos_z if agent.pos_z is not None else (alloc.pos_z if alloc and alloc.pos_z is not None else 0.0),
            )
            target_pos: Optional[SpatialCoordinates] = None
            if getattr(agent, "target_pos_x", None) is not None and getattr(agent, "target_pos_z", None) is not None:
                target_pos = SpatialCoordinates(
                    x=float(agent.target_pos_x),
                    y=float(agent.target_pos_y if agent.target_pos_y is not None else 1.0),
                    z=float(agent.target_pos_z),
                )

            agent_items.append(
                AgentSnapshotItem(
                    employee_id=agent.id,
                    name=agent.name,
                    role=agent.role,
                    department=dept,
                    lifecycle_state=lifecycle_state,
                    operational_status=op_status,
                    behavioral_state=behav_state,
                    assigned_workstation=assigned_ws_id,
                    position=agent_pos,
                    target_position=target_pos,
                    target_destination=getattr(agent, "target_destination", None),
                    active_movement_id=getattr(agent, "active_movement_id", None),
                    current_active_task=active_task,
                )
            )

            # Determine granular activity
            activity_type = "idle_standby"
            subtask_id = None
            current_step = None
            current_tool = None
            started_at_str = None

            if lifecycle_state == "SUSPENDED":
                activity_type = "suspended"
            elif lifecycle_state == "OFFBOARDED" or op_status == "offline":
                activity_type = "offline"
            elif behav_state == "MOVING":
                activity_type = "moving"
                current_step = f"Navigating to {getattr(agent, 'target_destination', None) or agent.station}"
                started_at_str = agent.updated_at.isoformat() + "Z" if agent.updated_at else None
            elif op_status == "waiting_approval" or behav_state == "WAITING":
                activity_type = "waiting_approval"
                current_step = "Awaiting Board Authorization"
                if task_obj:
                    started_at_str = (
                        task_obj.updated_at.isoformat() + "Z"
                        if task_obj.updated_at
                        else None
                    )
            elif behav_state == "COMMUNICATING":
                activity_type = "communicating"
                current_step = task_obj.title if task_obj else "Inter-departmental coordination"
                started_at_str = agent.updated_at.isoformat() + "Z" if agent.updated_at else None
            elif op_status == "working" and task_obj:
                subtask_id = task_obj.id if task_obj.parent_task_id else None
                step = active_steps_map.get(task_obj.id)
                if step:
                    current_step = step.title
                    step_lower = step.title.lower()
                    if "tool" in step_lower or "execut" in step_lower:
                        activity_type = "tool_execution"
                        parts = step.title.split(":")
                        current_tool = parts[1].strip() if len(parts) > 1 else "tool"
                    elif "artifact" in step_lower or "write" in step_lower or "doc" in step_lower:
                        activity_type = "writing_artifact"
                    else:
                        activity_type = "thinking"
                    started_at_str = (
                        step.started_at.isoformat() + "Z" if step.started_at else None
                    )
                else:
                    activity_type = "thinking"
                    current_step = task_obj.title
                    started_at_str = (
                        task_obj.started_at.isoformat() + "Z"
                        if task_obj.started_at
                        else task_obj.created_at.isoformat() + "Z"
                    )
            elif op_status == "idle":
                activity_type = "idle_standby"
                started_at_str = (
                    agent.updated_at.isoformat() + "Z" if agent.updated_at else None
                )

            activity_items.append(
                ActivitySnapshotItem(
                    agent_id=agent.id,
                    activity_type=activity_type,
                    behavioral_state=behav_state,
                    task_id=task_obj.id if task_obj else None,
                    subtask_id=subtask_id,
                    current_execution_step=current_step,
                    current_tool=current_tool,
                    activity_started_at=started_at_str,
                )
            )

        # 7. Build workstation snapshot items
        workstation_items: List[WorkstationSnapshotItem] = []
        occupied_physical_count = 0

        for alloc in allocations:
            dept_meta = ZONE_METADATA.get(alloc.department, {})
            capabilities = dept_meta.get("capabilities", ["standard_workstation"])
            orientation = float(dept_meta.get("orientation", 0.0))

            assigned_agent = agent_model_map.get(alloc.agent_id) if alloc.agent_id else None

            # Determine occupancy
            if alloc.allocation_status == "UNASSIGNED":
                occupancy = "vacant"
                assigned_employee = None
            elif alloc.is_virtual:
                occupancy = "vacant"
                assigned_employee = alloc.agent_id
            elif not alloc.agent_id or not assigned_agent:
                occupancy = "vacant"
                assigned_employee = None
            else:
                assigned_employee = alloc.agent_id
                if assigned_agent.status in ("working", "waiting_approval", "idle"):
                    occupancy = "occupied"
                    occupied_physical_count += 1
                elif assigned_agent.status == "offline":
                    occupancy = "reserved"
                    occupied_physical_count += 1
                else:
                    occupancy = "occupied"
                    occupied_physical_count += 1

            desk_num_str = f" #{alloc.desk_number}" if alloc.desk_number else ""
            label = f"{alloc.office_zone} Desk{desk_num_str}"

            workstation_items.append(
                WorkstationSnapshotItem(
                    workstation_id=alloc.logical_workstation_id,
                    zone=alloc.office_zone,
                    label=label,
                    assigned_employee=assigned_employee,
                    occupancy_status=occupancy,
                    spatial_coordinates=SpatialCoordinates(
                        x=alloc.pos_x or 0.0,
                        y=alloc.pos_y or 0.0,
                        z=alloc.pos_z or 0.0,
                    ),
                    orientation=orientation,
                    capabilities=capabilities,
                    is_virtual=alloc.is_virtual,
                )
            )

        # 8. Compute organization summary
        active_employees = len([a for a in agent_items if a.lifecycle_state == "ACTIVE"])
        busy_employees = len(
            [
                act
                for act in activity_items
                if act.activity_type
                in ("thinking", "tool_execution", "writing_artifact", "waiting_approval")
            ]
        )
        available_workstations = max(0, TOTAL_PHYSICAL_DESK_CAPACITY - occupied_physical_count)

        summary = OrganizationSummary(
            total_employees=len(agent_items),
            active_employees=active_employees,
            busy_employees=busy_employees,
            available_workstations=available_workstations,
            active_tasks=active_task_count,
        )

        now_utc = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        return WorldSnapshotResponse(
            snapshot_id=f"snap_{uuid.uuid4().hex[:16]}",
            schema_version="3.3.1",
            generated_at=now_utc,
            organization_id=organization_id,
            sequence_id=authoritative_sequence_id,
            summary=summary,
            agents=agent_items,
            activities=activity_items,
            workstations=workstation_items,
        )

world_service = WorldService()
