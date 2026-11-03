import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.core.auth import create_access_token


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def superadmin_token():
    return create_access_token(
        user_id="usr-platform-superadmin",
        email="admin@agency.ai",
        is_superadmin=True,
        org_roles={"org_default_company": "admin"},
        token_version=1,
    )


def test_v1_health_basic(client):
    """Test 1: Standard /api/v1/health check endpoint returns 200 and connected DB."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["database"] == "connected"
    assert data["service"] == "ai-agent-city-api"


def test_v1_liveness_probe(client):
    """Test 2: Liveness probe returns 200 alive, service name, version, and valid uptime."""
    response = client.get("/api/v1/health/liveness")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "alive"
    assert data["service"] == "ai-agent-city-api"
    assert "version" in data
    assert "uptime_seconds" in data
    assert data["uptime_seconds"] >= 0
    assert "timestamp" in data


def test_v1_readiness_probe_healthy(client):
    """Test 3: Readiness probe returns 200 ready when DB, memory, and disk are healthy."""
    response = client.get("/api/v1/health/readiness")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert "checks" in data
    checks = data["checks"]
    assert checks["database"]["status"] == "connected"
    assert checks["database"]["latency_ms"] >= 0
    assert checks["memory"]["healthy"] is True
    assert checks["disk"]["healthy"] is True
    assert "websocket_active_clients" in checks["subsystems"]
    assert data["unready_reasons"] == []


def test_v1_readiness_probe_degraded_db_failure(client):
    """Test 4: Readiness probe returns 503 not_ready when database ping fails."""
    with patch("backend.app.api.v1.endpoints.health.get_db") as mock_get_db:
        mock_session = MagicMock()
        mock_session.execute.side_effect = Exception("Connection refused to SQLite")
        mock_get_db.return_value = mock_session

        # Override dependency in app
        from backend.app.core.database import get_db
        app.dependency_overrides[get_db] = lambda: mock_session

        try:
            response = client.get("/api/v1/health/readiness")
            assert response.status_code == 503
            data = response.json()
            assert data["status"] == "not_ready"
            assert data["checks"]["database"]["status"] == "disconnected"
            assert any("database_unavailable" in r for r in data["unready_reasons"])
        finally:
            app.dependency_overrides.pop(get_db, None)


def test_v1_metrics_endpoint(client):
    """Test 5: Observability metrics endpoint returns host and process resource profiles."""
    response = client.get("/api/v1/health/metrics")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "ai-agent-city-api"
    assert "process" in data
    assert data["process"]["threads"] > 0
    assert data["process"]["memory_rss_mb"] > 0
    assert "system" in data
    assert data["system"]["total_memory_mb"] > 0
    assert "connections" in data
    assert "websocket_active" in data["connections"]


def test_v1_llm_routing_diagnostics(client, superadmin_token):
    """Test 6: Administrative LLM routing diagnostics endpoint returns secure telemetry without leaking keys."""
    headers = {"Authorization": f"Bearer {superadmin_token}"}
    response = client.get("/api/v1/health/llm-routing", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["organization_id"] == "org_default_company"
    assert "routing_mode" in data
    assert "registered_models_count" in data
    assert "budget_and_cost" in data

    # Verify no raw API keys are exposed
    json_str = response.text.lower()
    assert "sk-" not in json_str
    assert "bearer " not in json_str or "auth" in json_str
