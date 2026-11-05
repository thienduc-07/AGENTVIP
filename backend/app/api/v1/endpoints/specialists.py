from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from backend.app.core.database import get_db
from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel
from backend.app.services.agency_agent_importer import agency_agent_importer
from backend.app.core.auth import (
    require_permission,
    require_platform_superadmin,
    UserContext,
    PERM_PREVIEW_CATALOG_SYNC,
)

router = APIRouter()

class ImportRequest(BaseModel):
    source_dir: Optional[str] = Field(None, description="Path to local agency-agents folder. If None, uses default.")
    force_update: bool = Field(False, description="Whether to re-import and bump version even if content hash matches.")

class ImportResponse(BaseModel):
    success: bool
    total_files_scanned: int
    imported_new: int
    updated_existing: int
    unchanged: int
    invalid_count: int
    divisions_summary: Dict[str, int]
    commit_sha: Optional[str]

class SpecialistSummary(BaseModel):
    id: str
    slug: str
    name: str
    division: str
    department: str
    role: str
    description: Optional[str]
    color: str
    emoji: str
    vibe: Optional[str]
    capabilities: List[str]
    skills: List[str]
    declared_tools: List[str]
    assigned_tools: List[str]
    permission_level: int
    validation_status: str
    lifecycle_state: str
    version: int

class SpecialistListResponse(BaseModel):
    total: int
    items: List[SpecialistSummary]
    skip: int
    limit: int

class SpecialistDetail(SpecialistSummary):
    system_instructions: str
    identity_and_memory: Optional[str]
    core_mission: Optional[str]
    critical_rules: Optional[str]
    workflows: Optional[str]
    deliverables: Optional[str]
    success_metrics: Optional[str]
    source_repo: str
    source_path: str
    source_commit_sha: Optional[str]
    validation_errors: List[str]
    imported_at: Optional[str]
    updated_at: Optional[str]

class SpecialistVersionSummary(BaseModel):
    id: str
    specialist_id: str
    version: int
    source_commit_sha: Optional[str]
    content_hash: str
    change_summary: Optional[str]
    created_at: str

@router.post("/import", response_model=ImportResponse, status_code=status.HTTP_200_OK)
def trigger_agent_import(
    req: ImportRequest = ImportRequest(),
    admin_user: UserContext = Depends(require_platform_superadmin),
    db: Session = Depends(get_db),
):
    """
    Trigger specialist library import from official agency-agents repository.
    Parses, validates, normalizes, and stores specialist definitions.
    """
    try:
        summary = agency_agent_importer.import_all(
            db=db,
            source_dir=req.source_dir,
            force_update=req.force_update,
        )
        return ImportResponse(
            success=True,
            total_files_scanned=summary["total_files_scanned"],
            imported_new=summary["imported_new"],
            updated_existing=summary["updated_existing"],
            unchanged=summary["unchanged"],
            invalid_count=summary["invalid_count"],
            divisions_summary=summary["divisions_summary"],
            commit_sha=summary["commit_sha"],
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Agency agent import failed: {str(e)}",
        )

