"""
PROVIPAGENT Phase 4.3.7.1: Database Migration & Data Preservation Verification Suite
Guarantees schema evolution safety, downgrade/re-upgrade idempotency, FK integrity,
and data preservation on isolated disposable copies. Zero touches to production agency.db.
"""
import os
import hashlib
import shutil
import sqlite3
import pytest
from pathlib import Path
from alembic.config import Config
from alembic import command
from alembic.script import ScriptDirectory

AGENCY_DB_PATH = Path("agency.db").resolve()
EXPECTED_AGENCY_DB_SHA256 = "f4d4920bc2104eeffdfa80becfadfe4f2f55a244d465fcd4e2f79eac494cdfad"
HEAD_REVISION = "e1f2a3b4c5d6"
PREV_REVISION = "d0e1f2a3b4c5"


def get_file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


@pytest.fixture(autouse=True)
def verify_agency_db_untouched():
    """Safety guard: asserts agency.db exists and is never modified by migration tests."""
    assert AGENCY_DB_PATH.exists(), f"agency.db not found at {AGENCY_DB_PATH}"
    initial_hash = get_file_sha256(AGENCY_DB_PATH)
    yield
    final_hash = get_file_sha256(AGENCY_DB_PATH)
    assert final_hash == initial_hash, (
        f"CRITICAL SAFETY VIOLATION: agency.db was modified during test execution! Initial: {initial_hash}, Final: {final_hash}"
    )


@pytest.fixture
def disposable_db(tmp_path: Path):
    """Creates a temporary, disposable replica of agency.db for destructive/mutation tests."""
    tmp_db = tmp_path / "disposable_agency.db"
    shutil.copy2(AGENCY_DB_PATH, tmp_db)
    yield tmp_db
    if tmp_db.exists():
        tmp_db.unlink()


def get_alembic_config_for_db(db_path: Path) -> Config:
    alembic_ini_path = Path("alembic.ini").resolve()
    cfg = Config(str(alembic_ini_path))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return cfg


def test_01_agency_db_checksum_and_baseline_integrity():
    """Scenario 1: Baseline agency.db has clean PRAGMA integrity and correct HEAD revision."""
    assert AGENCY_DB_PATH.exists()
    conn = sqlite3.connect(AGENCY_DB_PATH)
    cursor = conn.cursor()
    cursor.execute("PRAGMA integrity_check")
    assert cursor.fetchone() == ("ok",), "agency.db failed SQLite PRAGMA integrity_check"
    cursor.execute("SELECT version_num FROM alembic_version")
    row = cursor.fetchone()
    assert row is not None and row[0] == HEAD_REVISION, f"Expected revision {HEAD_REVISION}, got {row}"
    conn.close()


def test_02_migration_ancestry_graph_and_single_head():
    """Scenario 2: Migration scripts form a strict linear DAG with exactly one head and zero branches."""
    cfg = get_alembic_config_for_db(AGENCY_DB_PATH)
    script_dir = ScriptDirectory.from_config(cfg)
    heads = script_dir.get_heads()

    assert len(heads) == 1, f"Multiple heads detected in Alembic graph: {heads}"
    assert heads[0] == HEAD_REVISION, f"Expected head {HEAD_REVISION}, got {heads[0]}"

    head_rev = script_dir.get_revision(HEAD_REVISION)
    assert head_rev is not None
    assert head_rev.down_revision == PREV_REVISION, f"Head down_revision should be {PREV_REVISION}, got {head_rev.down_revision}"

    # Trace complete chain to base
    curr = head_rev
    visited = []
    while curr is not None:
        visited.append(curr.revision)
        if curr.down_revision is None:
            break
        curr = script_dir.get_revision(curr.down_revision)

    assert "8eefbf89f222" in visited, "Initial schema revision 8eefbf89f222 missing from ancestry chain"
    assert len(visited) == 15, f"Expected 15 migrations in chain, found {len(visited)}"


