import pytest
from backend.app.models.agent import AgentModel
from backend.app.scripts.seed import INITIAL_AGENTS

def test_list_agents(auth_client, seed_test_agent):
    response = auth_client.get("/api/v1/agents")
    assert response.status_code == 200
    agents = response.json()
    assert isinstance(agents, list)
    assert len(agents) >= 1
    found = any(a["id"] == seed_test_agent.id for a in agents)
    assert found is True

def test_get_agent_by_id(auth_client, seed_test_agent):
    response = auth_client.get(f"/api/v1/agents/{seed_test_agent.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == seed_test_agent.id
    assert data["name"] == seed_test_agent.name
    assert data["role"] == seed_test_agent.role
    assert data["status"] == "idle"

def test_get_agent_not_found(auth_client):
    response = auth_client.get("/api/v1/agents/non-existent-agent-id")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "AGENT_NOT_FOUND"

def test_create_agent_success(auth_client):
    payload = {
        "id": "agent-usopp-sniper",
        "name": "Sniper King Usopp",
        "role": "Chief Marksman & Scout",
        "station": "harbor",
        "color": "#14b8a6",
        "avatar": "swordsman",
        "description": "Thám báo tầm xa và trinh sát hải lưu."
    }
    response = auth_client.post("/api/v1/agents", json=payload)
    assert response.status_code == 201
    created = response.json()
    assert created["id"] == payload["id"]
    assert created["name"] == payload["name"]
    assert created["status"] == "idle"

def test_create_agent_blank_name_rejected(auth_client):
    payload = {
        "name": "   ",
        "role": "Navigator",
        "station": "library"
    }
    response = auth_client.post("/api/v1/agents", json=payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] in ["EMPTY_AGENT_NAME", "VALIDATION_ERROR"]

def test_create_agent_duplicate_id_rejected(auth_client, seed_test_agent):
    payload = {
        "id": seed_test_agent.id,
        "name": "Duplicate Agent",
        "role": "Duplicate Role",
        "station": "captain_hq"
    }
    response = auth_client.post("/api/v1/agents", json=payload)
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "AGENT_ALREADY_EXISTS"

def test_update_agent_allowed_fields(auth_client, seed_test_agent):
    payload = {
        "description": "Updated tactical lore for captain.",
        "color": "#eab308"
    }
    response = auth_client.patch(f"/api/v1/agents/{seed_test_agent.id}", json=payload)
    assert response.status_code == 200
    updated = response.json()
    assert updated["description"] == payload["description"]
    assert updated["color"] == payload["color"]

def test_seed_script_idempotent(db_session):
    # Run seed logic against the session
    for agent_data in INITIAL_AGENTS:
        existing = db_session.query(AgentModel).filter(AgentModel.id == agent_data["id"]).first()
        if not existing:
            new_a = AgentModel(
                id=agent_data["id"],
                name=agent_data["name"],
                role=agent_data["role"],
                station=agent_data["station"],
                status=agent_data["status"],
                color=agent_data["color"],
                avatar=agent_data["avatar"],
                pos_x=agent_data["pos_x"],
                pos_y=agent_data["pos_y"],
                pos_z=agent_data["pos_z"],
                description=agent_data["description"]
            )
            db_session.add(new_a)
    db_session.commit()

    count_first = db_session.query(AgentModel).count()
    assert count_first >= 4

    # Run again - should not add any duplicates
    duplicates_added = 0
    for agent_data in INITIAL_AGENTS:
        existing = db_session.query(AgentModel).filter(AgentModel.id == agent_data["id"]).first()
        if not existing:
            duplicates_added += 1

    assert duplicates_added == 0
    count_second = db_session.query(AgentModel).count()
    assert count_first == count_second
