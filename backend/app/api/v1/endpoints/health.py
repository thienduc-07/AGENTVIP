from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from backend.app.core.database import get_db
from backend.app.core.auth import (
    UserContext,
    get_current_tenant_org,
    get_current_user,
)
from backend.app.core.config import settings
from backend.app.agent_runtime.llm.capabilities import default_capability_registry
from backend.app.agent_runtime.llm.cost_controller import default_cost_controller
from backend.app.agent_runtime.llm.factory import inspect_provider_configuration
from backend.app.agent_runtime.llm.health_monitor import default_health_monitor
from backend.app.agent_runtime.llm.router import get_global_routing_decisions

router = APIRouter(tags=["Health"])

@router.get("/health")
def v1_health(db: Session = Depends(get_db)):
    db_status = "connected"
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_status = "disconnected"

    return {
        "status": "ok" if db_status == "connected" else "degraded",
        "service": "ai-agent-city-api",
        "database": db_status
    }


@router.get("/health/llm-routing")
def v1_llm_routing_diagnostics(
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
):
    """
    Administrative observability endpoint for Hybrid LLM Routing, Provider Health,
    Model Capability Registry, and Tenant-Isolated Cloud Cost Governance.
    Never exposes API keys or internal prompts.
    """
    return {
        "organization_id": tenant_org,
        "routing_mode": settings.LLM_ROUTING_MODE,
        "allow_cloud_fallback": settings.LLM_ALLOW_CLOUD_FALLBACK,
        "local_provider_config": inspect_provider_configuration(settings.LLM_LOCAL_PROVIDER),
        "cloud_provider_config": inspect_provider_configuration(settings.LLM_CLOUD_PROVIDER),
        "provider_health_snapshots": default_health_monitor.list_snapshots(),
        "budget_and_cost": default_cost_controller.get_organization_summary(tenant_org),
        "recent_routing_decisions": get_global_routing_decisions(
            organization_id=tenant_org,
            limit=25,
        ),
        "registered_models_count": len(default_capability_registry.list_models()),
    }
