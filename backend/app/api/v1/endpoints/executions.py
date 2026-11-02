from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.auth import (
    get_current_user,
    get_current_tenant_org,
    UserContext,
)
from backend.app.services.workstation_execution_service import workstation_execution_service
from backend.app.schemas.execution import (
    ExecutionResponse,
    ExecutionEventListResponse,
    TerminalHistoryResponse,
)

router = APIRouter(prefix="/executions", tags=["Executions"])

@router.get("/{execution_id}", response_model=ExecutionResponse)
def get_execution_detail(
    execution_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieves full execution details with strict organization isolation.
    """
    execution = workstation_execution_service.get_execution(
        db=db,
        execution_id=execution_id,
        organization_id=tenant_org,
    )
    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution '{execution_id}' not found in organization '{tenant_org}'.",
        )
    return execution

@router.get("/{execution_id}/events", response_model=ExecutionEventListResponse)
def list_execution_events(
    execution_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieves paginated events strictly scoped to a single execution cycle.
    """
    # Verify execution existence and tenant ownership
    execution = workstation_execution_service.get_execution(
        db=db,
        execution_id=execution_id,
        organization_id=tenant_org,
    )
    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution '{execution_id}' not found in organization '{tenant_org}'.",
        )
    return workstation_execution_service.list_events_for_execution(
        db=db,
        execution_id=execution_id,
        organization_id=tenant_org,
        limit=limit,
        offset=offset,
    )

@router.get("/{execution_id}/terminal", response_model=TerminalHistoryResponse)
def get_execution_terminal_history(
    execution_id: str,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieves paginated terminal lines (stdout, stderr, system) for a single execution cycle.
    """
    # Verify execution existence and tenant ownership
    execution = workstation_execution_service.get_execution(
        db=db,
        execution_id=execution_id,
        organization_id=tenant_org,
    )
    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Execution '{execution_id}' not found in organization '{tenant_org}'.",
        )
    return workstation_execution_service.get_terminal_history_for_execution(
        db=db,
        execution_id=execution_id,
        organization_id=tenant_org,
        limit=limit,
        offset=offset,
    )
