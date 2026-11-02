"""
PROVIPAGENT Phase 4.3.7.1: WebSocket Adversarial Security Verification Suite
Independently verifies 15 required WebSocket security scenarios covering
authentication, authorization, cross-tenant isolation, replay security,
payload bounding, flooding defense, and session lifecycle.
"""
import json
import time
import signal
from datetime import timedelta
import pytest
from starlette.websockets import WebSocketDisconnect
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from backend.app.core.auth import create_access_token
from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
from backend.app.models.agent import AgentModel
from backend.app.models.execution import ExecutionModel
from backend.app.services.event_service import event_service
from backend.app.websocket_manager import ws_manager


@pytest.fixture(autouse=True)
def test_timeout():
    """Enforces strict 5-second per-test execution safety timeout."""
    def _timeout_handler(signum, frame):
        raise TimeoutError("WebSocket adversarial test exceeded 5-second safety timeout limit")

    old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(5)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)


@pytest.fixture
def ws_adv_env(db_session: Session):
    """Sets up two strictly isolated tenant organizations with events for WebSocket testing."""
    # 1. Organizations
    org_a = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_ws_adv_a").first()
    if not org_a:
        org_a = OrganizationModel(id="org_ws_adv_a", name="WS Alpha Security Corp", slug="ws-alpha-sec", is_active=True)
        db_session.add(org_a)

    org_b = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_ws_adv_b").first()
    if not org_b:
        org_b = OrganizationModel(id="org_ws_adv_b", name="WS Beta Security Inc", slug="ws-beta-sec", is_active=True)
        db_session.add(org_b)

    # 2. Users
    user_a = db_session.query(UserModel).filter(UserModel.id == "usr_ws_adv_a").first()
    if not user_a:
        user_a = UserModel(
            id="usr_ws_adv_a",
            email="usera@wsalpha.sec",
            full_name="User Alpha WS",
            hashed_password="pw",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_a)

    user_b = db_session.query(UserModel).filter(UserModel.id == "usr_ws_adv_b").first()
    if not user_b:
        user_b = UserModel(
            id="usr_ws_adv_b",
            email="userb@wsbeta.sec",
            full_name="User Beta WS",
            hashed_password="pw",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user_b)

    # 3. Memberships
    m_a = db_session.query(OrganizationMemberModel).filter(
        OrganizationMemberModel.user_id == "usr_ws_adv_a",
        OrganizationMemberModel.organization_id == "org_ws_adv_a"
    ).first()
    if not m_a:
        m_a = OrganizationMemberModel(id="mem_ws_adv_a", user_id="usr_ws_adv_a", organization_id="org_ws_adv_a", role="ORGANIZATION_ADMIN")
        db_session.add(m_a)

    m_b = db_session.query(OrganizationMemberModel).filter(
        OrganizationMemberModel.user_id == "usr_ws_adv_b",
        OrganizationMemberModel.organization_id == "org_ws_adv_b"
    ).first()
    if not m_b:
        m_b = OrganizationMemberModel(id="mem_ws_adv_b", user_id="usr_ws_adv_b", organization_id="org_ws_adv_b", role="ORGANIZATION_ADMIN")
        db_session.add(m_b)

    # 4. Agents
    agent_a = db_session.query(AgentModel).filter(AgentModel.id == "agt_ws_adv_a").first()
    if not agent_a:
        agent_a = AgentModel(
            id="agt_ws_adv_a",
            organization_id="org_ws_adv_a",
            name="Agent Alpha WS",
            role="Specialist",
            status="idle",
            behavioral_state="IDLE",
        )
        db_session.add(agent_a)

    agent_b = db_session.query(AgentModel).filter(AgentModel.id == "agt_ws_adv_b").first()
    if not agent_b:
        agent_b = AgentModel(
            id="agt_ws_adv_b",
            organization_id="org_ws_adv_b",
            name="Agent Beta WS",
            role="Specialist",
            status="idle",
            behavioral_state="IDLE",
        )
        db_session.add(agent_b)

    # 5. Executions
    exec_a = db_session.query(ExecutionModel).filter(ExecutionModel.id == "exec_ws_adv_a").first()
    if not exec_a:
        exec_a = ExecutionModel(
            id="exec_ws_adv_a",
            organization_id="org_ws_adv_a",
            agent_id="agt_ws_adv_a",
            status="running",
            summary="Alpha execution",
        )
        db_session.add(exec_a)

    exec_b = db_session.query(ExecutionModel).filter(ExecutionModel.id == "exec_ws_adv_b").first()
    if not exec_b:
        exec_b = ExecutionModel(
            id="exec_ws_adv_b",
            organization_id="org_ws_adv_b",
            agent_id="agt_ws_adv_b",
            status="running",
            summary="Beta execution",
        )
        db_session.add(exec_b)

    # 6. Audit Events for Replay Testing
    ev_a1 = event_service.create_event(
        db=db_session,
        event_type="agent.thinking",
        agent_id="agt_ws_adv_a",
        organization_id="org_ws_adv_a",
        payload={"secret_alpha": "ALPHA_CONFIDENTIAL_1"},
        commit=False,
    )
    ev_a2 = event_service.create_event(
        db=db_session,
        event_type="agent.working",
        agent_id="agt_ws_adv_a",
        organization_id="org_ws_adv_a",
        payload={"secret_alpha": "ALPHA_CONFIDENTIAL_2"},
        commit=False,
    )
    ev_b1 = event_service.create_event(
        db=db_session,
        event_type="agent.thinking",
        agent_id="agt_ws_adv_b",
        organization_id="org_ws_adv_b",
        payload={"secret_beta": "BETA_TOP_SECRET_1"},
        commit=False,
    )

    db_session.commit()

    token_a = create_access_token(user_id="usr_ws_adv_a", email="usera@wsalpha.sec", token_version=1)
    token_b = create_access_token(user_id="usr_ws_adv_b", email="userb@wsbeta.sec", token_version=1)

    return {
        "token_a": token_a,
        "token_b": token_b,
        "org_a": "org_ws_adv_a",
        "org_b": "org_ws_adv_b",
        "agent_a_id": "agt_ws_adv_a",
        "agent_b_id": "agt_ws_adv_b",
        "exec_a_id": "exec_ws_adv_a",
        "exec_b_id": "exec_ws_adv_b",
        "ev_a1_seq": ev_a1.sequence_id,
        "ev_b1_seq": ev_b1.sequence_id,
    }


