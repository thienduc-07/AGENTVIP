import logging
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.auth import (
    get_current_user,
    get_current_tenant_org,
    UserContext,
)
from backend.app.services.world_service import world_service
from backend.app.services.navigation_service import navigation_service
from backend.app.agent_runtime.heartbeat.ceo_heartbeat import ceo_heartbeat
from backend.app.schemas.world import WorldSnapshotResponse
from backend.app.schemas.navigation import OfficeTopologyResponse
from backend.app.schemas.heartbeat import (
    CEOOperationalReportResponse,
    CEOHeartbeatStatusResponse,
)

logger = logging.getLogger("agency.world.endpoint")

router = APIRouter(prefix="/world", tags=["World"])

@router.get("/snapshot", response_model=WorldSnapshotResponse)
def get_world_snapshot(
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WorldSnapshotResponse:
    """
    Returns an authoritative, point-in-time snapshot of the AI company's operational state.
    Strictly scoped to the authenticated caller's tenant organization.
    Aggregates:
      - Real corporate & specialist employees with lifecycle and operational status
      - Live execution activities without hallucinated progress or ghost executions
      - Physical & virtual workstation occupancy and capabilities
      - Authoritative event sequence watermark for client synchronization
    """
    return world_service.build_world_snapshot(db=db, organization_id=tenant_org)


@router.get("/topology", response_model=OfficeTopologyResponse)
def get_office_navigation_topology(
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OfficeTopologyResponse:
    """
    Returns the office navigation topology graph (zones, corridors, edges) and
    physical workstation destinations scoped to the caller's tenant organization.
    """
    return navigation_service.get_office_topology(db=db, organization_id=tenant_org)


@router.get("/heartbeat/status", response_model=CEOHeartbeatStatusResponse)
def get_ceo_heartbeat_status(
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
) -> CEOHeartbeatStatusResponse:
    """Returns current configuration and runtime status of the bounded CEO Supervisory Heartbeat."""
    return ceo_heartbeat.get_status()


@router.post("/heartbeat/run", response_model=CEOOperationalReportResponse)
async def trigger_ceo_heartbeat(
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CEOOperationalReportResponse:
    """Executes a single bounded, tenant-isolated supervisory heartbeat pass for agent-exec-ceo."""
    return await ceo_heartbeat.run_heartbeat_once(db=db, organization_id=tenant_org)