@router.get("", response_model=SpecialistListResponse)
def list_specialists(
    division: Optional[str] = Query(None, description="Filter by division (e.g. engineering, marketing)"),
    department: Optional[str] = Query(None, description="Filter by corporate department"),
    search: Optional[str] = Query(None, description="Search query across name, role, and description"),
    lifecycle_state: Optional[str] = Query(None, description="Filter by lifecycle state"),
    validation_status: Optional[str] = Query(None, description="Filter by validation status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """
    Search and filter specialist catalog.
    """
    query = db.query(SpecialistDefinitionModel)

    if division:
        query = query.filter(SpecialistDefinitionModel.division == division.lower())
    if department:
        query = query.filter(SpecialistDefinitionModel.department == department)
    if lifecycle_state:
        query = query.filter(SpecialistDefinitionModel.lifecycle_state == lifecycle_state.upper())
    if validation_status:
        query = query.filter(SpecialistDefinitionModel.validation_status == validation_status.upper())
    if search:
        raw_s = search.strip()
        s = f"%{raw_s}%"
        slug_s = f"%{raw_s.lower().replace(' ', '-')}%"
        and_s = f"%{raw_s.replace('3D Scene', '3D & Scene')}%"
        query = query.filter(
            or_(
                SpecialistDefinitionModel.name.ilike(s),
                SpecialistDefinitionModel.name.ilike(and_s),
                SpecialistDefinitionModel.slug.ilike(s),
                SpecialistDefinitionModel.slug.ilike(slug_s),
                SpecialistDefinitionModel.role.ilike(s),
                SpecialistDefinitionModel.description.ilike(s),
            )
        )

    total = query.count()
    items = query.order_by(SpecialistDefinitionModel.name.asc()).offset(skip).limit(limit).all()

    return SpecialistListResponse(
        total=total,
        items=[SpecialistSummary(**item.to_dict()) for item in items],
        skip=skip,
        limit=limit,
    )

@router.get("/divisions")
def get_divisions_summary(db: Session = Depends(get_db)):
    """
    Return list of divisions with total agent count and department mapping.
    """
    results = (
        db.query(
            SpecialistDefinitionModel.division,
            SpecialistDefinitionModel.department,
            SpecialistDefinitionModel.color,
            func.count(SpecialistDefinitionModel.id).label("count"),
        )
        .group_by(
            SpecialistDefinitionModel.division,
            SpecialistDefinitionModel.department,
            SpecialistDefinitionModel.color,
        )
        .all()
    )

    return [
        {
            "division": r[0],
            "department": r[1],
            "color": r[2],
            "agent_count": r[3],
        }
        for r in results
    ]

@router.get("/{specialist_id}", response_model=SpecialistDetail)
def get_specialist_detail(
    specialist_id: str,
    db: Session = Depends(get_db),
):
    """
    Get full specialist definition by ID or slug.
    """
    item = (
        db.query(SpecialistDefinitionModel)
        .filter(
            or_(
                SpecialistDefinitionModel.id == specialist_id,
                SpecialistDefinitionModel.slug == specialist_id,
            )
        )
        .first()
    )
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Specialist '{specialist_id}' not found.",
        )

    data = item.to_dict()
    data.update({
        "system_instructions": item.system_instructions,
        "identity_and_memory": item.identity_and_memory,
        "core_mission": item.core_mission,
        "critical_rules": item.critical_rules,
        "workflows": item.workflows,
        "deliverables": item.deliverables,
        "success_metrics": item.success_metrics,
        "raw_content": item.raw_content,
    })
    return SpecialistDetail(**data)

@router.get("/{specialist_id}/versions", response_model=List[SpecialistVersionSummary])
def get_specialist_versions(
    specialist_id: str,
    db: Session = Depends(get_db),
):
    """
    Get version history and snapshots for a specialist.
    """
    spec = (
        db.query(SpecialistDefinitionModel)
        .filter(
            or_(
                SpecialistDefinitionModel.id == specialist_id,
                SpecialistDefinitionModel.slug == specialist_id,
            )
        )
        .first()
    )
    if not spec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Specialist '{specialist_id}' not found.",
        )

    versions = (
        db.query(SpecialistVersionModel)
        .filter(SpecialistVersionModel.specialist_id == spec.id)
        .order_by(SpecialistVersionModel.version.desc())
        .all()
    )

    return [SpecialistVersionSummary(**v.to_dict()) for v in versions]

class SyncPreviewRequest(BaseModel):
    source_dir: Optional[str] = Field(None, description="Path to upstream repository clone")

class SyncApplyRequest(BaseModel):
    approved_slugs: Optional[List[str]] = Field(None, description="List of approved specialist slugs to synchronize. If None, applies all.")
    source_dir: Optional[str] = Field(None, description="Path to upstream repository clone")

@router.get("/catalog/integrity")
def get_catalog_integrity(db: Session = Depends(get_db)):
    """
    Run non-destructive specialist catalog integrity audit.
    Verifies unique slugs, stable IDs, divisions, source hashes, and version history.
    """
    from backend.app.services.specialist_integrity_service import specialist_integrity_checker
    return specialist_integrity_checker.audit_catalog(db)

@router.post("/sync/preview")
def preview_upstream_sync(
    req: SyncPreviewRequest = SyncPreviewRequest(),
    tenant_org: str = Depends(require_permission(PERM_PREVIEW_CATALOG_SYNC)),
    db: Session = Depends(get_db),
):
    """
    Generates a dry-run comparison between upstream repository and local database.
    Requires administrative clearance for catalog sync preview.
    """
    from backend.app.services.agency_agent_synchronizer import agency_agent_synchronizer
    try:
        return agency_agent_synchronizer.preview_sync(db=db, source_dir=req.source_dir)
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Sync preview failed: {str(e)}")

@router.post("/sync/apply")
def apply_upstream_sync(
    req: SyncApplyRequest = SyncApplyRequest(),
    admin_user: UserContext = Depends(require_platform_superadmin),
    db: Session = Depends(get_db),
):
    """
    Applies approved synchronization changes with explicit version records.
    Strictly restricted to PLATFORM_SUPERADMIN. Records audit logging.
    """
    import logging
    logger = logging.getLogger("agency.catalog.sync")
    from backend.app.services.agency_agent_synchronizer import agency_agent_synchronizer
    try:
        result = agency_agent_synchronizer.apply_sync(
            db=db,
            approved_slugs=req.approved_slugs,
            source_dir=req.source_dir,
        )
        logger.info(
            f"AUDIT: Catalog sync applied by superadmin {admin_user.email} (id: {admin_user.user_id}). "
            f"Approved slugs: {req.approved_slugs}. Result: {result.get('applied')}"
        )
        try:
            from backend.app.services.event_service import event_service
            event_service.create_event(
                db=db,
                event_type="catalog.sync.applied",
                agent_id="system-catalog",
                payload={
                    "initiated_by_user_id": admin_user.user_id,
                    "initiated_by_email": admin_user.email,
                    "approved_slugs": req.approved_slugs,
                    "applied_summary": result.get("applied"),
                    "commit_sha": result.get("commit_sha"),
                },
                commit=True,
            )
        except Exception as audit_err:
            logger.warning(f"Could not record catalog sync audit event: {audit_err}")

        return result
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Sync apply failed: {str(e)}")
