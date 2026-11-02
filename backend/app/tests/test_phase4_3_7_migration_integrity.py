"""
PROVIPAGENT Phase 4.3.7: Database Migration Integrity & Reliability Test Suite
Validates Alembic migration chain across fresh installations, upgrades,
record preservation, foreign keys, and indexes.
"""
import os
import shutil
import tempfile
import sqlite3
import pytest
from alembic.config import Config
from alembic import command
import sqlalchemy as sa
from sqlalchemy import create_engine, inspect, text


@pytest.fixture
def temp_alembic_env():
    """Sets up an isolated SQLite database environment for testing Alembic migrations."""
    temp_dir = tempfile.mkdtemp(prefix="test_alembic_")
    db_path = os.path.join(temp_dir, "migration_test.db")
    db_url = f"sqlite:///{db_path}"

    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", db_url)

    yield {
        "dir": temp_dir,
        "db_path": db_path,
        "db_url": db_url,
        "cfg": cfg,
    }

    shutil.rmtree(temp_dir, ignore_errors=True)


def test_scenario_a_fresh_installation(temp_alembic_env):
    """Scenario A: Verify complete migration from blank database directly to head."""
    cfg = temp_alembic_env["cfg"]
    db_url = temp_alembic_env["db_url"]

    # Run upgrade to head
    command.upgrade(cfg, "head")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    tables = inspector.get_table_names()

    # Verify all critical corporate OS models exist
    expected_tables = [
        "organizations",
        "organization_members",
        "users",
        "agents",
        "tasks",
        "task_steps",
        "agent_events",
        "approvals",
        "workstation_allocations",
        "meetings",
        "meeting_participants",
        "meeting_messages",
        "meeting_decisions",
        "executions",
        "terminal_lines",
    ]
    for table_name in expected_tables:
        assert table_name in tables, f"Expected table '{table_name}' was not created in fresh installation"

    # Verify columns on executions
    exec_cols = {c["name"]: c for c in inspector.get_columns("executions")}
    assert "prompt_tokens" in exec_cols
    assert "completion_tokens" in exec_cols
    assert "estimated_cost_usd" in exec_cols
    assert "tool_calls_count" in exec_cols

    # Verify columns on terminal_lines
    term_cols = {c["name"]: c for c in inspector.get_columns("terminal_lines")}
    assert "stream" in term_cols
    assert "content" in term_cols
    assert "line_number" in term_cols

    engine.dispose()


def test_scenario_b_c_existing_upgrade_and_records_preserved(temp_alembic_env):
    """
    Scenario B & C: Upgrade from Phase 4.3.5 baseline (d0e1f2a3b4c5) to Phase 4.3.6 (e1f2a3b4c5d6)
    while ensuring existing records remain intact and uncorrupted.
    """
    cfg = temp_alembic_env["cfg"]
    db_url = temp_alembic_env["db_url"]

    # 1. Upgrade to previous milestone head (d0e1f2a3b4c5)
    command.upgrade(cfg, "d0e1f2a3b4c5")

    engine = create_engine(db_url)
    # Seed data into existing tables at revision d0e1f2a3b4c5
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO organizations (id, name, slug, is_active, created_at, updated_at) "
            "VALUES ('org_mig_1', 'Migration Corp', 'mig-corp', 1, '2026-11-03 00:00:00', '2026-11-03 00:00:00')"
        ))
        conn.execute(text(
            "INSERT INTO agents (id, organization_id, name, role, station, status, behavioral_state, created_at, updated_at) "
            "VALUES ('agt_mig_1', 'org_mig_1', 'Agent One', 'Specialist', 'engineering', 'idle', 'IDLE', '2026-11-03 00:00:00', '2026-11-03 00:00:00')"
        ))
        conn.execute(text(
            "INSERT INTO tasks (id, organization_id, assigned_agent_id, title, description, status, priority, created_at, updated_at) "
            "VALUES ('tsk_mig_1', 'org_mig_1', 'agt_mig_1', 'Pre-existing Task', 'Task description', 'queued', 'normal', '2026-11-03 00:00:00', '2026-11-03 00:00:00')"
        ))
    engine.dispose()

    # 2. Upgrade to new revision e1f2a3b4c5d6
    command.upgrade(cfg, "e1f2a3b4c5d6")

    # 3. Verify existing data preserved and new schema active
    engine2 = create_engine(db_url)
    with engine2.connect() as conn:
        res_org = conn.execute(text("SELECT name FROM organizations WHERE id = 'org_mig_1'")).fetchone()
        assert res_org is not None
        assert res_org[0] == "Migration Corp"

        res_agt = conn.execute(text("SELECT name FROM agents WHERE id = 'agt_mig_1'")).fetchone()
        assert res_agt is not None
        assert res_agt[0] == "Agent One"

        res_tsk = conn.execute(text("SELECT title, idempotency_key FROM tasks WHERE id = 'tsk_mig_1'")).fetchone()
        assert res_tsk is not None
        assert res_tsk[0] == "Pre-existing Task"
        assert res_tsk[1] is None  # Newly added column defaults cleanly to NULL

    engine2.dispose()


