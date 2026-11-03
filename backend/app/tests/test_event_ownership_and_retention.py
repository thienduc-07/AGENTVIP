import json
import pytest
import sqlite3
import shutil
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.app.core.database import Base
from backend.app.core.auth import create_jwt_token, hash_password
from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.services.event_service import event_service
from backend.app.websocket_manager import ws_manager
from backend.app.main import app


@pytest.fixture
def isolated_ownership_db():
    """Provides a fresh isolated in-memory database with populated test tenants."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    
    Session = sessionmaker(bind=engine)
    session = Session()

    # Pre-populate test organizations
    org_default = OrganizationModel(id="org_default_company", name="Default Corp", slug="default", is_active=True)
    org_a = OrganizationModel(id="org_alpha_test", name="Alpha Corp", slug="alpha", is_active=True)
    org_b = OrganizationModel(id="org_beta_test", name="Beta Corp", slug="beta", is_active=True)
    session.add_all([org_default, org_a, org_b])

    # Pre-populate agents
    agent_a = AgentModel(
        id="agent_alpha_spec",
        name="Agent Alpha",
        role="Engineer",
        station="eng_dock",
        organization_id="org_alpha_test"
    )
    agent_b = AgentModel(
        id="agent_beta_spec",
        name="Agent Beta",
        role="Auditor",
        station="audit_dock",
        organization_id="org_beta_test"
    )
    session.add_all([agent_a, agent_b])

    # Pre-populate tasks
    task_a = TaskModel(
        id="task_alpha_core",
        title="Alpha Mission",
        description="Alpha operation description",
        assigned_agent_id="agent_alpha_spec",
        organization_id="org_alpha_test",
        status="queued"
    )
    task_b = TaskModel(
        id="task_beta_core",
        title="Beta Mission",
        description="Beta operation description",
        assigned_agent_id="agent_beta_spec",
        organization_id="org_beta_test",
        status="queued"
    )
    session.add_all([task_a, task_b])
    session.commit()

    yield session
    session.close()


# ==============================================================================
# SECTION IV: REGRESSION TESTS (17 EXPLICIT SCENARIOS)
# ==============================================================================

def test_01_cross_tenant_task_ownership_conflict_rejected(isolated_ownership_db):
    """Scenario 1: Cross-tenant task ownership conflict (Task A + explicit Org B) is rejected."""
    initial_count = isolated_ownership_db.query(AgentEventModel).count()
    with pytest.raises(ValueError, match="Ownership conflict"):
        event_service.create_event(
            db=isolated_ownership_db,
            event_type="test.conflict",
            task_id="task_alpha_core",
            organization_id="org_beta_test",
            commit=True,
        )
    assert isolated_ownership_db.query(AgentEventModel).count() == initial_count


def test_02_cross_tenant_agent_ownership_conflict_rejected(isolated_ownership_db):
    """Scenario 2: Cross-tenant agent ownership conflict (Agent A + explicit Org B) is rejected."""
    initial_count = isolated_ownership_db.query(AgentEventModel).count()
    with pytest.raises(ValueError, match="Ownership conflict"):
        event_service.create_event(
            db=isolated_ownership_db,
            event_type="test.conflict",
            agent_id="agent_alpha_spec",
            organization_id="org_beta_test",
            commit=True,
        )
    assert isolated_ownership_db.query(AgentEventModel).count() == initial_count


def test_03_task_agent_ownership_conflict_rejected(isolated_ownership_db):
    """Scenario 3: Task A (Org A) + Agent B (Org B) is rejected due to cross-tenant conflict."""
    initial_count = isolated_ownership_db.query(AgentEventModel).count()
    with pytest.raises(ValueError, match="Ownership conflict: Task and Agent belong to different organizations"):
        event_service.create_event(
            db=isolated_ownership_db,
            event_type="test.conflict",
            task_id="task_alpha_core",
            agent_id="agent_beta_spec",
            commit=True,
        )
    assert isolated_ownership_db.query(AgentEventModel).count() == initial_count


def test_04_untrusted_payload_organization_id_cannot_establish_ownership(isolated_ownership_db):
    """Scenario 4: Untrusted payload.organization_id cannot independently establish tenant ownership."""
    # Subtest A: Task A + payload Org B -> DB ownership remains strictly Org A
    ev_a = event_service.create_event(
        db=isolated_ownership_db,
        event_type="test.payload_override",
        task_id="task_alpha_core",
        payload={"organization_id": "org_beta_test"},
        commit=True,
    )
    assert ev_a.organization_id == "org_alpha_test"

    # Subtest B: No Task/Agent + payload Org B -> organization_id remains NULL (system event)
    ev_b = event_service.create_event(
        db=isolated_ownership_db,
        event_type="test.payload_unowned",
        task_id=None,
        agent_id=None,
        organization_id=None,
        payload={"organization_id": "org_beta_test"},
        commit=True,
    )
    assert ev_b.organization_id is None


def test_05_nonexistent_task_and_agent_rejected(isolated_ownership_db):
    """Scenario 5: Nonexistent task or agent references are strictly rejected."""
    initial_count = isolated_ownership_db.query(AgentEventModel).count()

    with pytest.raises(ValueError, match="Referenced task 'ghost_task' does not exist"):
        event_service.create_event(
            db=isolated_ownership_db,
            event_type="test.bad_task",
            task_id="ghost_task",
            commit=True,
        )

    with pytest.raises(ValueError, match="Referenced agent 'ghost_agent' does not exist"):
        event_service.create_event(
            db=isolated_ownership_db,
            event_type="test.bad_agent",
            agent_id="ghost_agent",
            commit=True,
        )

    assert isolated_ownership_db.query(AgentEventModel).count() == initial_count


def test_06_existing_task_or_agent_with_null_organization(isolated_ownership_db):
    """Scenario 6: Existing task or agent with NULL organization does not default to arbitrary tenant."""
    # Subtest A: Recognized system agent has NULL organization_id -> event remains unowned / NULL
    ev_sys = event_service.create_event(
        db=isolated_ownership_db,
        event_type="test.system_agent",
        agent_id="system",
        commit=True,
    )
    assert ev_sys.organization_id is None, "System agent event must not be defaulted to an organization"

    # Subtest B: Existing task record with NULL organization (e.g. legacy/unassigned task)
    from unittest.mock import MagicMock
    mock_task = MagicMock()
    mock_task.id = "task_alpha_core"
    mock_task.organization_id = None

    original_query = isolated_ownership_db.query
    def fake_query(model, *args, **kwargs):
        if model is TaskModel:
            mock_q = MagicMock()
            mock_q.filter.return_value.first.return_value = mock_task
            return mock_q
        return original_query(model, *args, **kwargs)

    isolated_ownership_db.query = fake_query
    try:
        ev_task = event_service.create_event(
            db=isolated_ownership_db,
            event_type="test.null_task_org",
            task_id="task_alpha_core",
            commit=True,
        )
        assert ev_task.organization_id is None, "Task with NULL organization must not default to arbitrary tenant"
    finally:
        isolated_ownership_db.query = original_query


def test_07_valid_trusted_organization_context_succeeds(isolated_ownership_db):
    """Scenario 7: Valid trusted organization context matching resources succeeds."""
    ev = event_service.create_event(
        db=isolated_ownership_db,
        event_type="test.valid_context",
        task_id="task_alpha_core",
        agent_id="agent_alpha_spec",
        organization_id="org_alpha_test",
        commit=True,
    )
    assert ev.id.startswith("evt_")
    assert ev.organization_id == "org_alpha_test"
    assert ev.task_id == "task_alpha_core"
    assert ev.agent_id == "agent_alpha_spec"


def test_08_invalid_organization_id_rejected_and_persists_zero_rows(isolated_ownership_db):
    """Scenario 8: Invalid organization ID is rejected and persists zero event rows."""
    initial_count = isolated_ownership_db.query(AgentEventModel).count()
    with pytest.raises(ValueError, match="Invalid organization"):
        event_service.create_event(
            db=isolated_ownership_db,
            event_type="test.invalid_org",
            organization_id="org_unregistered_ghost",
            commit=True,
        )
    assert isolated_ownership_db.query(AgentEventModel).count() == initial_count


def test_09_organization_deletion_preserving_audit_history():
    """Scenario 9: Organization deletion fails with RESTRICT constraint, preserving historical audit events."""
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as con:
        con.exec_driver_sql("PRAGMA foreign_keys = ON;")
        Base.metadata.create_all(bind=con)

    Session = sessionmaker(bind=engine)
    session = Session()

    org = OrganizationModel(id="org_retention_target", name="Audit Retention Org", slug="audit-ret", is_active=True)
    session.add(org)
    session.commit()

    ev = AgentEventModel(
        id="evt_audit_retained_1",
        sequence_id=1,
        event_type="compliance.audit",
        organization_id=org.id,
        payload_json={"retention": "mandatory"}
    )
    session.add(ev)
    session.commit()

    # Attempting hard deletion of organization must be blocked by RESTRICT constraint
    with pytest.raises(IntegrityError):
        session.delete(org)
        session.commit()

    session.rollback()

    # Verify event remains completely intact
    assert session.query(AgentEventModel).filter_by(id="evt_audit_retained_1").first() is not None

    # Deactivating (soft deletion) preserves events
    org = session.query(OrganizationModel).filter_by(id="org_retention_target").first()
    org.is_active = False
    session.commit()

    ev_after = session.query(AgentEventModel).filter_by(id="evt_audit_retained_1").first()
    assert ev_after is not None
    assert ev_after.organization_id == "org_retention_target"
    session.close()


def test_10_invalid_migration_backfill_references_quarantined():
    """Scenario 10: Migration backfill quarantines conflicting or invalid references to NULL."""
    conn = sqlite3.connect(":memory:")
    c = conn.cursor()
    c.execute("CREATE TABLE organizations (id TEXT PRIMARY KEY);")
    c.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, organization_id TEXT);")
    c.execute("CREATE TABLE agents (id TEXT PRIMARY KEY, organization_id TEXT);")
    c.execute("CREATE TABLE agent_events (id TEXT PRIMARY KEY, task_id TEXT, agent_id TEXT, organization_id TEXT);")
    c.execute("INSERT INTO organizations VALUES ('org_legit');")
    c.execute("INSERT INTO tasks VALUES ('t_1', 'org_legit');")
    c.execute("INSERT INTO agents VALUES ('a_1', 'org_other');")
    c.execute("INSERT INTO agent_events VALUES ('ev_conflict', 't_1', 'a_1', 'org_legit');")
    c.execute("INSERT INTO agent_events VALUES ('ev_bad_fk', NULL, NULL, 'org_non_existent');")
    conn.commit()

    # Run migration hardening updates
    c.execute("""
        UPDATE agent_events
        SET organization_id = NULL
        WHERE id IN (
            SELECT ae.id FROM agent_events ae
            JOIN tasks t ON ae.task_id = t.id
            JOIN agents a ON ae.agent_id = a.id
            WHERE t.organization_id != a.organization_id
        );
    """)
    c.execute("""
        UPDATE agent_events
        SET organization_id = NULL
        WHERE organization_id IS NOT NULL
          AND organization_id NOT IN (SELECT id FROM organizations);
    """)
    conn.commit()

    assert c.execute("SELECT organization_id FROM agent_events WHERE id = 'ev_conflict';").fetchone()[0] is None
    assert c.execute("SELECT organization_id FROM agent_events WHERE id = 'ev_bad_fk';").fetchone()[0] is None
    conn.close()


def test_11_superadmin_frame_spoofing_prevented(client, db_session, monkeypatch):
    """Scenario 11: Normal tenant cannot gain superadmin visibility via frame claim."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    org_a = OrganizationModel(id="org_spoof_victim", name="Victim Org", slug="vic", is_active=True)
    org_b = OrganizationModel(id="org_spoof_attacker", name="Attacker Org", slug="att", is_active=True)
    user_b = UserModel(id="user_attacker_1", email="att@att.com", full_name="Attacker", hashed_password=hash_password("Pass1!"), is_active=True, is_superadmin=False)
    member_b = OrganizationMemberModel(user_id=user_b.id, organization_id=org_b.id, role="ADMIN")
    db_session.add_all([org_a, org_b, user_b, member_b])
    db_session.commit()

    # Create event for Org A (confidential)
    ev_a = event_service.create_event(db=db_session, event_type="confidential.a", organization_id=org_a.id, commit=True)
    # Create event for Org B
    ev_b = event_service.create_event(db=db_session, event_type="normal.b", organization_id=org_b.id, commit=True)

    token_b = create_jwt_token({"sub": user_b.id, "email": user_b.email, "org_id": org_b.id, "ver": 1})

    with client.websocket_connect(f"/api/v1/events/ws?token={token_b}") as ws:
        _ = ws.receive_json()  # Snapshot

        # Attacker attempts superadmin claim in replay
        ws.send_json({
            "action": "replay",
            "last_sequence_id": 0,
            "is_superadmin": True,
            "payload": {"is_superadmin": True}
        })

        frame = ws.receive_json()
        assert frame["event"]["event_id"] == ev_b.id
        assert frame["event"]["organization_id"] == org_b.id
        assert frame["event"]["event_id"] != ev_a.id


