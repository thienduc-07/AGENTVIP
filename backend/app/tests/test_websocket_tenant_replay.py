import json
import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.app.core.auth import create_jwt_token, hash_password
from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.services.event_service import event_service
from backend.app.websocket_manager import ws_manager


@pytest.fixture
def multi_tenant_setup(db_session):
    """
    Sets up two isolated organizations (Org Alpha, Org Beta), users, agents,
    and events with distinct payloads to test WebSocket replay isolation.
    """
    # 1. Organization Alpha
    org_a = OrganizationModel(
        id="org_alpha_security",
        name="Alpha Security Corp",
        slug="alpha-sec",
        is_active=True
    )
    user_a = UserModel(
        id="user_alpha_lead",
        email="lead@alpha-sec.com",
        full_name="Alpha Lead",
        hashed_password=hash_password("AlphaPass123!"),
        is_active=True,
        token_version=1,
        is_superadmin=False,
    )
    member_a = OrganizationMemberModel(
        user_id=user_a.id,
        organization_id=org_a.id,
        role="ADMIN"
    )
    agent_a = AgentModel(
        id="agent_alpha_1",
        name="Alpha Agent 1",
        role="Security Auditor",
        station="sec_lab",
        status="idle",
        color="#10b981",
        avatar="alpha_avatar",
        pos_x=1.0,
        pos_y=0.0,
        pos_z=1.0,
        organization_id=org_a.id,
    )
    task_a = TaskModel(
        title="Alpha Mission Alpha",
        description="Confidential Alpha Work",
        assigned_agent_id=agent_a.id,
        organization_id=org_a.id,
        status="queued",
        priority="high"
    )

    # 2. Organization Beta
    org_b = OrganizationModel(
        id="org_beta_security",
        name="Beta Security Corp",
        slug="beta-sec",
        is_active=True
    )
    user_b = UserModel(
        id="user_beta_lead",
        email="lead@beta-sec.com",
        full_name="Beta Lead",
        hashed_password=hash_password("BetaPass123!"),
        is_active=True,
        token_version=1,
        is_superadmin=False,
    )
    member_b = OrganizationMemberModel(
        user_id=user_b.id,
        organization_id=org_b.id,
        role="ADMIN"
    )
    agent_b = AgentModel(
        id="agent_beta_1",
        name="Beta Agent 1",
        role="Forensic Analyst",
        station="forensics_lab",
        status="idle",
        color="#6366f1",
        avatar="beta_avatar",
        pos_x=2.0,
        pos_y=0.0,
        pos_z=2.0,
        organization_id=org_b.id,
    )
    task_b = TaskModel(
        title="Beta Mission Beta",
        description="Confidential Beta Work",
        assigned_agent_id=agent_b.id,
        organization_id=org_b.id,
        status="queued",
        priority="high"
    )

    # 3. Superadmin User (has access to multi-tenant or system events)
    user_super = UserModel(
        id="user_superadmin_sec",
        email="superadmin@provipagent.internal",
        full_name="Super Admin Sec",
        hashed_password=hash_password("SuperPass123!"),
        is_active=True,
        token_version=1,
        is_superadmin=True,
    )

    # 4. User without organization membership (orphaned tenant context)
    user_no_org = UserModel(
        id="user_no_org_context",
        email="no_org@untrusted.com",
        full_name="No Org User",
        hashed_password=hash_password("NoOrgPass123!"),
        is_active=True,
        token_version=1,
        is_superadmin=False,
    )

    db_session.add_all([org_a, user_a, member_a, agent_a, task_a])
    db_session.add_all([org_b, user_b, member_b, agent_b, task_b])
    db_session.add_all([user_super, user_no_org])
    db_session.commit()

    # Generate events for Org Alpha
    ev_a1 = event_service.create_event(
        db=db_session,
        event_type="alpha.secret.init",
        agent_id=agent_a.id,
        task_id=task_a.id,
        organization_id=org_a.id,
        payload={"secret_data": "ALPHA_CONFIDENTIAL_1", "step": 1},
        commit=True,
    )
    ev_a2 = event_service.create_event(
        db=db_session,
        event_type="alpha.secret.exec",
        agent_id=agent_a.id,
        task_id=task_a.id,
        organization_id=org_a.id,
        payload={"secret_data": "ALPHA_CONFIDENTIAL_2", "step": 2},
        commit=True,
    )
    ev_a3 = event_service.create_event(
        db=db_session,
        event_type="alpha.secret.complete",
        agent_id=agent_a.id,
        task_id=task_a.id,
        organization_id=org_a.id,
        payload={"secret_data": "ALPHA_CONFIDENTIAL_3", "step": 3},
        commit=True,
    )

    # Generate events for Org Beta
    ev_b1 = event_service.create_event(
        db=db_session,
        event_type="beta.classified.init",
        agent_id=agent_b.id,
        task_id=task_b.id,
        organization_id=org_b.id,
        payload={"classified_data": "BETA_RESTRICTED_1", "phase": "alpha"},
        commit=True,
    )
    ev_b2 = event_service.create_event(
        db=db_session,
        event_type="beta.classified.exec",
        agent_id=agent_b.id,
        task_id=task_b.id,
        organization_id=org_b.id,
        payload={"classified_data": "BETA_RESTRICTED_2", "phase": "beta"},
        commit=True,
    )

    # Generate an un-owned system event (organization_id is None)
    ev_sys = event_service.create_event(
        db=db_session,
        event_type="system.internal.heartbeat",
        agent_id=None,
        task_id=None,
        organization_id=None,
        payload={"system_metric": "CLUSTER_OPTIMAL"},
        commit=True,
    )

    token_a = create_jwt_token({"sub": user_a.id, "email": user_a.email, "org_id": org_a.id, "ver": 1})
    token_b = create_jwt_token({"sub": user_b.id, "email": user_b.email, "org_id": org_b.id, "ver": 1})
    token_super = create_jwt_token({"sub": user_super.id, "email": user_super.email, "ver": 1})
    token_no_org = create_jwt_token({"sub": user_no_org.id, "email": user_no_org.email, "ver": 1})

    return {
        "org_a": org_a,
        "org_b": org_b,
        "user_a": user_a,
        "user_b": user_b,
        "token_a": token_a,
        "token_b": token_b,
        "token_super": token_super,
        "token_no_org": token_no_org,
        "events_a": [ev_a1, ev_a2, ev_a3],
        "events_b": [ev_b1, ev_b2],
        "event_sys": ev_sys,
    }


