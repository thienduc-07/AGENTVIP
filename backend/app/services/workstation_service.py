import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.models.agent import AgentModel

logger = logging.getLogger("agency.workstation")

# Department zone definitions and physical visual desk capacities
ZONE_CONFIGS: Dict[str, Dict[str, Any]] = {
    "Engineering": {
        "zone": "engineering_bay",
        "base_x": -14.0,
        "base_y": 1.0,
        "base_z": -4.0,
        "max_physical_desks": 12,
        "desk_spacing_x": 2.2,
        "desk_spacing_z": 2.0,
    },
    "AI Research": {
        "zone": "research_lab",
        "base_x": 14.0,
        "base_y": 1.0,
        "base_z": -4.0,
        "max_physical_desks": 10,
        "desk_spacing_x": 2.2,
        "desk_spacing_z": 2.0,
    },
    "Marketing": {
        "zone": "marketing_studio",
        "base_x": -14.0,
        "base_y": 1.0,
        "base_z": 10.0,
        "max_physical_desks": 8,
        "desk_spacing_x": 2.2,
        "desk_spacing_z": 2.0,
    },
    "Sales": {
        "zone": "sales_wing",
        "base_x": 14.0,
        "base_y": 1.0,
        "base_z": 10.0,
        "max_physical_desks": 8,
        "desk_spacing_x": 2.2,
        "desk_spacing_z": 2.0,
    },
    "Operations": {
        "zone": "operations_hub",
        "base_x": -6.0,
        "base_y": 1.0,
        "base_z": 20.0,
        "max_physical_desks": 6,
        "desk_spacing_x": 2.2,
        "desk_spacing_z": 2.0,
    },
    "Finance": {
        "zone": "finance_office",
        "base_x": 6.0,
        "base_y": 1.0,
        "base_z": 20.0,
        "max_physical_desks": 6,
        "desk_spacing_x": 2.2,
        "desk_spacing_z": 2.0,
    },
    "Customer Success": {
        "zone": "support_lounge",
        "base_x": 0.0,
        "base_y": 1.0,
        "base_z": 11.0,
        "max_physical_desks": 6,
        "desk_spacing_x": 2.0,
        "desk_spacing_z": 1.8,
    },
    "Executive": {
        "zone": "executive_suite",
        "base_x": 0.0,
        "base_y": 1.0,
        "base_z": -12.0,
        "max_physical_desks": 4,
        "desk_spacing_x": 3.0,
        "desk_spacing_z": 2.5,
    },
}