def test_scenario_01_missing_auth_token_rejected(client: TestClient, db_session: Session, monkeypatch):
    """Scenario 1: Missing authentication token must immediately fail closed with 1008."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/v1/events/ws"):
            pass
    assert exc.value.code == 1008


def test_scenario_02_invalid_jwt_rejected(client: TestClient, db_session: Session, monkeypatch):
    """Scenario 2: Malformed or forged JWT must fail closed with 1008."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/v1/events/ws?token=forged.garbage.token"):
            pass
    assert exc.value.code == 1008


def test_scenario_03_expired_jwt_rejected(client: TestClient, db_session: Session, monkeypatch):
    """Scenario 3: Expired JWT must fail closed with 1008."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    expired_token = create_access_token(
        user_id="usr_ws_adv_a",
        email="usera@wsalpha.sec",
        token_version=1,
        expires_delta=timedelta(seconds=-30),
    )
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/v1/events/ws?token={expired_token}"):
            pass
    assert exc.value.code == 1008


def test_scenario_04_revoked_session_version_rejected(client: TestClient, db_session: Session, ws_adv_env, monkeypatch):
    """Scenario 4: Token version mismatch (ver=0 vs user's active version=1) must fail closed with 1008."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    stale_token = create_access_token(user_id="usr_ws_adv_a", email="usera@wsalpha.sec", token_version=0)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/v1/events/ws?token={stale_token}"):
            pass
    assert exc.value.code == 1008


def test_scenario_05_deactivated_user_rejected(client: TestClient, db_session: Session, ws_adv_env, monkeypatch):
    """Scenario 5: Inactive user account must fail closed with 1008."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    u = db_session.query(UserModel).filter(UserModel.id == "usr_ws_adv_a").first()
    u.is_active = False
    db_session.commit()

    try:
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect(f"/api/v1/events/ws?token={ws_adv_env['token_a']}"):
                pass
        assert exc.value.code == 1008
    finally:
        u.is_active = True
        db_session.commit()


def test_scenario_06_cross_tenant_subscribe_agent_denied(client: TestClient, db_session: Session, ws_adv_env, monkeypatch):
    """Scenario 6: User A subscribing to Agent B must receive UNAUTHORIZED_TARGET error frame."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_adv_env['token_a']}") as ws:
        _ = ws.receive_json()  # Snapshot

        ws.send_json({"action": "subscribe_agent", "payload": {"agent_id": ws_adv_env["agent_b_id"]}})
        res = ws.receive_json()
        assert res["message_type"] == "error"
        assert res["code"] == "UNAUTHORIZED_TARGET"
        assert "access denied" in res["detail"]