def test_01_org_a_can_replay_own_events(client, db_session, multi_tenant_setup, monkeypatch):
    """Scenario 1: Organization A can replay its own events."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    token_a = multi_tenant_setup["token_a"]
    events_a = multi_tenant_setup["events_a"]

    with client.websocket_connect(f"/api/v1/events/ws?token={token_a}") as ws:
        _ = ws.receive_json()  # Snapshot

        # Request replay after sequence before first event
        first_seq = events_a[0].sequence_id
        ws.send_json({"action": "replay", "last_sequence_id": first_seq - 1})

        replayed = []
        for _ in range(len(events_a)):
            msg = ws.receive_json()
            assert msg["message_type"] == "event"
            replayed.append(msg)

        replayed_ids = [m["event"]["event_id"] for m in replayed]
        for ev in events_a:
            assert ev.id in replayed_ids
            # Verify actual payload content
            matching = next(m for m in replayed if m["event"]["event_id"] == ev.id)
            assert matching["event"]["organization_id"] == "org_alpha_security"
            assert "secret_data" in matching["event"]["payload"]


def test_02_org_a_cannot_replay_org_b_events(client, db_session, multi_tenant_setup, monkeypatch):
    """Scenario 2: Organization A cannot replay Organization B events."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    token_a = multi_tenant_setup["token_a"]
    events_b = multi_tenant_setup["events_b"]

    with client.websocket_connect(f"/api/v1/events/ws?token={token_a}") as ws:
        _ = ws.receive_json()  # Snapshot

        # Attempt to replay everything from sequence 0
        ws.send_json({"action": "replay", "last_sequence_id": 0})

        # Collect all replayed messages
        replayed = []
        try:
            # We know org A has 3 events
            for _ in range(len(multi_tenant_setup["events_a"])):
                msg = ws.receive_json()
                replayed.append(msg)
        except Exception:
            pass

        replayed_ids = [m.get("event", {}).get("event_id") for m in replayed]
        replayed_payloads = [m.get("event", {}).get("payload", {}) for m in replayed]

        for ev_b in events_b:
            assert ev_b.id not in replayed_ids, f"Leak detected: Org B event {ev_b.id} returned to Org A!"

        for p in replayed_payloads:
            assert "classified_data" not in p, f"Leak detected: Org B confidential payload found: {p}"
            assert p.get("classified_data") != "BETA_RESTRICTED_1"