def test_12_superadmin_replay_snapshot_broadcast_consistency(client, db_session, monkeypatch):
    """Scenario 12: Superadmin has consistent global access across snapshot, replay, and broadcast."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    super_user = UserModel(
        id="user_super_consistency",
        email="super_cons@provipagent.internal",
        full_name="Super Cons",
        hashed_password=hash_password("SuperPass123!"),
        is_active=True,
        is_superadmin=True,
    )
    db_session.add(super_user)
    db_session.commit()

    ev_super = event_service.create_event(
        db=db_session,
        event_type="test.super_event",
        payload={"note": "superadmin test"},
        commit=True,
    )

    token_super = create_jwt_token({"sub": super_user.id, "email": super_user.email, "ver": 1})

    # Unscoped superadmin connection receives global snapshot and replay
    with client.websocket_connect(f"/api/v1/events/ws?token={token_super}") as ws:
        snapshot = ws.receive_json()
        assert snapshot["message_type"] == "snapshot"

        ws.send_json({"action": "replay", "last_sequence_id": ev_super.sequence_id - 1})
        frame = ws.receive_json()
        assert frame["message_type"] == "event"
        assert frame["event"]["event_id"] == ev_super.id


def test_13_missing_tenant_connection_metadata_fails_closed():
    """Scenario 13: Connections lacking connection_metadata fail closed immediately without event leaks."""
    from unittest.mock import AsyncMock
    import asyncio

    fake_ws = AsyncMock()
    ws_manager.active_connections.add(fake_ws)
    ws_manager.connection_metadata.pop(fake_ws, None)

    # 1. Replay fails closed
    asyncio.run(ws_manager.handle_incoming_message(fake_ws, json.dumps({"action": "replay", "last_sequence_id": 0})))
    fake_ws.send_text.assert_called_once()
    frame = json.loads(fake_ws.send_text.call_args[0][0])
    assert frame["code"] == "FORBIDDEN"

    # 2. Broadcast skips connection lacking metadata
    fake_ws.reset_mock()
    asyncio.run(ws_manager.broadcast_envelope({"event_id": "test", "organization_id": "org_default_company"}))
    fake_ws.send_text.assert_not_called()

    ws_manager.disconnect(fake_ws)


def test_14_cross_tenant_replay_isolation(client, db_session, monkeypatch):
    """Scenario 14: Organization A cannot replay Organization B events."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    org_a = OrganizationModel(id="org_iso_a", name="A", slug="a", is_active=True)
    org_b = OrganizationModel(id="org_iso_b", name="B", slug="b", is_active=True)
    user_a = UserModel(id="user_iso_a", email="a@iso.com", full_name="A", hashed_password=hash_password("P!"), is_active=True, is_superadmin=False)
    member_a = OrganizationMemberModel(user_id=user_a.id, organization_id=org_a.id, role="ADMIN")
    db_session.add_all([org_a, org_b, user_a, member_a])
    db_session.commit()

    ev_a = event_service.create_event(db=db_session, event_type="ev.a", organization_id=org_a.id, commit=True)
    ev_b = event_service.create_event(db=db_session, event_type="ev.b", organization_id=org_b.id, commit=True)

    token_a = create_jwt_token({"sub": user_a.id, "email": user_a.email, "org_id": org_a.id, "ver": 1})

    with client.websocket_connect(f"/api/v1/events/ws?token={token_a}") as ws:
        _ = ws.receive_json()
        ws.send_json({"action": "replay", "last_sequence_id": 0})
        frame = ws.receive_json()
        assert frame["event"]["event_id"] == ev_a.id
        assert frame["event"]["event_id"] != ev_b.id