class WorkstationService:
    """
    Dynamic Desk Slot Allocator:
    - Decouples logical workforce size (268+ specialists) from visible 3D desks (e.g. 48 max physical positions).
    - Allocates physical workstation slots when within capacity.
    - Gracefully transitions overflow employees to virtual/remote workstations without error.
    - Prevents duplicate allocations within the same tenant organization.
    - Supports desk reassignment, suspension, and retirement release.
    """

    def allocate_workstation(
        self,
        db: Session,
        agent_id: str,
        department: str,
        organization_id: str = "org_default_company",
        force_virtual: bool = False,
        preferred_desk_number: Optional[int] = None,
        notes: Optional[str] = None,
    ) -> WorkstationAllocationModel:
        """
        Allocates or re-uses a workstation for an agent.
        """
        # 1. Check if agent already has an allocation
        existing = (
            db.query(WorkstationAllocationModel)
            .filter(
                WorkstationAllocationModel.agent_id == agent_id,
                WorkstationAllocationModel.organization_id == organization_id,
            )
            .first()
        )
        if (
            existing
            and existing.allocation_status == "ASSIGNED"
            and existing.department == department
            and not force_virtual
            and (preferred_desk_number is None or existing.desk_number == preferred_desk_number)
        ):
            return existing

        dept_config = ZONE_CONFIGS.get(department, ZONE_CONFIGS["Operations"])
        zone_name = dept_config["zone"]
        dept_slug = department.lower().replace(" ", "_")
        max_phys = dept_config["max_physical_desks"]

        allocation: Optional[WorkstationAllocationModel] = None
        max_attempts = 3
        current_force_virtual = force_virtual

        for attempt in range(max_attempts):
            # 2. Query occupied desk numbers in this department for this organization
            occupied_desks = set(
                d[0]
                for d in db.query(WorkstationAllocationModel.desk_number)
                .filter(
                    WorkstationAllocationModel.organization_id == organization_id,
                    WorkstationAllocationModel.department == department,
                    WorkstationAllocationModel.allocation_status == "ASSIGNED",
                    WorkstationAllocationModel.desk_number.isnot(None),
                )
                .all()
            )

            desk_num: Optional[int] = None
            is_virtual = current_force_virtual

            if not current_force_virtual:
                if preferred_desk_number and preferred_desk_number not in occupied_desks:
                    desk_num = preferred_desk_number
                else:
                    for n in range(1, max_phys + 1):
                        if n not in occupied_desks:
                            desk_num = n
                            break

                # If all physical desks are occupied, gracefully virtualize employee
                if desk_num is None:
                    is_virtual = True
                    virtual_count = (
                        db.query(func.count(WorkstationAllocationModel.id))
                        .filter(
                            WorkstationAllocationModel.organization_id == organization_id,
                            WorkstationAllocationModel.department == department,
                            WorkstationAllocationModel.is_virtual.is_(True),
                        )
                        .scalar()
                        or 0
                    )
                    desk_num = max_phys + virtual_count + 1

            # 3. Compute coordinates
            if is_virtual:
                pos_x = dept_config["base_x"]
                pos_y = dept_config["base_y"]
                pos_z = dept_config["base_z"]
                logical_id = f"vws-{dept_slug}-{desk_num}"
                status = "VIRTUAL"
            else:
                col = (desk_num - 1) % 2
                row = (desk_num - 1) // 2
                pos_x = round(dept_config["base_x"] + col * dept_config["desk_spacing_x"], 2)
                pos_y = dept_config["base_y"]
                pos_z = round(dept_config["base_z"] + row * dept_config["desk_spacing_z"], 2)
                logical_id = f"ws-{dept_slug}-{desk_num:02d}"
                status = "ASSIGNED"

            try:
                sp = db.begin_nested()
                if existing:
                    existing.department = department
                    existing.logical_workstation_id = logical_id
                    existing.office_zone = zone_name
                    existing.desk_number = desk_num
                    existing.pos_x = pos_x
                    existing.pos_y = pos_y
                    existing.pos_z = pos_z
                    existing.allocation_status = status
                    existing.is_virtual = is_virtual
                    existing.notes = notes or ("Virtual capacity overflow" if is_virtual else "Reassigned workstation")
                    existing.updated_at = datetime.utcnow()
                    allocation = existing
                else:
                    allocation = WorkstationAllocationModel(
                        organization_id=organization_id,
                        agent_id=agent_id,
                        department=department,
                        logical_workstation_id=logical_id,
                        office_zone=zone_name,
                        desk_number=desk_num,
                        pos_x=pos_x,
                        pos_y=pos_y,
                        pos_z=pos_z,
                        allocation_status=status,
                        is_virtual=is_virtual,
                        notes=notes or ("Virtual employee (remote/overflow)" if is_virtual else "Standard physical workstation"),
                        allocated_at=datetime.utcnow(),
                        updated_at=datetime.utcnow(),
                    )
                    db.add(allocation)
                db.flush()
                sp.commit()
                break  # Successful allocation
            except IntegrityError as ie:
                sp.rollback()
                logger.warning(
                    f"Physical desk collision detected on desk {desk_num} in {department} (attempt {attempt + 1}/{max_attempts}). Retrying..."
                )
                if attempt == max_attempts - 1:
                    # Final fallback to virtual overflow
                    current_force_virtual = True

        # 4. Sync agent 3D coordinates in AgentModel
        agent = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
        if agent and allocation:
            agent.station = zone_name
            agent.pos_x = allocation.pos_x
            agent.pos_y = allocation.pos_y
            agent.pos_z = allocation.pos_z
        # 5. Persist and broadcast workstation allocation event
        try:
            from backend.app.services.event_service import event_service
            from backend.app.websocket_manager import ws_manager
            event_type = "workstation.reassigned" if existing else "workstation.allocated"
            ev = event_service.create_event(
                db=db,
                event_type=event_type,
                agent_id=agent_id,
                organization_id=organization_id,
                payload={
                    "allocation_id": allocation.id,
                    "agent_id": agent_id,
                    "department": department,
                    "office_zone": zone_name,
                    "desk_number": desk_num,
                    "position": [pos_x, pos_y, pos_z],
                    "is_virtual": is_virtual,
                    "allocation_status": status,
                    "organization_id": organization_id,
                },
                commit=False,
            )
            db.flush()
            ws_manager.broadcast_sync(ev.to_envelope())
        except Exception as ev_err:
            logger.debug(f"Workstation event dispatch skipped: {ev_err}")

        logger.info(
            f"Allocated workstation '{allocation.logical_workstation_id}' (status: {allocation.allocation_status}) for agent '{agent_id}' in {department} (Org: {organization_id})."
        )
        return allocation

    def reassign_workstation(
        self,
        db: Session,
        agent_id: str,
        target_department: str,
        organization_id: str = "org_default_company",
        is_virtual: Optional[bool] = None,
        desk_number: Optional[int] = None,
    ) -> WorkstationAllocationModel:
        """
        Reassigns an agent to a new department or desk slot with strict tenant ownership validation.
        """
        from backend.app.models.agent import AgentModel
        from backend.app.models.recruitment import RecruitmentRecordModel

        agent = db.query(AgentModel).filter(
            AgentModel.id == agent_id,
            AgentModel.organization_id == organization_id,
        ).first()
        if not agent:
            raise ValueError(f"Agent '{agent_id}' not found in organization '{organization_id}'.")

        force_virtual = is_virtual if is_virtual is not None else False
        allocation = self.allocate_workstation(
            db=db,
            agent_id=agent_id,
            department=target_department,
            organization_id=organization_id,
            force_virtual=force_virtual,
            preferred_desk_number=desk_number,
            notes=f"Reassigned to {target_department}",
        )

        agent.station = target_department
        agent.pos_x = allocation.pos_x
        agent.pos_y = allocation.pos_y
        agent.pos_z = allocation.pos_z

        rec = (
            db.query(RecruitmentRecordModel)
            .filter(
                RecruitmentRecordModel.agent_id == agent_id,
                RecruitmentRecordModel.organization_id == organization_id,
            )
            .first()
        )
        if rec:
            rec.department = target_department

        db.flush()
        return allocation

    def release_workstation(
        self,
        db: Session,
        agent_id: str,
        organization_id: str = "org_default_company",
        reason: str = "Employee retired or offboarded",
    ) -> Optional[WorkstationAllocationModel]:
        """
        Releases physical desk reservation (e.g. on retirement), marking status UNASSIGNED.
        """
        allocation = (
            db.query(WorkstationAllocationModel)
            .filter(
                WorkstationAllocationModel.agent_id == agent_id,
                WorkstationAllocationModel.organization_id == organization_id,
            )
            .first()
        )
        if allocation:
            allocation.allocation_status = "UNASSIGNED"
            allocation.desk_number = None
            allocation.notes = reason
            allocation.updated_at = datetime.utcnow()
            db.flush()
            try:
                from backend.app.services.event_service import event_service
                from backend.app.websocket_manager import ws_manager
                ev = event_service.create_event(
                    db=db,
                    event_type="workstation.reassigned",
                    agent_id=agent_id,
                    organization_id=organization_id,
                    payload={
                        "allocation_id": allocation.id,
                        "agent_id": agent_id,
                        "allocation_status": "UNASSIGNED",
                        "reason": reason,
                        "organization_id": organization_id,
                    },
                    commit=False,
                )
                db.flush()
                ws_manager.broadcast_sync(ev.to_envelope())
            except Exception as ev_err:
                logger.debug(f"Workstation release event dispatch skipped: {ev_err}")
            logger.info(f"Released workstation for agent '{agent_id}': {reason}")
        return allocation

    def get_workstation_for_agent(
        self,
        db: Session,
        agent_id: str,
        organization_id: str = "org_default_company",
    ) -> Optional[WorkstationAllocationModel]:
        return (
            db.query(WorkstationAllocationModel)
            .filter(
                WorkstationAllocationModel.agent_id == agent_id,
                WorkstationAllocationModel.organization_id == organization_id,
            )
            .first()
        )

    def list_workstations_for_org(
        self,
        db: Session,
        organization_id: str = "org_default_company",
        department: Optional[str] = None,
    ) -> List[WorkstationAllocationModel]:
        query = db.query(WorkstationAllocationModel).filter(
            WorkstationAllocationModel.organization_id == organization_id
        )
        if department:
            query = query.filter(WorkstationAllocationModel.department == department)
        return query.order_by(WorkstationAllocationModel.department.asc(), WorkstationAllocationModel.desk_number.asc()).all()

    def get_workstation_inspection(
        self,
        db: Session,
        workstation_id: str,
        organization_id: str = "org_default_company",
    ) -> dict:
        from backend.app.core.errors import NotFoundError

        alloc = (
            db.query(WorkstationAllocationModel)
            .filter(
                (WorkstationAllocationModel.logical_workstation_id == workstation_id) |
                (WorkstationAllocationModel.id == workstation_id),
                WorkstationAllocationModel.organization_id == organization_id,
            )
            .first()
        )

        if not alloc:
            raise NotFoundError(
                message=f"Workstation '{workstation_id}' not found in organization '{organization_id}'",
                code="WORKSTATION_NOT_FOUND",
            )

        agent_inspection = None
        is_occupied = False
        if alloc.agent_id and alloc.allocation_status in ("ASSIGNED", "OCCUPIED"):
            try:
                from backend.app.services.agent_service import agent_service
                agent_inspection = agent_service.get_agent_inspection(
                    db=db,
                    agent_id=alloc.agent_id,
                    organization_id=organization_id,
                )
                is_occupied = True
            except NotFoundError:
                agent_inspection = None

        return {
            "workstation_id": alloc.logical_workstation_id or alloc.id,
            "organization_id": alloc.organization_id,
            "department": alloc.department,
            "office_zone": alloc.office_zone,
            "desk_number": alloc.desk_number,
            "pos_x": alloc.pos_x,
            "pos_y": alloc.pos_y,
            "pos_z": alloc.pos_z,
            "allocation_status": alloc.allocation_status,
            "is_virtual": alloc.is_virtual,
            "is_occupied": is_occupied,
            "agent": agent_inspection,
        }

workstation_service = WorkstationService()
