from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from backend.app.core.database import get_db
from backend.app.core.auth import (
    get_current_user,
    get_current_tenant_org,
    UserContext,
)
from backend.app.schemas.artifact import ArtifactResponse
from backend.app.services.artifact_service import artifact_service
from backend.app.services.task_service import task_service

router = APIRouter(prefix="/artifacts", tags=["Artifacts"])

@router.get("", response_model=List[ArtifactResponse])
def list_artifacts(
    task_id: Optional[str] = Query(None, description="Filter artifacts by task ID"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists generated artifacts with strict tenant verification."""
    if task_id:
        task_service.get_task_by_id(db, task_id, organization_id=tenant_org)
    return artifact_service.list_artifacts(
        db=db,
        organization_id=tenant_org,
        task_id=task_id,
        limit=limit,
        offset=offset,
    )

@router.get("/{artifact_id}", response_model=ArtifactResponse)
def get_artifact(
    artifact_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves single artifact metadata with strict tenant verification."""
    return artifact_service.get_artifact_by_id(
        db=db,
        artifact_id=artifact_id,
        organization_id=tenant_org,
    )

@router.get("/{artifact_id}/content")
def get_artifact_content(
    artifact_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieves raw file content for a verified artifact with tenant isolation."""
    content = artifact_service.get_artifact_content(
        db=db,
        artifact_id=artifact_id,
        organization_id=tenant_org,
    )
    return {"artifact_id": artifact_id, "content": content}