def test_scenario_07_cross_tenant_subscribe_execution_denied(client: TestClient, db_session: Session, ws_adv_env, monkeypatch):
    """Scenario 7: User A subscribing to Execution B must receive UNAUTHORIZED_TARGET."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_adv_env['token_a']}") as ws:
        _ = ws.receive_json()

        ws.send_json({"action": "subscribe_execution", "payload": {"execution_id": ws_adv_env["exec_b_id"]}})
        res = ws.receive_json()
        assert res["message_type"] == "error"
        assert res["code"] == "UNAUTHORIZED_TARGET"


def test_scenario_08_event_replay_strictly_tenant_scoped(client: TestClient, db_session: Session, ws_adv_env, monkeypatch):
    """Scenario 8: User A replaying events from sequence 0 receives ONLY Org A events, ZERO Org B events."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_adv_env['token_a']}") as ws:
        _ = ws.receive_json()  # Consume initial snapshot

        # Request replay from beginning
        ws.send_json({"action": "replay", "last_sequence_id": 0})

        # Exactly 2 events were generated for Org A in ws_adv_env fixture
        replayed_payloads = []
        for _ in range(2):
            msg = ws.receive_json()
            assert msg["message_type"] == "event"
            replayed_payloads.append(msg)

        # Send a ping sentinel barrier to prove no extra/unauthorized messages were queued
        ws.send_json({"action": "ping", "payload": {"barrier": 8}})
        barrier = ws.receive_json()
        assert barrier["message_type"] == "pong", "Unexpected frame received before pong sentinel"

        assert len(replayed_payloads) == 2, "Expected exactly 2 replayed Org A events"
        for msg in replayed_payloads:
            ev = msg["event"]
            assert ev["organization_id"] == "org_ws_adv_a"
            assert "BETA_TOP_SECRET" not in json.dumps(ev)


def test_scenario_09_reconnect_after_session_revocation_rejected(client: TestClient, db_session: Session, ws_adv_env, monkeypatch):
    """Scenario 9: Reconnecting with a token whose version was incremented in DB must be rejected."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    # First connection with token_a succeeds
    with client.websocket_connect(f"/api/v1/events/ws?token={ws_adv_env['token_a']}") as ws:
        _ = ws.receive_json()

    # Revoke user's session in DB
    u = db_session.query(UserModel).filter(UserModel.id == "usr_ws_adv_a").first()
    u.token_version = 2
    db_session.commit()

    try:
        # Reconnection with old token (ver 1) must now fail with 1008
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect(f"/api/v1/events/ws?token={ws_adv_env['token_a']}"):
                pass
        assert exc.value.code == 1008
    finally:
        u.token_version = 1
        db_session.commit()


def test_scenario_10_malformed_json_resilience(client: TestClient, db_session: Session, ws_adv_env, monkeypatch):
    """Scenario 10: Sending malformed non-JSON text returns INVALID_JSON without crashing connection."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_adv_env['token_a']}") as ws:
        _ = ws.receive_json()

        # Send raw malformed payload
        ws.send_text("MALFORMED NON-JSON STRING {:::;")
        res = ws.receive_json()
        assert res["message_type"] == "error"
        assert res["code"] == "INVALID_JSON"

        # Subsequent valid message must still be processed
        ws.send_json({"action": "ping", "payload": {"timestamp": 99999}})
        pong = ws.receive_json()
        assert pong["message_type"] == "pong"
        assert pong["timestamp"] == 99999