def test_15_cross_tenant_broadcast_isolation():
    """Scenario 15: Cross-tenant broadcast isolation enforces conn_org == effective_org."""
    from unittest.mock import AsyncMock
    import asyncio

    ws_a = AsyncMock()
    ws_b = AsyncMock()
    ws_manager.active_connections.add(ws_a)
    ws_manager.active_connections.add(ws_b)
    ws_manager.connection_metadata[ws_a] = {"organization_id": "org_broadcast_a", "is_superadmin": False}
    ws_manager.connection_metadata[ws_b] = {"organization_id": "org_broadcast_b", "is_superadmin": False}

    try:
        # Broadcast Org A event
        asyncio.run(ws_manager.broadcast_envelope({
            "event_id": "evt_broadcast_a",
            "event_type": "task.created",
            "organization_id": "org_broadcast_a",
            "payload": {}
        }))

        ws_a.send_text.assert_called_once()
        ws_b.send_text.assert_not_called()
    finally:
        ws_manager.disconnect(ws_a)
        ws_manager.disconnect(ws_b)


def test_16_reconnection_and_replay_pagination(client, db_session, monkeypatch):
    """Scenario 16: Disconnect, reconnect, and replay preserves monotonic sequence order."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    org = OrganizationModel(id="org_recon_test", name="Recon Org", slug="recon", is_active=True)
    user = UserModel(id="user_recon_test", email="recon@test.com", full_name="Recon", hashed_password=hash_password("P!"), is_active=True, is_superadmin=False)
    member = OrganizationMemberModel(user_id=user.id, organization_id=org.id, role="ADMIN")
    db_session.add_all([org, user, member])
    db_session.commit()

    ev1 = event_service.create_event(db=db_session, event_type="recon.1", organization_id=org.id, commit=True)
    ev2 = event_service.create_event(db=db_session, event_type="recon.2", organization_id=org.id, commit=True)

    token = create_jwt_token({"sub": user.id, "email": user.email, "org_id": org.id, "ver": 1})

    # Session 1: Client connects and disconnects
    with client.websocket_connect(f"/api/v1/events/ws?token={token}") as ws:
        _ = ws.receive_json()

    # Session 2: Client reconnects and requests replay
    with client.websocket_connect(f"/api/v1/events/ws?token={token}") as ws:
        _ = ws.receive_json()
        ws.send_json({"action": "replay", "last_sequence_id": ev1.sequence_id})
        frame = ws.receive_json()
        assert frame["event"]["event_id"] == ev2.id
        assert frame["event"]["sequence_id"] > ev1.sequence_id


def test_17_null_system_event_quarantine(client, db_session, monkeypatch):
    """Scenario 17: Events with NULL organization are quarantined from normal tenant replay and broadcast."""
    from unittest.mock import AsyncMock
    import asyncio

    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    org = OrganizationModel(id="org_quarantine_test", name="Quar Org", slug="quar", is_active=True)
    user = UserModel(id="user_quar_test", email="quar@test.com", full_name="Quar", hashed_password=hash_password("P!"), is_active=True, is_superadmin=False)
    member = OrganizationMemberModel(user_id=user.id, organization_id=org.id, role="ADMIN")
    db_session.add_all([org, user, member])
    db_session.commit()

    ev_tenant = event_service.create_event(db=db_session, event_type="tenant.event", organization_id=org.id, commit=True)
    ev_sys = event_service.create_event(db=db_session, event_type="system.heartbeat", organization_id=None, commit=True)

    token = create_jwt_token({"sub": user.id, "email": user.email, "org_id": org.id, "ver": 1})

    # 1. Replay test: tenant receives own event, never system event
    with client.websocket_connect(f"/api/v1/events/ws?token={token}") as ws:
        _ = ws.receive_json()
        ws.send_json({"action": "replay", "last_sequence_id": 0})
        frame = ws.receive_json()
        assert frame["event"]["event_id"] == ev_tenant.id
        assert frame["event"]["event_id"] != ev_sys.id

    # 2. Broadcast test: system event broadcast is not sent to tenant socket
    ws_mock = AsyncMock()
    ws_manager.active_connections.add(ws_mock)
    ws_manager.connection_metadata[ws_mock] = {"organization_id": org.id, "is_superadmin": False}
    try:
        asyncio.run(ws_manager.broadcast_envelope({
            "event_id": ev_sys.id,
            "event_type": "system.heartbeat",
            "organization_id": None,
            "payload": {}
        }))
        ws_mock.send_text.assert_not_called()
    finally:
        ws_manager.disconnect(ws_mock)


def test_18_crash_recovery_event_ownership_integrity(isolated_ownership_db):
    """Scenario 18: Crash recovery correctly establishes event tenant ownership via event_service."""
    from backend.app.agent_runtime.dispatcher.crash_recovery import recover_abandoned_tasks

    # Set task_alpha_core to 'running' to trigger crash recovery
    task = isolated_ownership_db.query(TaskModel).filter(TaskModel.id == "task_alpha_core").first()
    task.status = "running"
    isolated_ownership_db.commit()

    recovered = recover_abandoned_tasks(isolated_ownership_db)
    assert recovered == 1

    event = (
        isolated_ownership_db.query(AgentEventModel)
        .filter(AgentEventModel.task_id == "task_alpha_core", AgentEventModel.event_type == "task.interrupted")
        .first()
    )
    assert event is not None
    assert event.organization_id == "org_alpha_test"
    assert event.sequence_id is not None
    assert event.agent_id == "agent_alpha_spec"


def test_19_superadmin_replay_tenant_events(client, db_session, monkeypatch):
    """Scenario 19: Superadmin scoped to a tenant successfully replays that tenant's events."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    org = OrganizationModel(id="org_super_tenant_test", name="Super Target Org", slug="super-target", is_active=True)
    super_u = UserModel(
        id="usr_super_tenant",
        email="super_scoped@provipagent.internal",
        full_name="Super Scoped",
        hashed_password=hash_password("SuperSecret123!"),
        is_active=True,
        is_superadmin=True,
    )
    db_session.add_all([org, super_u])
    db_session.commit()

    ev_target = event_service.create_event(db=db_session, event_type="target.event", organization_id=org.id, commit=True)
    token_super = create_jwt_token({"sub": super_u.id, "email": super_u.email, "ver": 1})

    # Connect scoped to target org
    with client.websocket_connect(f"/api/v1/events/ws?token={token_super}&organization_id={org.id}") as ws:
        _ = ws.receive_json()
        ws.send_json({"action": "replay", "last_sequence_id": ev_target.sequence_id - 1})
        frame = ws.receive_json()
        assert frame["message_type"] == "event"
        assert frame["event"]["event_id"] == ev_target.id
        assert frame["event"]["organization_id"] == org.id


