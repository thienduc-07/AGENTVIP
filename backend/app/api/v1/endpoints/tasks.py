from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from backend.app.core.database import get_db
from backend.app.core.auth import (
    get_current_user,
    get_current_tenant_org,
    UserContext,
)
from backend.app.schemas.task import (
    TaskCreate,
    TaskResponse,
    TaskStepResponse,
    TaskCancelResponse
)
from backend.app.schemas.event import AgentEventResponse
from backend.app.services.task_service import task_service

router = APIRouter(prefix="/tasks", tags=["Tasks"])

@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(
    task_in: TaskCreate,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Creates a new execution task strictly scoped to the caller's authenticated organization."""
    return task_service.create_task(db=db, task_in=task_in, organization_id=tenant_org)

@router.get("", response_model=List[TaskResponse])
def list_tasks(
    status: Optional[str] = Query(None, description="Filter by task status"),
    agent_id: Optional[str] = Query(None, description="Filter by assigned agent ID"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lists execution tasks strictly scoped to the caller's authenticated organization."""
    return task_service.list_tasks(
        db=db,
        organization_id=tenant_org,
        status=status,
        agent_id=agent_id,
        limit=limit,
        offset=offset
    )

@router.get("/{task_id}", response_model=TaskResponse)
def get_task(
    task_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retrieves task details with strict tenant ownership validation."""
    return task_service.get_task_by_id(db=db, task_id=task_id, organization_id=tenant_org)

@router.get("/{task_id}/steps", response_model=List[TaskStepResponse])
def get_task_steps(
    task_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retrieves task execution steps with strict tenant ownership validation."""
    return task_service.get_task_steps(db=db, task_id=task_id, organization_id=tenant_org)

@router.post("/{task_id}/cancel", response_model=TaskCancelResponse)
def cancel_task(
    task_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Requests task cancellation with strict tenant ownership validation."""
    return task_service.cancel_task(db=db, task_id=task_id, organization_id=tenant_org)

@router.get("/{task_id}/events", response_model=List[AgentEventResponse])
def get_task_events(
    task_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retrieves event audit trail for a task with strict tenant ownership validation."""
    return task_service.get_task_events(db=db, task_id=task_id, organization_id=tenant_org)