def test_03_org_b_cannot_replay_org_a_events(client, db_session, multi_tenant_setup, monkeypatch):
    """Scenario 3: Organization B cannot replay Organization A events."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    token_b = multi_tenant_setup["token_b"]
    events_a = multi_tenant_setup["events_a"]

    with client.websocket_connect(f"/api/v1/events/ws?token={token_b}") as ws:
        _ = ws.receive_json()  # Snapshot

        ws.send_json({"action": "replay", "last_sequence_id": 0})

        replayed = []
        for _ in range(len(multi_tenant_setup["events_b"])):
            msg = ws.receive_json()
            replayed.append(msg)

        replayed_ids = [m.get("event", {}).get("event_id") for m in replayed]
        replayed_payloads = [m.get("event", {}).get("payload", {}) for m in replayed]

        for ev_a in events_a:
            assert ev_a.id not in replayed_ids, f"Leak detected: Org A event {ev_a.id} returned to Org B!"

        for p in replayed_payloads:
            assert "secret_data" not in p, f"Leak detected: Org A confidential payload found: {p}"


def test_04_replay_request_with_last_sequence_zero_remains_tenant_isolated(client, db_session, multi_tenant_setup, monkeypatch):
    """Scenario 4: A replay request with last_sequence_id = 0 remains strictly tenant-isolated."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    token_a = multi_tenant_setup["token_a"]
    token_b = multi_tenant_setup["token_b"]

    # Replay sequence 0 for Org A
    with client.websocket_connect(f"/api/v1/events/ws?token={token_a}") as ws_a:
        _ = ws_a.receive_json()
        ws_a.send_json({"action": "replay", "last_sequence_id": 0})
        for _ in range(len(multi_tenant_setup["events_a"])):
            msg = ws_a.receive_json()
            assert msg["event"]["organization_id"] == "org_alpha_security"
            assert msg["event"]["organization_id"] != "org_beta_security"

    # Replay sequence 0 for Org B
    with client.websocket_connect(f"/api/v1/events/ws?token={token_b}") as ws_b:
        _ = ws_b.receive_json()
        ws_b.send_json({"action": "replay", "last_sequence_id": 0})
        for _ in range(len(multi_tenant_setup["events_b"])):
            msg = ws_b.receive_json()
            assert msg["event"]["organization_id"] == "org_beta_security"
            assert msg["event"]["organization_id"] != "org_alpha_security"


def test_05_missing_tenant_identity_fails_closed(client, db_session, multi_tenant_setup, monkeypatch):
    """Scenario 5: Missing tenant identity fails closed at connection handshake and at replay dispatch."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    # 1. Connection without active organization memberships fails closed
    token_no_org = multi_tenant_setup["token_no_org"]
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(f"/api/v1/events/ws?token={token_no_org}"):
            pass
    assert excinfo.value.code == 1008  # Policy violation

    # 2. Replay dispatch fails closed if connection lacks organization identity in metadata
    from unittest.mock import AsyncMock
    fake_ws = AsyncMock()
    ws_manager.active_connections.add(fake_ws)
    # Intentionally do not set connection_metadata (or set with empty organization_id)
    ws_manager.connection_metadata[fake_ws] = {"user_id": "anon", "organization_id": None, "is_superadmin": False}

    import asyncio
    asyncio.run(ws_manager.handle_incoming_message(fake_ws, json.dumps({"action": "replay", "last_sequence_id": 0})))

    # Verify error frame sent and zero events replayed
    fake_ws.send_text.assert_called_once()
    sent_text = fake_ws.send_text.call_args[0][0]
    error_frame = json.loads(sent_text)
    assert error_frame["message_type"] == "error"
    assert error_frame["code"] == "FORBIDDEN"

    ws_manager.disconnect(fake_ws)


def test_06_invalid_tenant_identity_fails_closed(client, db_session, multi_tenant_setup, monkeypatch):
    """Scenario 6: Invalid or unauthorized tenant identity parameter fails closed."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    token_a = multi_tenant_setup["token_a"]

    # User A attempting to access Org B explicitly via query param
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(f"/api/v1/events/ws?token={token_a}&organization_id=org_beta_security"):
            pass
    assert excinfo.value.code == 1008

    # Completely invalid/nonexistent organization_id
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(f"/api/v1/events/ws?token={token_a}&organization_id=org_non_existent"):
            pass
    assert excinfo.value.code == 1008


