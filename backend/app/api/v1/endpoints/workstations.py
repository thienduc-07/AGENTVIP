from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.auth import (
    get_current_user,
    get_current_tenant_org,
    UserContext,
)
from backend.app.services.workstation_service import workstation_service, ZONE_CONFIGS
from backend.app.services.workstation_execution_service import workstation_execution_service
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.models.agent import AgentModel
from backend.app.schemas.workstation import (
    WorkstationOverviewResponse,
    ZoneConfigResponse,
    WorkstationAllocationResponse,
    WorkstationTelemetrySummary,
    WorkstationInspectionResponse,
)
from backend.app.schemas.execution import (
    WorkstationLiveDetailResponse,
    ExecutionListResponse,
    ExecutionEventListResponse,
    TerminalHistoryResponse,
)

router = APIRouter(prefix="/workstations", tags=["Workstations"])

@router.get("/overview", response_model=WorkstationOverviewResponse)
def get_workstation_overview(
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Authoritative workstation allocation overview strictly scoped to the tenant organization.
    Distinguishes Desk Capacity, Allocated Workstations, Occupied Workstations, and Virtual Workforce.
    """
    # 1. Fetch all tenant allocations joined with Agent metadata
    allocations_raw = (
        db.query(WorkstationAllocationModel, AgentModel)
        .outerjoin(AgentModel, WorkstationAllocationModel.agent_id == AgentModel.id)
        .filter(WorkstationAllocationModel.organization_id == tenant_org)
        .all()
    )

    allocation_responses: List[WorkstationAllocationResponse] = []
    dept_alloc_stats: Dict[str, Dict[str, int]] = {
        dept: {
            "allocated": 0,
            "physical_assigned": 0,
            "physical_occupied": 0,
            "virtual": 0,
        }
        for dept in ZONE_CONFIGS.keys()
    }

    for alloc, agent in allocations_raw:
        agent_name = agent.name if agent else None
        agent_role = agent.role if agent else None
        agent_status = agent.status if agent else "offline"

        resp = WorkstationAllocationResponse(
            id=alloc.id,
            organization_id=alloc.organization_id,
            agent_id=alloc.agent_id,
            department=alloc.department,
            logical_workstation_id=alloc.logical_workstation_id,
            office_zone=alloc.office_zone,
            desk_number=alloc.desk_number,
            pos_x=alloc.pos_x,
            pos_y=alloc.pos_y,
            pos_z=alloc.pos_z,
            allocation_status=alloc.allocation_status,
            is_virtual=alloc.is_virtual,
            agent_name=agent_name,
            agent_role=agent_role,
            agent_status=agent_status,
        )
        allocation_responses.append(resp)

        dept_key = alloc.department
        if dept_key in dept_alloc_stats:
            if alloc.allocation_status in ("ASSIGNED", "VIRTUAL"):
                dept_alloc_stats[dept_key]["allocated"] += 1

            if alloc.is_virtual or alloc.allocation_status == "VIRTUAL":
                dept_alloc_stats[dept_key]["virtual"] += 1
            elif alloc.allocation_status == "ASSIGNED" and alloc.desk_number is not None:
                dept_alloc_stats[dept_key]["physical_assigned"] += 1
                # Occupied = assigned physical desk where agent is active (not offline)
                if agent_status != "offline":
                    dept_alloc_stats[dept_key]["physical_occupied"] += 1

    # 2. Build Zone Configurations with telemetry adhering strictly to physical desk invariants
    zone_responses: List[ZoneConfigResponse] = []
    total_physical_capacity = 0
    total_physical_assigned = 0
    total_physical_occupied = 0
    total_virtual = 0

    for dept, cfg in ZONE_CONFIGS.items():
        cap = cfg["max_physical_desks"]
        total_physical_capacity += cap

        stats = dept_alloc_stats.get(dept, {"allocated": 0, "physical_assigned": 0, "physical_occupied": 0, "virtual": 0})
        phys_allocated = stats["physical_assigned"]
        phys_occupied = stats["physical_occupied"]
        phys_reserved_unoccupied = max(0, phys_allocated - phys_occupied)
        phys_available = max(0, cap - phys_allocated)
        virtual_cnt = stats["virtual"]

        total_physical_assigned += phys_allocated
        total_physical_occupied += phys_occupied
        total_virtual += virtual_cnt

        zone_responses.append(
            ZoneConfigResponse(
                department=dept,
                zone=cfg["zone"],
                base_x=cfg["base_x"],
                base_y=cfg["base_y"],
                base_z=cfg["base_z"],
                max_physical_desks=cap,
                desk_spacing_x=cfg["desk_spacing_x"],
                desk_spacing_z=cfg["desk_spacing_z"],
                allocated_count=phys_allocated,
                physical_occupied_count=phys_occupied,
                reserved_unoccupied_count=phys_reserved_unoccupied,
                available_physical_count=phys_available,
                virtual_count=virtual_cnt,
            )
        )

    total_reserved_unoccupied = max(0, total_physical_assigned - total_physical_occupied)
    telemetry = WorkstationTelemetrySummary(
        total_desk_capacity=total_physical_capacity,
        total_allocated=total_physical_assigned,
        total_physical_occupied=total_physical_occupied,
        total_reserved_unoccupied=total_reserved_unoccupied,
        total_physical_available=max(0, total_physical_capacity - total_physical_assigned),
        total_virtual_workforce=total_virtual,
    )

    return WorkstationOverviewResponse(
        zones=zone_responses,
        allocations=allocation_responses,
        telemetry=telemetry,
    )

@router.get("/zones", response_model=List[ZoneConfigResponse])
def list_zones(
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns zone capacities and current tenant workstation metrics."""
    overview = get_workstation_overview(tenant_org=tenant_org, user=user, db=db)
    return overview.zones

@router.get("/allocations", response_model=List[WorkstationAllocationResponse])
def list_allocations(
    department: Optional[str] = Query(None, description="Filter by department"),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns list of workstation allocations strictly scoped to the tenant organization."""
    allocations = workstation_service.list_workstations_for_org(
        db=db,
        organization_id=tenant_org,
        department=department,
    )
    result = []
    for a in allocations:
        agent = a.agent
        result.append(
            WorkstationAllocationResponse(
                id=a.id,
                organization_id=a.organization_id,
                agent_id=a.agent_id,
                department=a.department,
                logical_workstation_id=a.logical_workstation_id,
                office_zone=a.office_zone,
                desk_number=a.desk_number,
                pos_x=a.pos_x,
                pos_y=a.pos_y,
                pos_z=a.pos_z,
                allocation_status=a.allocation_status,
                is_virtual=a.is_virtual,
                agent_name=agent.name if agent else None,
                agent_role=agent.role if agent else None,
                agent_status=agent.status if agent else "offline",
            )
        )
    return result

@router.get("/{workstation_id}/inspection", response_model=WorkstationInspectionResponse)
def get_workstation_inspection(
    workstation_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retrieves authoritative workstation inspection data with tenant isolation."""
    return workstation_service.get_workstation_inspection(
        db=db,
        workstation_id=workstation_id,
        organization_id=tenant_org,
    )

@router.get("/{agent_id}", response_model=WorkstationLiveDetailResponse)
def get_agent_workstation_live_detail(
    agent_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieves live workstation execution environment status for an agent or workstation identifier.
    Includes active task directive, desk coordinates, behavioral state, and latest execution telemetry.
    """
    detail = workstation_execution_service.get_workstation_for_agent(
        db=db,
        agent_id=agent_id,
        organization_id=tenant_org,
    )
    if not detail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workstation or Agent '{agent_id}' not found in organization '{tenant_org}'.",
        )
    return detail

@router.get("/{agent_id}/executions", response_model=ExecutionListResponse)
def list_agent_workstation_executions(
    agent_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieves paginated historical executions run at this agent's workstation.
    """
    resolved_id = workstation_execution_service.resolve_agent_id(db, agent_id, tenant_org)
    if not resolved_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent '{agent_id}' not found in organization '{tenant_org}'.",
        )
    return workstation_execution_service.list_executions_for_agent(
        db=db,
        agent_id=resolved_id,
        organization_id=tenant_org,
        limit=limit,
        offset=offset,
    )

@router.get("/{agent_id}/events", response_model=ExecutionEventListResponse)
def list_agent_workstation_events(
    agent_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieves chronological execution events emitted by this agent's workstation.
    """
    resolved_id = workstation_execution_service.resolve_agent_id(db, agent_id, tenant_org)
    if not resolved_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent '{agent_id}' not found in organization '{tenant_org}'.",
        )
    return workstation_execution_service.list_events_for_agent(
        db=db,
        agent_id=resolved_id,
        organization_id=tenant_org,
        limit=limit,
        offset=offset,
    )

@router.get("/{agent_id}/terminal", response_model=TerminalHistoryResponse)
def get_agent_workstation_terminal(
    agent_id: str,
    execution_id: Optional[str] = Query(None, description="Optional specific execution ID filter"),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieves paginated terminal output lines (stdout, stderr, system) for the agent's workstation.
    """
    resolved_id = workstation_execution_service.resolve_agent_id(db, agent_id, tenant_org)
    if not resolved_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent '{agent_id}' not found in organization '{tenant_org}'.",
        )
    return workstation_execution_service.get_terminal_history_for_agent(
        db=db,
        agent_id=resolved_id,
        organization_id=tenant_org,
        execution_id=execution_id,
        limit=limit,
        offset=offset,
    )
