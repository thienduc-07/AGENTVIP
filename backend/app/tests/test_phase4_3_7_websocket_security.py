"""
PROVIPAGENT Phase 4.3.7: WebSocket Adversarial Security Test Suite
Exhaustive verification of authentication, session revocation, cross-tenant subscription isolation,
payload boundaries, rate limiting, and defensive error handling over WebSocket connections.
"""
import json
from datetime import timedelta
import pytest
from starlette.websockets import WebSocketDisconnect
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from backend.app.core.auth import create_access_token
from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
from backend.app.models.agent import AgentModel
from backend.app.models.execution import ExecutionModel


@pytest.fixture
def ws_sec_setup(db_session: Session):
    """Sets up two isolated organizations and users for WebSocket security testing."""
    # Organization A
    org_a = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_ws_alpha").first()
    if not org_a:
        org_a = OrganizationModel(id="org_ws_alpha", name="WS Alpha Corp", slug="ws-alpha", is_active=True)
        db_session.add(org_a)

    # Organization B
    org_b = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_ws_beta").first()
    if not org_b:
        org_b = OrganizationModel(id="org_ws_beta", name="WS Beta Inc", slug="ws-beta", is_active=True)
        db_session.add(org_b)

    # User A in Org A
    user_a = db_session.query(UserModel).filter(UserModel.id == "usr_ws_alpha").first()
    if not user_a:
        user_a = UserModel(
            id="usr_ws_alpha",
            email="user@wsalpha.corp",
            full_name="User Alpha",
            hashed_password="pw",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_a)

    # User B in Org B
    user_b = db_session.query(UserModel).filter(UserModel.id == "usr_ws_beta").first()
    if not user_b:
        user_b = UserModel(
            id="usr_ws_beta",
            email="user@wsbeta.inc",
            full_name="User Beta",
            hashed_password="pw",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_b)

    # Memberships
    m_a = db_session.query(OrganizationMemberModel).filter(
        OrganizationMemberModel.user_id == "usr_ws_alpha",
        OrganizationMemberModel.organization_id == "org_ws_alpha"
    ).first()
    if not m_a:
        m_a = OrganizationMemberModel(id="mem_ws_a", user_id="usr_ws_alpha", organization_id="org_ws_alpha", role="ORGANIZATION_MEMBER")
        db_session.add(m_a)

    m_b = db_session.query(OrganizationMemberModel).filter(
        OrganizationMemberModel.user_id == "usr_ws_beta",
        OrganizationMemberModel.organization_id == "org_ws_beta"
    ).first()
    if not m_b:
        m_b = OrganizationMemberModel(id="mem_ws_b", user_id="usr_ws_beta", organization_id="org_ws_beta", role="ORGANIZATION_MEMBER")
        db_session.add(m_b)

    # Agent A in Org A
    agent_a = db_session.query(AgentModel).filter(AgentModel.id == "agt_ws_alpha").first()
    if not agent_a:
        agent_a = AgentModel(
            id="agt_ws_alpha",
            organization_id="org_ws_alpha",
            name="Agent Alpha WS",
            role="Engineer",
            description="Execute",
            status="idle",
            behavioral_state="IDLE",
        )
        db_session.add(agent_a)

    # Agent B in Org B
    agent_b = db_session.query(AgentModel).filter(AgentModel.id == "agt_ws_beta").first()
    if not agent_b:
        agent_b = AgentModel(
            id="agt_ws_beta",
            organization_id="org_ws_beta",
            name="Agent Beta WS",
            role="Analyst",
            description="Analyze",
            status="idle",
            behavioral_state="IDLE",
        )
        db_session.add(agent_b)

    # Execution A in Org A
    exec_a = db_session.query(ExecutionModel).filter(ExecutionModel.id == "exec_ws_alpha").first()
    if not exec_a:
        exec_a = ExecutionModel(
            id="exec_ws_alpha",
            organization_id="org_ws_alpha",
            agent_id="agt_ws_alpha",
            status="running",
            summary="Running alpha command",
        )
        db_session.add(exec_a)

    # Execution B in Org B
    exec_b = db_session.query(ExecutionModel).filter(ExecutionModel.id == "exec_ws_beta").first()
    if not exec_b:
        exec_b = ExecutionModel(
            id="exec_ws_beta",
            organization_id="org_ws_beta",
            agent_id="agt_ws_beta",
            status="running",
            summary="Running beta command",
        )
        db_session.add(exec_b)

    db_session.commit()

    token_a = create_access_token(user_id="usr_ws_alpha", email="user@wsalpha.corp", token_version=1)
    token_b = create_access_token(user_id="usr_ws_beta", email="user@wsbeta.inc", token_version=1)

    return {
        "user_a_id": "usr_ws_alpha",
        "user_b_id": "usr_ws_beta",
        "token_a": token_a,
        "token_b": token_b,
        "org_a": "org_ws_alpha",
        "org_b": "org_ws_beta",
        "agent_a_id": "agt_ws_alpha",
        "agent_b_id": "agt_ws_beta",
        "exec_a_id": "exec_ws_alpha",
        "exec_b_id": "exec_ws_beta",
    }


