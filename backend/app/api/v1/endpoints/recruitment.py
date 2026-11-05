from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.models.agent import AgentModel
from backend.app.models.recruitment import RecruitmentRecordModel, AgentPerformanceModel
from backend.app.services.recruitment_service import recruitment_service
from backend.app.core.auth import (
    get_current_user,
    get_current_tenant_org,
    require_permission,
    UserContext,
    PERM_RECRUIT_SPECIALIST,
    PERM_MANAGE_EMPLOYEE_LIFECYCLE,
    PERM_REASSIGN_WORKSTATION,
    PERM_VIEW_WORKFORCE,
)

router = APIRouter()

class RecruitSpecialistRequest(BaseModel):
    specialist_id: str = Field(..., description="ID or slug of specialist definition in library")
    organization_id: Optional[str] = Field(None, description="Client-supplied org ID (ignored in favor of authenticated tenant)")
    recruited_by: str = Field("agent-exec-ceo", description="Agent ID of recruiter (CEO or Department Head)")
    manager_agent_id: Optional[str] = Field(None, description="Direct manager agent ID. If null, defaults to department head.")
    department: Optional[str] = Field(None, description="Department name (e.g. Engineering, Marketing)")
    custom_name: Optional[str] = Field(None, description="Optional custom name for the recruited specialist")
    budget_limit_usd: float = Field(50.0, ge=1.0, le=10000.0, description="Monthly token/cost budget cap")
    permission_profile: str = Field("standard_specialist", description="Security profile clearance")
    notes: Optional[str] = Field(None, description="Recruitment notes or operational charter")
    is_virtual: bool = Field(False, description="Whether employee is remote/virtual without physical desk")
    requested_version: Optional[int] = Field(None, description="Optional pinned specialist version number")

class TransitionLifecycleRequest(BaseModel):
    reason: Optional[str] = Field(None, description="Reason for state transition")

class ReassignWorkstationRequest(BaseModel):
    department: str = Field(..., description="Target department zone")
    organization_id: Optional[str] = Field(None, description="Client-supplied org ID (ignored in favor of authenticated tenant)")
    is_virtual: Optional[bool] = Field(None, description="Optional override for virtual desk mode")
    desk_number: Optional[int] = Field(None, description="Optional specific desk number")

class CompareCandidatesRequest(BaseModel):
    specialist_ids: List[str] = Field(..., min_length=1, max_length=5, description="List of specialist IDs or slugs to compare")

