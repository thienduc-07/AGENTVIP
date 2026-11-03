import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session
from sqlalchemy import text
import psutil
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
from backend.app.websocket_manager import ws_manager

router = APIRouter(tags=["Health"])

_START_TIME = time.time()

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


@router.get("/health/liveness")
def v1_liveness():
    """
    Ultra-lightweight liveness probe for container orchestrators (Kubernetes / ECS).
    Verifies process responsiveness with minimal CPU overhead.
    """
    return {
        "status": "alive",
        "service": "ai-agent-city-api",
        "version": settings.VERSION,
        "uptime_seconds": round(time.time() - _START_TIME, 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/health/readiness")
def v1_readiness(response: Response, db: Session = Depends(get_db)):
    """
    Comprehensive readiness probe verifying database connectivity,
    system memory/disk headroom, and subsystem operational readiness.
    Returns HTTP 503 if critical dependencies are unavailable.
    """
    start_db_ping = time.perf_counter()
    db_status = "connected"
    db_latency_ms = 0.0
    is_ready = True
    unready_reasons = []

    try:
        db.execute(text("SELECT 1;"))
        db_latency_ms = round((time.perf_counter() - start_db_ping) * 1000, 2)
    except Exception as e:
        db_status = "disconnected"
        is_ready = False
        unready_reasons.append(f"database_unavailable: {str(e)}")

    vm = psutil.virtual_memory()
    disk = psutil.disk_usage("/")

    if vm.percent > 98:
        is_ready = False
        unready_reasons.append("memory_exhaustion")
    if disk.percent > 99:
        is_ready = False
        unready_reasons.append("disk_full")

    ws_count = len(ws_manager.active_connections)

    if not is_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "ready" if is_ready else "not_ready",
        "service": "ai-agent-city-api",
        "version": settings.VERSION,
        "uptime_seconds": round(time.time() - _START_TIME, 2),
        "checks": {
            "database": {
                "status": db_status,
                "latency_ms": db_latency_ms,
            },
            "memory": {
                "percent": vm.percent,
                "used_mb": round(vm.used / (1024 * 1024), 2),
                "total_mb": round(vm.total / (1024 * 1024), 2),
                "healthy": vm.percent < 98,
            },
            "disk": {
                "percent": disk.percent,
                "free_gb": round(disk.free / (1024**3), 2),
                "healthy": disk.percent < 99,
            },
            "subsystems": {
                "websocket_active_clients": ws_count,
                "dispatcher_enabled": settings.DISPATCHER_ENABLED,
            },
        },
        "unready_reasons": unready_reasons,
    }


@router.get("/health/metrics")
def v1_metrics():
    """
    Observability metrics endpoint exposing host resource usage,
    process thread counts, memory footprints, and connection stats.
    """
    process = psutil.Process()
    mem_info = process.memory_info()
    return {
        "service": "ai-agent-city-api",
        "version": settings.VERSION,
        "uptime_seconds": round(time.time() - _START_TIME, 2),
        "process": {
            "cpu_percent": process.cpu_percent(interval=None),
            "memory_rss_mb": round(mem_info.rss / (1024 * 1024), 2),
            "memory_vms_mb": round(mem_info.vms / (1024 * 1024), 2),
            "threads": process.num_threads(),
        },
        "system": {
            "total_memory_mb": round(psutil.virtual_memory().total / (1024 * 1024), 2),
            "available_memory_mb": round(psutil.virtual_memory().available / (1024 * 1024), 2),
            "cpu_count": psutil.cpu_count(),
        },
        "connections": {
            "websocket_active": len(ws_manager.active_connections),
        },
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