def test_ws_connection_rejected_without_token(client: TestClient, db_session: Session, monkeypatch):
    """Connecting to WebSocket without authentication must fail closed with 1008 Policy Violation."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/v1/events/ws"):
            pass
    assert exc.value.code == 1008


def test_ws_connection_rejected_invalid_token(client: TestClient, db_session: Session, monkeypatch):
    """Connecting with an invalid / forged token must fail closed with 1008."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/v1/events/ws?token=ey.forged.token"):
            pass
    assert exc.value.code == 1008


def test_ws_connection_rejected_expired_token(client: TestClient, db_session: Session, monkeypatch):
    """Connecting with an expired token must fail closed with 1008."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    expired_token = create_access_token(
        user_id="usr_ws_alpha",
        email="user@wsalpha.corp",
        token_version=1,
        expires_delta=timedelta(seconds=-10),
    )
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/v1/events/ws?token={expired_token}"):
            pass
    assert exc.value.code == 1008


def test_ws_connection_rejected_revoked_session_version(client: TestClient, db_session: Session, ws_sec_setup, monkeypatch):
    """Connecting with a token version that does not match the user's active version must be rejected."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    # Token issued with ver 0, but user in DB has token_version=1
    stale_token = create_access_token(user_id="usr_ws_alpha", email="user@wsalpha.corp", token_version=0)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/v1/events/ws?token={stale_token}"):
            pass
    assert exc.value.code == 1008


def test_ws_connection_rejected_inactive_user(client: TestClient, db_session: Session, ws_sec_setup, monkeypatch):
    """Connecting as a deactivated user must fail closed with 1008."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    u = db_session.query(UserModel).filter(UserModel.id == "usr_ws_alpha").first()
    u.is_active = False
    db_session.commit()

    try:
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect(f"/api/v1/events/ws?token={ws_sec_setup['token_a']}"):
                pass
        assert exc.value.code == 1008
    finally:
        u.is_active = True
        db_session.commit()


def test_ws_subscribe_agent_cross_tenant_denied(client: TestClient, db_session: Session, ws_sec_setup, monkeypatch):
    """User in Org A attempting to subscribe to an Agent in Org B must receive UNAUTHORIZED_TARGET error frame."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_sec_setup['token_a']}") as ws:
        _ = ws.receive_json()  # Consume initial snapshot

        # Attempt to subscribe to Agent B (belongs to Org B)
        ws.send_json({
            "action": "subscribe_agent",
            "payload": {"agent_id": ws_sec_setup["agent_b_id"]},
        })

        res = ws.receive_json()
        assert res["message_type"] == "error"
        assert res["code"] == "UNAUTHORIZED_TARGET"
        assert "access denied" in res["detail"]


