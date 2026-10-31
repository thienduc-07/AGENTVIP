import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.schemas.memory import (
    MemoryCreate,
    MemoryResponse,
    MemorySearchResponse,
    MemoryOverviewStats,
)
from backend.app.services.memory_service import memory_service
from backend.app.services.event_service import event_service
from backend.app.websocket_manager import ws_manager

from backend.app.core.auth import (
    get_current_user,
    get_current_tenant_org,
    UserContext,
)

logger = logging.getLogger("grandline.api.memories")

router = APIRouter()

@router.get("/stats/overview", response_model=MemoryOverviewStats)
async def get_memory_overview_stats(
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieve high-level overview metrics of persistent memory and knowledge for caller's organization."""
    return memory_service.get_overview_stats(db)

@router.get("", response_model=MemorySearchResponse)
async def list_and_search_memories(
    query: Optional[str] = Query(None, description="Keywords to match in title, summary, or content"),
    scope_type: Optional[str] = Query(None, description="shared, agent, task, workspace"),
    scope_id: Optional[str] = Query(None, description="Specific scope identifier"),
    owner_agent_id: Optional[str] = Query(None, description="Filter by creating agent ID"),
    memory_type: Optional[str] = Query(None, description="task, agent, shared, working"),
    status: Optional[str] = Query("active", description="active, candidate, archived, or leave empty for all"),
    caller_agent_id: Optional[str] = Query(None, description="Requesting agent ID for permission validation"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search and filter memories with access control and tenant isolation."""
    effective_status = status if status and status.lower() != "all" else None
    return memory_service.search_memories(
        db=db,
        query=query,
        scope_type=scope_type,
        scope_id=scope_id,
        owner_agent_id=owner_agent_id,
        memory_type=memory_type,
        status=effective_status,
        caller_agent_id=caller_agent_id,
        limit=limit,
        offset=offset,
        organization_id=tenant_org,
    )

@router.get("/{memory_id}", response_model=MemoryResponse)
async def get_memory_by_id(
    memory_id: str,
    caller_agent_id: Optional[str] = Query(None, description="Requesting agent ID"),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retrieve full content and metadata for a specific memory item with tenant verification."""
    mem = memory_service.get_memory_by_id(
        db=db,
        memory_id=memory_id,
        caller_agent_id=caller_agent_id,
        record_access=True,
        organization_id=tenant_org,
    )
    return mem.to_dict()

@router.post("", response_model=MemoryResponse, status_code=status.HTTP_201_CREATED)
async def create_memory(
    data: MemoryCreate,
    auto_activate: bool = Query(False, description="Whether to immediately activate the memory"),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create or propose a new memory scoped to caller's organization."""
    mem = memory_service.create_memory(db, data, auto_activate=auto_activate, organization_id=tenant_org)

    ev_type = "memory.created" if mem.status == "active" else "memory.candidate_created"
    ev = event_service.create_event(
        db=db,
        event_type=ev_type,
        agent_id=mem.owner_agent_id or "system",
        task_id=mem.source_task_id,
        payload={
            "memory_id": mem.id,
            "title": mem.title,
            "scope_type": mem.scope_type,
            "status": mem.status,
            "confidence": mem.confidence,
            "organization_id": tenant_org,
        },
        commit=False,
    )
    db.commit()
    await ws_manager.broadcast_envelope(ev.to_envelope())
    return mem.to_dict()

@router.post("/{memory_id}/approve", response_model=MemoryResponse)
async def approve_candidate_memory(
    memory_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Approve a candidate memory item with tenant verification."""
    # Verify ownership first
    memory_service.get_memory_by_id(db=db, memory_id=memory_id, organization_id=tenant_org)
    mem = memory_service.approve_candidate(db, memory_id)

    ev = event_service.create_event(
        db=db,
        event_type="memory.created",
        agent_id=mem.owner_agent_id or "system",
        task_id=mem.source_task_id,
        payload={"memory_id": mem.id, "title": mem.title, "status": "active", "organization_id": tenant_org},
        commit=False,
    )
    db.commit()
    await ws_manager.broadcast_envelope(ev.to_envelope())
    return mem.to_dict()

@router.post("/{memory_id}/reject", response_model=MemoryResponse)
async def reject_candidate_memory(
    memory_id: str,
    reason: Optional[str] = Query(None, description="Reason for rejecting the candidate memory"),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reject a proposed memory candidate with tenant verification."""
    memory_service.get_memory_by_id(db=db, memory_id=memory_id, organization_id=tenant_org)
    mem = memory_service.reject_candidate(db, memory_id, reason=reason)
    return mem.to_dict()

@router.post("/{memory_id}/archive", response_model=MemoryResponse)
async def archive_memory(
    memory_id: str,
    reason: Optional[str] = Query("Archived by user/admin", description="Reason for archiving"),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Archive a memory item with tenant verification."""
    memory_service.get_memory_by_id(db=db, memory_id=memory_id, organization_id=tenant_org)
    mem = memory_service.archive_memory(db, memory_id, reason=reason)

    ev = event_service.create_event(
        db=db,
        event_type="memory.archived",
        agent_id=mem.owner_agent_id or "system",
        task_id=mem.source_task_id,
        payload={"memory_id": mem.id, "reason": reason, "organization_id": tenant_org},
        commit=False,
    )
    db.commit()
    await ws_manager.broadcast_envelope(ev.to_envelope())
    return mem.to_dict()

@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Soft delete a memory item with tenant verification."""
    memory_service.get_memory_by_id(db=db, memory_id=memory_id, organization_id=tenant_org)
    memory_service.delete_memory(db, memory_id)
    ev = event_service.create_event(
        db=db,
        event_type="memory.deleted",
        agent_id="system",
        task_id=None,
        payload={"memory_id": memory_id, "organization_id": tenant_org},
        commit=False,
    )
    db.commit()
    await ws_manager.broadcast_envelope(ev.to_envelope())
    return None