def test_07_events_without_organization_ownership_follow_policy(client, db_session, multi_tenant_setup, monkeypatch):
    """
    Scenario 7: Events without organization ownership (organization_id is None)
    are NEVER replayed to normal tenant connections, but accessible to superadmin.
    """
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    token_a = multi_tenant_setup["token_a"]
    token_super = multi_tenant_setup["token_super"]
    ev_sys = multi_tenant_setup["event_sys"]

    # Org A replay must NOT contain system event
    with client.websocket_connect(f"/api/v1/events/ws?token={token_a}") as ws:
        _ = ws.receive_json()
        ws.send_json({"action": "replay", "last_sequence_id": 0})
        for _ in range(len(multi_tenant_setup["events_a"])):
            msg = ws.receive_json()
            assert msg["event"]["event_id"] != ev_sys.id
            assert msg["event"]["event_type"] != "system.internal.heartbeat"

    # Superadmin can query system-level events without tenant scoping
    from backend.app.services.event_service import get_events_after
    super_events = get_events_after(db=db_session, last_sequence_id=0, organization_id=None, limit=100, is_superadmin=True)
    super_event_ids = [e.id for e in super_events]
    assert ev_sys.id in super_event_ids


def test_08_replay_pagination_and_event_ordering(client, db_session, multi_tenant_setup, monkeypatch):
    """Scenario 8: Replay ordering remains monotonically ascending by sequence_id and respects limit."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    token_a = multi_tenant_setup["token_a"]
    org_a = multi_tenant_setup["org_a"]

    # Create 5 more events for Org A to test ordering
    extra_events = []
    for i in range(5):
        ev = event_service.create_event(
            db=db_session,
            event_type=f"alpha.seq.test.{i}",
            organization_id=org_a.id,
            payload={"index": i},
            commit=True,
        )
        extra_events.append(ev)

    with client.websocket_connect(f"/api/v1/events/ws?token={token_a}") as ws:
        _ = ws.receive_json()
        # Request replay from start of extra events
        start_seq = extra_events[0].sequence_id - 1
        ws.send_json({"action": "replay", "last_sequence_id": start_seq})

        received_seqs = []
        for _ in range(len(extra_events)):
            msg = ws.receive_json()
            received_seqs.append(msg["event"]["sequence_id"])

        # Monotonically strictly ascending
        for i in range(len(received_seqs) - 1):
            assert received_seqs[i] < received_seqs[i + 1]


def test_09_existing_single_tenant_replay_compatibility(client, db_session, multi_tenant_setup, monkeypatch):
    """Scenario 9: Replay event frames preserve full backward-compatible envelope schema."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    token_a = multi_tenant_setup["token_a"]
    ev_a1 = multi_tenant_setup["events_a"][0]

    with client.websocket_connect(f"/api/v1/events/ws?token={token_a}") as ws:
        _ = ws.receive_json()
        ws.send_json({"action": "replay", "last_sequence_id": ev_a1.sequence_id - 1})
        frame = ws.receive_json()

        assert frame["message_type"] == "event"
        assert "event" in frame
        assert frame["type"] == frame["event"]["event_type"]
        assert frame["data"] == frame["event"]["payload"]

        # Standard envelope structure
        env = frame["event"]
        assert env["schema_version"] == 1
        assert "event_id" in env
        assert "occurred_at" in env
        assert "sequence_id" in env
        assert "organization_id" in env
        assert "payload" in env


def test_10_reconnect_and_replay_cannot_bypass_tenant_isolation(client, db_session, multi_tenant_setup, monkeypatch):
    """
    Scenario 10: Disconnect, reconnect, and spoofing attempts in replay payloads
    cannot bypass server-resolved tenant isolation.
    """
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    token_a = multi_tenant_setup["token_a"]
    events_b = multi_tenant_setup["events_b"]

    # Session 1: Client A connects
    with client.websocket_connect(f"/api/v1/events/ws?token={token_a}") as ws1:
        _ = ws1.receive_json()
    # Client A disconnects cleanly

    # Session 2: Client A reconnects and attempts spoofing organization_id in replay frame
    with client.websocket_connect(f"/api/v1/events/ws?token={token_a}") as ws2:
        _ = ws2.receive_json()

        # Attacker injects organization_id="org_beta_security" in replay message
        ws2.send_json({
            "action": "replay",
            "last_sequence_id": 0,
            "organization_id": "org_beta_security",
            "payload": {
                "organization_id": "org_beta_security",
                "last_sequence_id": 0
            }
        })

        replayed = []
        for _ in range(len(multi_tenant_setup["events_a"])):
            msg = ws2.receive_json()
            replayed.append(msg)

        replayed_ids = [m["event"]["event_id"] for m in replayed]
        # Must only contain Org A events; zero Org B events leaked
        for ev_b in events_b:
            assert ev_b.id not in replayed_ids
        for m in replayed:
            assert m["event"]["organization_id"] == "org_alpha_security"
