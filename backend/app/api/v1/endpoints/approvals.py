from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from backend.app.core.database import get_db
from backend.app.core.auth import (
    get_current_user,
    get_current_tenant_org,
    UserContext,
)
from backend.app.schemas.approval import ApprovalResponse, ApprovalDecisionRequest
from backend.app.services.approval_service import approval_service

router = APIRouter(prefix="/approvals", tags=["Approvals"])

@router.get("", response_model=List[ApprovalResponse])
def list_approvals(
    status: Optional[str] = Query(None, description="Filter by approval status: pending, approved, rejected, expired"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists approval requests scoped to the caller's organization."""
    return approval_service.list_approvals(db=db, organization_id=tenant_org, status=status, limit=limit, offset=offset)

@router.get("/{approval_id}", response_model=ApprovalResponse)
def get_approval(
    approval_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves an approval request with tenant isolation validation."""
    return approval_service.get_approval_by_id(db=db, approval_id=approval_id, organization_id=tenant_org)

@router.post("/{approval_id}/decision", response_model=ApprovalResponse)
def decide_approval(
    approval_id: str,
    req: ApprovalDecisionRequest,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Applies approval or rejection decision with strict tenant ownership validation."""
    return approval_service.decide_approval(
        db=db,
        approval_id=approval_id,
        decision=req.decision,
        reason=req.reason,
        organization_id=tenant_org
    )