def test_03_downgrade_and_reupgrade_cycle_on_disposable_copy(disposable_db: Path):
    """Scenario 3: Downgrading to d0e1f2a3b4c5 and re-upgrading to e1f2a3b4c5d6 succeeds idempotently."""
    cfg = get_alembic_config_for_db(disposable_db)

    # 1. Verify current revision on copy
    conn = sqlite3.connect(disposable_db)
    cursor = conn.cursor()
    cursor.execute("SELECT version_num FROM alembic_version")
    row = cursor.fetchone()
    assert row is not None and row[0] == HEAD_REVISION
    conn.close()

    # 2. Downgrade to PREV_REVISION
    command.downgrade(cfg, PREV_REVISION)

    conn = sqlite3.connect(disposable_db)
    cursor = conn.cursor()
    cursor.execute("SELECT version_num FROM alembic_version")
    assert cursor.fetchone()[0] == PREV_REVISION

    # Verify dropped tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cursor.fetchall()]
    assert "executions" not in tables, "executions table was not dropped during downgrade"
    assert "terminal_lines" not in tables, "terminal_lines table was not dropped during downgrade"

    # Verify dropped columns
    cursor.execute("PRAGMA table_info(tasks)")
    task_cols = [r[1] for r in cursor.fetchall()]
    assert "idempotency_key" not in task_cols
    assert "lease_token" not in task_cols

    cursor.execute("PRAGMA table_info(agent_events)")
    event_cols = [r[1] for r in cursor.fetchall()]
    assert "execution_id" not in event_cols

    cursor.execute("PRAGMA table_info(approvals)")
    approval_cols = [r[1] for r in cursor.fetchall()]
    assert "resolved_by_user_id" not in approval_cols
    conn.close()

    # 3. Re-upgrade to HEAD_REVISION
    command.upgrade(cfg, HEAD_REVISION)

    conn = sqlite3.connect(disposable_db)
    cursor = conn.cursor()
    cursor.execute("SELECT version_num FROM alembic_version")
    assert cursor.fetchone()[0] == HEAD_REVISION

    # Verify recreated tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables_after = [r[0] for r in cursor.fetchall()]
    assert "executions" in tables_after
    assert "terminal_lines" in tables_after

    # Verify restored columns
    cursor.execute("PRAGMA table_info(tasks)")
    task_cols_after = [r[1] for r in cursor.fetchall()]
    assert "idempotency_key" in task_cols_after
    assert "lease_token" in task_cols_after

    cursor.execute("PRAGMA table_info(agent_events)")
    event_cols_after = [r[1] for r in cursor.fetchall()]
    assert "execution_id" in event_cols_after

    cursor.execute("PRAGMA table_info(approvals)")
    approval_cols_after = [r[1] for r in cursor.fetchall()]
    assert "resolved_by_user_id" in approval_cols_after
    conn.close()


def test_04_schema_integrity_and_foreign_keys_after_migration(disposable_db: Path):
    """Scenario 4: PRAGMA integrity_check and PRAGMA foreign_key_check pass cleanly."""
    conn = sqlite3.connect(disposable_db)
    conn.execute("PRAGMA foreign_keys = ON")
    cursor = conn.cursor()

    # Integrity check
    cursor.execute("PRAGMA integrity_check")
    integrity_rows = cursor.fetchall()
    assert integrity_rows == [("ok",)], f"Integrity check failed: {integrity_rows}"

    # Foreign key check
    cursor.execute("PRAGMA foreign_key_check")
    fk_violations = cursor.fetchall()
    assert fk_violations == [], f"Foreign key check found violations: {fk_violations}"
    conn.close()


def test_05_cascading_deletes_and_set_null_enforcement(disposable_db: Path):
    """Scenario 5: Foreign key cascade and set null behaviors are strictly enforced on execution tables."""
    conn = sqlite3.connect(disposable_db)
    conn.execute("PRAGMA foreign_keys = ON")
    cursor = conn.cursor()

    # Seed isolated tenant, agent, task, execution, terminal_line
    test_org_id = "org_mig_test"
    test_agent_id = "agt_mig_test"
    test_task_id = "tsk_mig_test"
    test_exec_id = "exec_mig_test"
    test_line_id = "line_mig_test"

    cursor.execute(
        "INSERT INTO organizations (id, name, slug, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))",
        (test_org_id, "Migration Test Org", "mig-test"),
    )
    cursor.execute(
        "INSERT INTO agents (id, organization_id, name, role, status, station, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'desk_1', datetime('now'), datetime('now'))",
        (test_agent_id, test_org_id, "Migration Test Agent", "Tester"),
    )
    cursor.execute(
        "INSERT INTO tasks (id, organization_id, title, description, task_type, priority, assigned_agent_id, status, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, 'Migration Description', 'single', 'normal', ?, 'queued', 0, 2, datetime('now'), datetime('now'))",
        (test_task_id, test_org_id, "Migration Task", test_agent_id),
    )
    cursor.execute(
        "INSERT INTO executions (id, organization_id, agent_id, task_id, status, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', datetime('now'), datetime('now'), datetime('now'))",
        (test_exec_id, test_org_id, test_agent_id, test_task_id),
    )
    cursor.execute(
        "INSERT INTO terminal_lines (id, execution_id, organization_id, agent_id, task_id, line_number, stream, content, timestamp) VALUES (?, ?, ?, ?, ?, 1, 'stdout', 'Testing FK', datetime('now'))",
        (test_line_id, test_exec_id, test_org_id, test_agent_id, test_task_id),
    )
    conn.commit()

    # 1. Verify Task deletion sets task_id to NULL on executions & terminal_lines
    cursor.execute("DELETE FROM tasks WHERE id = ?", (test_task_id,))
    conn.commit()

    cursor.execute("SELECT task_id FROM executions WHERE id = ?", (test_exec_id,))
    assert cursor.fetchone()[0] is None, "executions.task_id was not set to NULL after task deletion"

    cursor.execute("SELECT task_id FROM terminal_lines WHERE id = ?", (test_line_id,))
    assert cursor.fetchone()[0] is None, "terminal_lines.task_id was not set to NULL after task deletion"

    # 2. Verify Execution deletion cascades to terminal_lines
    cursor.execute("DELETE FROM executions WHERE id = ?", (test_exec_id,))
    conn.commit()

    cursor.execute("SELECT count(*) FROM terminal_lines WHERE execution_id = ?", (test_exec_id,))
    assert cursor.fetchone()[0] == 0, "terminal_lines were not cascade deleted with execution"

    # 3. Seed another execution and verify Organization deletion cascades to executions and terminal_lines
    test_exec_id2 = "exec_mig_test_2"
    test_line_id2 = "line_mig_test_2"
    cursor.execute(
        "INSERT INTO executions (id, organization_id, agent_id, status, started_at, created_at, updated_at) VALUES (?, ?, ?, 'running', datetime('now'), datetime('now'), datetime('now'))",
        (test_exec_id2, test_org_id, test_agent_id),
    )
    cursor.execute(
        "INSERT INTO terminal_lines (id, execution_id, organization_id, agent_id, line_number, stream, content, timestamp) VALUES (?, ?, ?, ?, 1, 'stdout', 'Testing Org Cascade', datetime('now'))",
        (test_line_id2, test_exec_id2, test_org_id, test_agent_id),
    )
    conn.commit()

    cursor.execute("DELETE FROM organizations WHERE id = ?", (test_org_id,))
    conn.commit()

    cursor.execute("SELECT count(*) FROM executions WHERE organization_id = ?", (test_org_id,))
    assert cursor.fetchone()[0] == 0, "executions were not cascade deleted with organization"

    cursor.execute("SELECT count(*) FROM terminal_lines WHERE organization_id = ?", (test_org_id,))
    assert cursor.fetchone()[0] == 0, "terminal_lines were not cascade deleted with organization"

    conn.close()