def test_20_superadmin_replay_global_events(client, db_session, monkeypatch):
    """Scenario 20: Unscoped Superadmin receives global system events (organization_id is None)."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    super_u = UserModel(
        id="usr_super_global",
        email="super_glob@provipagent.internal",
        full_name="Super Global",
        hashed_password=hash_password("SuperSecret123!"),
        is_active=True,
        is_superadmin=True,
    )
    db_session.add(super_u)
    db_session.commit()

    ev_global = event_service.create_event(db=db_session, event_type="global.announcement", organization_id=None, commit=True)
    token_super = create_jwt_token({"sub": super_u.id, "email": super_u.email, "ver": 1})

    # Connect unscoped
    with client.websocket_connect(f"/api/v1/events/ws?token={token_super}") as ws:
        _ = ws.receive_json()
        ws.send_json({"action": "replay", "last_sequence_id": ev_global.sequence_id - 1})
        frame = ws.receive_json()
        assert frame["message_type"] == "event"
        assert frame["event"]["event_id"] == ev_global.id
        assert frame["event"]["organization_id"] is None


def test_21_regular_user_cross_tenant_replay_denial(client, db_session, monkeypatch):
    """Scenario 21: Regular tenant user is strictly denied other tenant and global events during replay."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    org_a = OrganizationModel(id="org_denial_a", name="Org A", slug="denial-a", is_active=True)
    org_b = OrganizationModel(id="org_denial_b", name="Org B", slug="denial-b", is_active=True)
    user_a = UserModel(id="usr_denial_a", email="denial_a@test.com", full_name="User A", hashed_password=hash_password("P!"), is_active=True, is_superadmin=False)
    member_a = OrganizationMemberModel(user_id=user_a.id, organization_id=org_a.id, role="MEMBER")
    db_session.add_all([org_a, org_b, user_a, member_a])
    db_session.commit()

    ev_a = event_service.create_event(db=db_session, event_type="denial.a", organization_id=org_a.id, commit=True)
    ev_b = event_service.create_event(db=db_session, event_type="denial.b", organization_id=org_b.id, commit=True)
    ev_sys = event_service.create_event(db=db_session, event_type="denial.sys", organization_id=None, commit=True)

    token_a = create_jwt_token({"sub": user_a.id, "email": user_a.email, "org_id": org_a.id, "ver": 1})

    with client.websocket_connect(f"/api/v1/events/ws?token={token_a}") as ws:
        _ = ws.receive_json()
        ws.send_json({"action": "replay", "last_sequence_id": 0})
        frame = ws.receive_json()
        # Must only receive org A event
        assert frame["event"]["event_id"] == ev_a.id
        assert frame["event"]["event_id"] != ev_b.id
        assert frame["event"]["event_id"] != ev_sys.id