def test_scenario_11_oversized_incoming_frame_rejected(client: TestClient, db_session: Session, ws_adv_env, monkeypatch):
    """Scenario 11: Frame exceeding 64KB must be rejected with PAYLOAD_TOO_LARGE."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_adv_env['token_a']}") as ws:
        _ = ws.receive_json()

        huge_frame = json.dumps({"action": "ping", "data": "A" * (65 * 1024)})
        ws.send_text(huge_frame)
        res = ws.receive_json()
        assert res["message_type"] == "error"
        assert res["code"] == "PAYLOAD_TOO_LARGE"


def test_scenario_12_message_flooding_rate_limited(client: TestClient, db_session: Session, ws_adv_env, monkeypatch):
    """Scenario 12: Flooding > 30 messages/sec must trigger RATE_LIMIT_EXCEEDED."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_adv_env['token_a']}") as ws:
        _ = ws.receive_json()

        rate_limited = False
        for i in range(35):
            ws.send_json({"action": "ping", "payload": {"seq": i}})
            res = ws.receive_json()
            if res.get("code") == "RATE_LIMIT_EXCEEDED":
                rate_limited = True
                break

        assert rate_limited is True, "Rate limiting did not throttle connection under >30 msgs/sec flood"


def test_scenario_13_subscription_switching_between_organizations_rejected(client: TestClient, db_session: Session, ws_adv_env, monkeypatch):
    """Scenario 13: Attempting to connect or switch to another organization_id must be rejected with 1008."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/v1/events/ws?token={ws_adv_env['token_a']}&organization_id=org_ws_adv_b"):
            pass
    assert exc.value.code == 1008


def test_scenario_14_disconnect_during_event_streaming_cleans_up(client: TestClient, db_session: Session, ws_adv_env, monkeypatch):
    """Scenario 14: Client disconnect cleanly purges connection from active tracking."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    initial_count = len(ws_manager.active_connections)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_adv_env['token_a']}") as ws:
        _ = ws.receive_json()
        assert len(ws_manager.active_connections) == initial_count + 1

    # After exiting context, connection must be cleanly removed
    assert len(ws_manager.active_connections) == initial_count


def test_scenario_15_reconnect_and_replay_monotonic_clean(client: TestClient, db_session: Session, ws_adv_env, monkeypatch):
    """Scenario 15: Reconnection and replay emits monotonically ordered sequences without duplicates."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    with client.websocket_connect(f"/api/v1/events/ws?token={ws_adv_env['token_a']}") as ws:
        _ = ws.receive_json()  # Snapshot

        ws.send_json({"action": "replay", "last_sequence_id": 0})
        messages = []
        for _ in range(2):
            m = ws.receive_json()
            assert m.get("message_type") == "event"
            messages.append(m)

        # Ping barrier sentinel
        ws.send_json({"action": "ping", "payload": {"barrier": 15}})
        sentinel = ws.receive_json()
        assert sentinel["message_type"] == "pong"

        seqs = [m["event"]["sequence_id"] for m in messages]
        # Must be strictly unique
        assert len(seqs) == len(set(seqs))
        # Must be strictly ascending
        assert seqs == sorted(seqs)

