from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from backend.app.core.database import get_db
from backend.app.schemas.agent import (
    AgentCreate,
    AgentUpdate,
    AgentResponse,
    AgentBehavioralStateTransitionRequest,
    AgentInspectionResponse,
)
from backend.app.schemas.navigation import (
    AgentNavigateRequest,
    AgentMovementProgressRequest,
    AgentMovementCompleteRequest,
    AgentMovementInterruptRequest,
    AgentMovementPlanResponse,
)
from backend.app.schemas.task import TaskResponse
from backend.app.services.agent_service import agent_service
from backend.app.services.behavioral_state_service import behavioral_state_service
from backend.app.services.navigation_service import navigation_service

from backend.app.agent_runtime.registry.agent_registry import default_agent_registry
from backend.app.core.errors import NotFoundError

from backend.app.core.auth import (
    get_current_user,
    get_current_tenant_org,
    UserContext,
)

router = APIRouter(prefix="/agents", tags=["Agents"])

@router.get("/registry")
def list_agent_registry_definitions():
    """Lists all active specialized agent definitions and capabilities."""
    return [a.model_dump() for a in default_agent_registry.list_active()]

@router.get("/registry/{agent_type}")
def get_agent_registry_definition(agent_type: str):
    """Retrieves definition, system prompt, and allowed tools for a specific agent type."""
    defn = default_agent_registry.get(agent_type)
    if not defn or not defn.enabled:
        raise NotFoundError(message=f"Agent definition '{agent_type}' not found or disabled", code="AGENT_TYPE_NOT_FOUND")
    return defn.model_dump()

@router.get("", response_model=List[AgentResponse])
def list_agents(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists agents accessible to the caller's organization."""
    return agent_service.list_agents(db=db, organization_id=tenant_org, limit=limit, offset=offset)

@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(
    agent_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves agent details with tenant isolation enforcement."""
    return agent_service.get_agent_by_id(db=db, agent_id=agent_id, organization_id=tenant_org)

@router.get("/{agent_id}/inspection", response_model=AgentInspectionResponse)
def get_agent_inspection(
    agent_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves full authoritative inspection HUD data for an agent with tenant isolation."""
    return agent_service.get_agent_inspection(db=db, agent_id=agent_id, organization_id=tenant_org)

@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
def create_agent(
    agent_in: AgentCreate,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return agent_service.create_agent(db=db, agent_in=agent_in)

@router.patch("/{agent_id}", response_model=AgentResponse)
def update_agent(
    agent_id: str,
    agent_in: AgentUpdate,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Updates agent attributes with tenant ownership validation."""
    return agent_service.update_agent(db=db, agent_id=agent_id, agent_in=agent_in, organization_id=tenant_org)

@router.get("/{agent_id}/tasks", response_model=List[TaskResponse])
def get_agent_tasks(
    agent_id: str,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves tasks for an agent with tenant isolation."""
    return agent_service.get_agent_tasks(db=db, agent_id=agent_id, organization_id=tenant_org, limit=limit, offset=offset)


@router.post("/{agent_id}/behavioral-state", response_model=AgentResponse)
def transition_agent_behavioral_state(
    agent_id: str,
    req: AgentBehavioralStateTransitionRequest,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Transitions an agent's authoritative behavioral state with strict validation and tenant isolation."""
    return behavioral_state_service.transition_state(
        db=db,
        agent_id=agent_id,
        target_state=req.behavioral_state,
        organization_id=tenant_org,
        task_id=req.task_id,
        reason=req.reason,
        commit=True,
        broadcast=True,
    )


@router.post("/{agent_id}/navigate", response_model=AgentMovementPlanResponse)
def navigate_agent(
    agent_id: str,
    req: AgentNavigateRequest,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Starts an authoritative spatial movement along office navigation topology waypoints."""
    return navigation_service.start_movement(
        db=db,
        agent_id=agent_id,
        destination=req.destination,
        organization_id=tenant_org,
        task_id=req.task_id,
        speed=req.speed,
        allow_interrupt=req.allow_interrupt,
        target_state_on_arrival=req.target_state_on_arrival,
        commit=True,
        broadcast=True,
    )


@router.post("/{agent_id}/movement/progress", response_model=AgentResponse)
def update_agent_movement_progress(
    agent_id: str,
    req: AgentMovementProgressRequest,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Persists intermediate spatial movement progress and emits agent.movement_progress."""
    return navigation_service.update_movement_progress(
        db=db,
        agent_id=agent_id,
        movement_id=req.movement_id,
        pos_x=req.pos_x,
        pos_y=req.pos_y,
        pos_z=req.pos_z,
        waypoint_index=req.waypoint_index,
        progress_ratio=req.progress_ratio,
        organization_id=tenant_org,
        commit=True,
        broadcast=True,
    )


@router.post("/{agent_id}/movement/complete", response_model=AgentResponse)
def complete_agent_movement(
    agent_id: str,
    req: AgentMovementCompleteRequest,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Completes an active spatial movement, commits destination coordinates, and emits agent.movement_completed."""
    return navigation_service.complete_movement(
        db=db,
        agent_id=agent_id,
        movement_id=req.movement_id,
        target_state=req.target_state,
        organization_id=tenant_org,
        task_id=req.task_id,
        commit=True,
        broadcast=True,
    )


@router.post("/{agent_id}/movement/interrupt", response_model=AgentResponse)
def interrupt_agent_movement(
    agent_id: str,
    req: AgentMovementInterruptRequest,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Interrupts an active spatial movement and emits agent.movement_interrupted."""
    return navigation_service.interrupt_movement(
        db=db,
        agent_id=agent_id,
        reason=req.reason,
        pos_x=req.pos_x,
        pos_y=req.pos_y,
        pos_z=req.pos_z,
        target_state=req.target_state,
        organization_id=tenant_org,
        commit=True,
        broadcast=True,
    )