def test_22_missing_organization_id_connection_behavior(client, db_session, monkeypatch):
    """Scenario 22: User lacking active organization memberships fails closed on connection."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    user_orphan = UserModel(
        id="usr_orphan_test",
        email="orphan@test.com",
        full_name="Orphan",
        hashed_password=hash_password("P!"),
        is_active=True,
        is_superadmin=False,
    )
    db_session.add(user_orphan)
    db_session.commit()

    token_orphan = create_jwt_token({"sub": user_orphan.id, "email": user_orphan.email, "ver": 1})

    # Must be rejected because user has no organizations and is not superadmin
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/v1/events/ws?token={token_orphan}"):
            pass


def test_23_empty_replay_response_behavior(client, db_session, monkeypatch):
    """Scenario 23: Replay with no missed events returns replay_empty response promptly."""
    monkeypatch.setattr("backend.app.websocket_manager.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    org = OrganizationModel(id="org_empty_replay", name="Empty Replay", slug="empty-rep", is_active=True)
    user = UserModel(id="usr_empty_rep", email="empty@test.com", full_name="Empty User", hashed_password=hash_password("P!"), is_active=True, is_superadmin=False)
    member = OrganizationMemberModel(user_id=user.id, organization_id=org.id, role="MEMBER")
    db_session.add_all([org, user, member])
    db_session.commit()

    ev = event_service.create_event(db=db_session, event_type="single.ev", organization_id=org.id, commit=True)
    token = create_jwt_token({"sub": user.id, "email": user.email, "org_id": org.id, "ver": 1})

    with client.websocket_connect(f"/api/v1/events/ws?token={token}") as ws:
        _ = ws.receive_json()
        # Request replay with sequence equal to or greater than ev.sequence_id
        ws.send_json({"action": "replay", "last_sequence_id": ev.sequence_id})
        frame = ws.receive_json()
        assert frame["message_type"] == "replay_empty"
        assert frame["replayed_count"] == 0
        assert frame["last_sequence_id"] == ev.sequence_id