def test_ws_subscribe_execution_cross_tenant_denied(client: TestClient, db_session: Session, ws_sec_setup, monkeypatch):
    """User in Org A attempting to subscribe to an Execution in Org B must receive UNAUTHORIZED_TARGET."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_sec_setup['token_a']}") as ws:
        _ = ws.receive_json()  # Initial snapshot

        # Attempt to subscribe to Execution B (belongs to Org B)
        ws.send_json({
            "action": "subscribe_execution",
            "payload": {"execution_id": ws_sec_setup["exec_b_id"]},
        })

        res = ws.receive_json()
        assert res["message_type"] == "error"
        assert res["code"] == "UNAUTHORIZED_TARGET"
        assert "access denied" in res["detail"]


def test_ws_subscribe_forged_nonexistent_ids(client: TestClient, db_session: Session, ws_sec_setup, monkeypatch):
    """Attempting to subscribe to nonexistent agent or execution IDs must return UNAUTHORIZED_TARGET."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_sec_setup['token_a']}") as ws:
        _ = ws.receive_json()

        # Nonexistent Agent
        ws.send_json({"action": "subscribe_agent", "payload": {"agent_id": "agt_nonexistent_999"}})
        res1 = ws.receive_json()
        assert res1["message_type"] == "error"
        assert res1["code"] == "UNAUTHORIZED_TARGET"

        # Nonexistent Execution
        ws.send_json({"action": "subscribe_execution", "payload": {"execution_id": "exec_nonexistent_999"}})
        res2 = ws.receive_json()
        assert res2["message_type"] == "error"
        assert res2["code"] == "UNAUTHORIZED_TARGET"


def test_ws_duplicate_subscriptions_idempotent(client: TestClient, db_session: Session, ws_sec_setup, monkeypatch):
    """Subscribing multiple times to the same valid agent must be idempotent and succeed without duplication."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_sec_setup['token_a']}") as ws:
        _ = ws.receive_json()

        for _ in range(3):
            ws.send_json({"action": "subscribe_agent", "payload": {"agent_id": ws_sec_setup["agent_a_id"]}})
            res = ws.receive_json()
            assert res["message_type"] == "subscribed"
            assert res["target_type"] == "agent"
            assert res["agent_id"] == ws_sec_setup["agent_a_id"]


def test_ws_malformed_json_payload_handled_gracefully(client: TestClient, db_session: Session, ws_sec_setup, monkeypatch):
    """Sending malformed JSON must return an INVALID_JSON error frame without crashing connection."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_sec_setup['token_a']}") as ws:
        _ = ws.receive_json()

        # Send raw invalid JSON
        ws.send_text("this is not { valid : json }")
        res = ws.receive_json()
        assert res["message_type"] == "error"
        assert res["code"] == "INVALID_JSON"

        # Subsequent valid message must still be processed normally
        ws.send_json({"action": "ping", "payload": {"timestamp": 12345}})
        pong = ws.receive_json()
        assert pong["message_type"] == "pong"
        assert pong["timestamp"] == 12345


def test_ws_oversized_payload_rejected(client: TestClient, db_session: Session, ws_sec_setup, monkeypatch):
    """Sending a frame exceeding 64KB must be rejected with PAYLOAD_TOO_LARGE."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_sec_setup['token_a']}") as ws:
        _ = ws.receive_json()

        huge_payload = json.dumps({"action": "ping", "payload": {"data": "X" * (65 * 1024)}})
        ws.send_text(huge_payload)
        res = ws.receive_json()
        assert res["message_type"] == "error"
        assert res["code"] == "PAYLOAD_TOO_LARGE"


def test_ws_rate_limiting_flood_protection(client: TestClient, db_session: Session, ws_sec_setup, monkeypatch):
    """Sending messages exceeding the rate limit (30/sec) must trigger RATE_LIMIT_EXCEEDED."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_sec_setup['token_a']}") as ws:
        _ = ws.receive_json()

        got_rate_limit = False
        # Send 35 rapid pings
        for i in range(35):
            ws.send_json({"action": "ping", "payload": {"timestamp": i}})
            res = ws.receive_json()
            if res.get("code") == "RATE_LIMIT_EXCEEDED":
                got_rate_limit = True
                break

        assert got_rate_limit is True, "Rate limiting did not trigger upon sending >30 rapid requests"


def test_ws_session_revocation_during_active_connection(client: TestClient, db_session: Session, ws_sec_setup, monkeypatch):
    """When a connected user is deactivated mid-session, subsequent actions must terminate connection immediately."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_sec_setup['token_a']}") as ws:
        _ = ws.receive_json()

        # Deactivate user mid-connection
        u = db_session.query(UserModel).filter(UserModel.id == "usr_ws_alpha").first()
        u.is_active = False
        db_session.commit()

        try:
            # Action requiring active user validation
            ws.send_json({"action": "resync"})
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 1008
        finally:
            u.is_active = True
            db_session.commit()