def test_scenario_d_foreign_key_integrity(temp_alembic_env):
    """Scenario D: Verify Foreign Key enforcement on executions and terminal_lines."""
    cfg = temp_alembic_env["cfg"]
    db_url = temp_alembic_env["db_url"]
    command.upgrade(cfg, "head")

    engine = create_engine(db_url)
    with engine.connect() as conn:
        conn.exec_driver_sql("PRAGMA foreign_keys=ON")

        # Attempting to insert an execution with non-existent organization_id must violate FK
        with pytest.raises(Exception):
            conn.execute(text(
                "INSERT INTO executions (id, organization_id, agent_id, status, started_at, created_at, updated_at) "
                "VALUES ('exec_invalid', 'org_non_existent', 'agt_invalid', 'running', '2026-11-03 00:00:00', '2026-11-03 00:00:00', '2026-11-03 00:00:00')"
            ))

    engine.dispose()


def test_scenario_e_index_integrity(temp_alembic_env):
    """Scenario E: Verify compound and single-column index existence."""
    cfg = temp_alembic_env["cfg"]
    db_url = temp_alembic_env["db_url"]
    command.upgrade(cfg, "head")

    engine = create_engine(db_url)
    inspector = inspect(engine)

    exec_indexes = [idx["name"] for idx in inspector.get_indexes("executions")]
    assert "ix_executions_organization_id" in exec_indexes
    assert "ix_executions_org_started" in exec_indexes

    term_indexes = [idx["name"] for idx in inspector.get_indexes("terminal_lines")]
    assert "ix_terminal_exec_seq" in term_indexes
    assert "ix_terminal_lines_stream" in term_indexes

    event_indexes = [idx["name"] for idx in inspector.get_indexes("agent_events")]
    assert "ix_agent_events_exec_created" in event_indexes

    engine.dispose()


def test_scenario_f_downgrade_and_reupgrade_idempotency(temp_alembic_env):
    """Scenario F: Verify downgrade -1 and subsequent re-upgrade head succeed without corruption."""
    cfg = temp_alembic_env["cfg"]
    db_url = temp_alembic_env["db_url"]

    # 1. Upgrade to head
    command.upgrade(cfg, "head")

    # 2. Downgrade by 1 revision (back to d0e1f2a3b4c5)
    command.downgrade(cfg, "-1")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    assert "executions" not in tables
    assert "terminal_lines" not in tables
    engine.dispose()

    # 3. Re-upgrade to head
    command.upgrade(cfg, "head")

    engine2 = create_engine(db_url)
    inspector2 = inspect(engine2)
    tables2 = inspector2.get_table_names()
    assert "executions" in tables2
    assert "terminal_lines" in tables2
    engine2.dispose()