@router.post("/recruit", status_code=status.HTTP_201_CREATED)
def recruit_specialist(
    req: RecruitSpecialistRequest,
    tenant_org: str = Depends(require_permission(PERM_RECRUIT_SPECIALIST)),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Recruit an available specialist into a corporate department for an organization.
    Tenant is strictly derived from authenticated context; client-provided org ID is ignored.
    """
    try:
        result = recruitment_service.recruit_specialist(
            db=db,
            specialist_id=req.specialist_id,
            organization_id=tenant_org,
            recruited_by=user.email or req.recruited_by,
            manager_agent_id=req.manager_agent_id,
            department=req.department,
            custom_name=req.custom_name,
            budget_limit_usd=req.budget_limit_usd,
            permission_profile=req.permission_profile,
            notes=req.notes,
            is_virtual=req.is_virtual,
            requested_version=req.requested_version,
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Recruitment failed: {str(e)}",
        )

@router.post("/{agent_id}/activate")
def activate_agent(
    agent_id: str,
    tenant_org: str = Depends(require_permission(PERM_MANAGE_EMPLOYEE_LIFECYCLE)),
    db: Session = Depends(get_db),
):
    """
    Activate a configured or suspended specialist within the authenticated organization.
    """
    rec = db.query(RecruitmentRecordModel).filter(
        RecruitmentRecordModel.agent_id == agent_id,
        RecruitmentRecordModel.organization_id == tenant_org,
    ).first()
    if not rec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee '{agent_id}' not found in organization.",
        )
    try:
        return recruitment_service.transition_lifecycle(
            db=db,
            agent_id=agent_id,
            target_state="ACTIVE",
            organization_id=tenant_org,
            reason="Activated by management",
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post("/{agent_id}/suspend")
def suspend_agent(
    agent_id: str,
    req: TransitionLifecycleRequest = TransitionLifecycleRequest(),
    tenant_org: str = Depends(require_permission(PERM_MANAGE_EMPLOYEE_LIFECYCLE)),
    db: Session = Depends(get_db),
):
    """
    Temporarily suspend an active agent from receiving tasks within the authenticated organization.
    """
    rec = db.query(RecruitmentRecordModel).filter(
        RecruitmentRecordModel.agent_id == agent_id,
        RecruitmentRecordModel.organization_id == tenant_org,
    ).first()
    if not rec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee '{agent_id}' not found in organization.",
        )
    try:
        return recruitment_service.transition_lifecycle(
            db=db,
            agent_id=agent_id,
            target_state="SUSPENDED",
            organization_id=tenant_org,
            reason=req.reason or "Suspended by management",
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post("/{agent_id}/retire")
def retire_agent(
    agent_id: str,
    req: TransitionLifecycleRequest = TransitionLifecycleRequest(),
    tenant_org: str = Depends(require_permission(PERM_MANAGE_EMPLOYEE_LIFECYCLE)),
    db: Session = Depends(get_db),
):
    """
    Permanently retire an agent and release physical desk reservation.
    """
    rec = db.query(RecruitmentRecordModel).filter(
        RecruitmentRecordModel.agent_id == agent_id,
        RecruitmentRecordModel.organization_id == tenant_org,
    ).first()
    if not rec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee '{agent_id}' not found in organization.",
        )
    try:
        return recruitment_service.transition_lifecycle(
            db=db,
            agent_id=agent_id,
            target_state="RETIRED",
            organization_id=tenant_org,
            reason=req.reason or "Retired from service",
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.get("/hierarchy")
def get_hierarchy(
    tenant_org: str = Depends(require_permission(PERM_VIEW_WORKFORCE)),
    db: Session = Depends(get_db),
):
    """
    Get corporate reporting hierarchy tree scoped to the caller's organization.
    """
    return recruitment_service.get_corporate_hierarchy(db, organization_id=tenant_org)

@router.post("/compare")
def compare_candidates(
    req: CompareCandidatesRequest,
    tenant_org: str = Depends(require_permission(PERM_VIEW_WORKFORCE)),
    db: Session = Depends(get_db),
):
    """
    Compare multiple specialist candidate profiles side-by-side.
    """
    return recruitment_service.compare_specialists(db, req.specialist_ids)

@router.get("/recruited")
def list_recruited_agents(
    tenant_org: str = Depends(require_permission(PERM_VIEW_WORKFORCE)),
    department: Optional[str] = Query(None),
    lifecycle_state: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    List recruited agents scoped strictly to the caller's organization.
    """
    from backend.app.models.workstation import WorkstationAllocationModel
    query = (
        db.query(RecruitmentRecordModel, AgentModel, AgentPerformanceModel, WorkstationAllocationModel)
        .join(AgentModel, RecruitmentRecordModel.agent_id == AgentModel.id)
        .outerjoin(AgentPerformanceModel, RecruitmentRecordModel.agent_id == AgentPerformanceModel.agent_id)
        .outerjoin(WorkstationAllocationModel, RecruitmentRecordModel.agent_id == WorkstationAllocationModel.agent_id)
        .filter(RecruitmentRecordModel.organization_id == tenant_org)
    )

    if department:
        query = query.filter(RecruitmentRecordModel.department == department)
    if lifecycle_state and isinstance(lifecycle_state, str):
        query = query.filter(RecruitmentRecordModel.lifecycle_state == lifecycle_state.upper())

    results = query.all()
    items = []
    for rec, ag, perf, ws in results:
        items.append({
            "agent_id": ag.id,
            "organization_id": rec.organization_id,
            "name": ag.name,
            "role": ag.role,
            "status": ag.status,
            "station": ag.station,
            "position": [ag.pos_x, ag.pos_y, ag.pos_z],
            "color": ag.color,
            "department": rec.department,
            "manager_agent_id": rec.manager_agent_id,
            "lifecycle_state": rec.lifecycle_state,
            "specialist_version_id": rec.specialist_version_id,
            "specialist_version_num": rec.specialist_version_num,
            "is_legacy_unpinned": getattr(rec, "is_legacy_unpinned", False),
            "budget_limit_usd": rec.budget_limit_usd,
            "budget_spent_usd": rec.budget_spent_usd,
            "workstation": ws.to_dict() if ws else None,
            "performance": perf.to_dict() if perf else None,
            "recruited_at": rec.recruited_at.isoformat() if rec.recruited_at else None,
        })
    return items

@router.get("/legacy-audit")
def audit_legacy_employees(
    tenant_org: str = Depends(require_permission(PERM_VIEW_WORKFORCE)),
    db: Session = Depends(get_db),
):
    """
    Administrative report of legacy unpinned employees within the organization.
    Identifies employees whose specialist version is missing or flagged for review.
    """
    unpinned = db.query(RecruitmentRecordModel).filter(
        RecruitmentRecordModel.organization_id == tenant_org,
        (RecruitmentRecordModel.is_legacy_unpinned == True) | (RecruitmentRecordModel.specialist_version_id.is_(None))
    ).all()
    return {
        "organization_id": tenant_org,
        "unpinned_count": len(unpinned),
        "unpinned_employees": [
            {
                "agent_id": r.agent_id,
                "specialist_definition_id": r.specialist_definition_id,
                "specialist_version_id": r.specialist_version_id,
                "specialist_version_num": r.specialist_version_num,
                "is_legacy_unpinned": getattr(r, "is_legacy_unpinned", False),
                "lifecycle_state": r.lifecycle_state,
                "recruited_at": r.recruited_at.isoformat() if r.recruited_at else None,
                "execution_blocked": True,
                "administrative_recommendation": "Review specialist definition and pin a verified specialist version before dispatching tasks.",
            }
            for r in unpinned
        ]
    }

@router.get("/workforce")
def get_organization_workforce(
    tenant_org: str = Depends(require_permission(PERM_VIEW_WORKFORCE)),
    department: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Future 3D Office Contract: Returns recruited employees, logical workstations,
    3D coordinates, and lifecycle states scoped to the caller's organization.
    """
    from backend.app.services.workstation_service import workstation_service
    agents_list = list_recruited_agents(
        tenant_org=tenant_org,
        department=department,
        lifecycle_state=None,
        db=db,
    )
    workstations = workstation_service.list_workstations_for_org(db=db, organization_id=tenant_org, department=department)

    return {
        "organization_id": tenant_org,
        "total_employees": len(agents_list),
        "total_workstations_allocated": len(workstations),
        "workforce": agents_list,
        "workstations": [w.to_dict() for w in workstations],
    }

@router.post("/{agent_id}/workstation")
def reassign_agent_workstation(
    agent_id: str,
    req: ReassignWorkstationRequest,
    tenant_org: str = Depends(require_permission(PERM_REASSIGN_WORKSTATION)),
    db: Session = Depends(get_db),
):
    """
    Reassign an agent's logical workstation or toggle virtual desk mode.
    Enforces tenant ownership.
    """
    rec = db.query(RecruitmentRecordModel).filter(
        RecruitmentRecordModel.agent_id == agent_id,
        RecruitmentRecordModel.organization_id == tenant_org,
    ).first()
    if not rec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee '{agent_id}' not found in organization.",
        )

    from backend.app.services.workstation_service import workstation_service
    try:
        allocation = workstation_service.reassign_workstation(
            db=db,
            agent_id=agent_id,
            target_department=req.department,
            organization_id=tenant_org,
            is_virtual=req.is_virtual,
            desk_number=req.desk_number,
        )
        return {"success": True, "allocation": allocation.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Workstation reassignment failed: {str(e)}")

@router.get("/performance/{agent_id}")
def get_agent_performance(
    agent_id: str,
    tenant_org: str = Depends(require_permission(PERM_VIEW_WORKFORCE)),
    db: Session = Depends(get_db),
):
    """
    Get performance metrics for a specific agent within the caller's organization.
    """
    rec = db.query(RecruitmentRecordModel).filter(
        RecruitmentRecordModel.agent_id == agent_id,
        RecruitmentRecordModel.organization_id == tenant_org,
    ).first()
    if not rec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee '{agent_id}' not found in organization.",
        )

    perf = db.query(AgentPerformanceModel).filter(AgentPerformanceModel.agent_id == agent_id).first()
    if not perf:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Performance record for agent '{agent_id}' not found.",
        )
    return perf.to_dict()

@router.post("/provision-workforce")
def provision_workforce(
    organization_id: Optional[str] = Query("org_default_company"),
    db: Session = Depends(get_db),
):
    """
    Idempotently provision all 268 specialists into the company workforce.
    Preserves leadership agents, creates missing agents, allocates collision-free workstations.
    """
    from backend.app.services.workforce_provisioning_service import workforce_provisioning_service
    return workforce_provisioning_service.provision_full_workforce(
        db=db,
        organization_id=organization_id or "org_default_company",
    )