def test_06_data_preservation_across_migration(disposable_db: Path):
    """Scenario 6: Core corporate data (agents, tasks, meetings) is 100% preserved through downgrade and upgrade cycles."""
    conn = sqlite3.connect(disposable_db)
    cursor = conn.cursor()

    # Record baseline record counts before migration
    cursor.execute("SELECT count(*) FROM agents")
    orig_agent_count = cursor.fetchone()[0]
    cursor.execute("SELECT count(*) FROM organizations")
    orig_org_count = cursor.fetchone()[0]
    cursor.execute("SELECT count(*) FROM meetings")
    orig_meeting_count = cursor.fetchone()[0]
    cursor.execute("SELECT count(*) FROM tasks")
    orig_task_count = cursor.fetchone()[0]
    conn.close()

    cfg = get_alembic_config_for_db(disposable_db)

    # Downgrade to PREV_REVISION and re-upgrade
    command.downgrade(cfg, PREV_REVISION)
    command.upgrade(cfg, HEAD_REVISION)

    # Re-verify counts
    conn = sqlite3.connect(disposable_db)
    cursor = conn.cursor()

    cursor.execute("SELECT count(*) FROM agents")
    assert cursor.fetchone()[0] == orig_agent_count, "Agent data was corrupted or lost during migration cycle"

    cursor.execute("SELECT count(*) FROM organizations")
    assert cursor.fetchone()[0] == orig_org_count, "Organization data was corrupted or lost during migration cycle"

    cursor.execute("SELECT count(*) FROM meetings")
    assert cursor.fetchone()[0] == orig_meeting_count, "Meeting data was corrupted or lost during migration cycle"

    cursor.execute("SELECT count(*) FROM tasks")
    assert cursor.fetchone()[0] == orig_task_count, "Task data was corrupted or lost during migration cycle"

    conn.close()


def test_07_index_presence_and_execution_indexes(disposable_db: Path):
    """Scenario 7: Required performance and query indexes are present on executions and terminal_lines."""
    conn = sqlite3.connect(disposable_db)
    cursor = conn.cursor()

    cursor.execute("PRAGMA index_list('executions')")
    exec_indexes = {row[1] for row in cursor.fetchall()}
    assert "ix_executions_organization_id" in exec_indexes
    assert "ix_executions_agent_id" in exec_indexes
    assert "ix_executions_task_id" in exec_indexes
    assert "ix_executions_status" in exec_indexes
    assert "ix_executions_org_agent_status" in exec_indexes

    cursor.execute("PRAGMA index_list('terminal_lines')")
    term_indexes = {row[1] for row in cursor.fetchall()}
    assert "ix_terminal_lines_execution_id" in term_indexes
    assert "ix_terminal_lines_org_id" in term_indexes
    assert "ix_terminal_lines_agent_id" in term_indexes
    assert "ix_terminal_exec_seq" in term_indexes

    conn.close()
