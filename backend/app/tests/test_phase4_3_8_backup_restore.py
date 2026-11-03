import os
import tempfile
import sqlite3
import pytest
from backend.app.scripts.backup import (
    backup_database,
    restore_database,
    verify_backup,
    CRITICAL_TABLES,
)

SOURCE_DB = "e2e_agency.db"


@pytest.fixture
def temp_backup_paths():
    fd1, bak_path = tempfile.mkstemp(suffix="_backup.db")
    os.close(fd1)
    fd2, rest_path = tempfile.mkstemp(suffix="_restore.db")
    os.close(fd2)

    yield bak_path, rest_path

    if os.path.exists(bak_path):
        os.remove(bak_path)
    if os.path.exists(rest_path):
        os.remove(rest_path)


def test_online_backup_creation_and_integrity(temp_backup_paths):
    """Test 1: Online backup creates consistent snapshot with passing integrity check."""
    bak_path, _ = temp_backup_paths

    result = backup_database(SOURCE_DB, bak_path)
    assert result["status"] == "success"
    assert os.path.exists(bak_path)
    assert os.path.getsize(bak_path) > 0

    verification = result["verification"]
    assert verification["integrity_check"] == "ok"
    assert verification["foreign_key_violations"] == 0
    assert verification["parity_match"] is True


def test_backup_restore_and_parity(temp_backup_paths):
    """Test 2: Restoring backup to new file maintains 100% row parity across all critical tables."""
    bak_path, rest_path = temp_backup_paths

    # 1. Backup
    backup_database(SOURCE_DB, bak_path)

    # 2. Restore
    restore_result = restore_database(bak_path, rest_path)
    assert restore_result["status"] == "success"
    assert os.path.exists(rest_path)

    # 3. Verify restored database
    verification = verify_backup(SOURCE_DB, rest_path)
    assert verification["integrity_check"] == "ok"
    assert verification["foreign_key_violations"] == 0
    assert verification["parity_match"] is True

    # 4. Check critical table row counts
    for table in CRITICAL_TABLES:
        src_cnt, dst_cnt = verification["row_counts"][table]
        assert src_cnt == dst_cnt, f"Table {table} row count mismatch: {src_cnt} vs {dst_cnt}"


def test_restored_database_mutation_isolation(temp_backup_paths):
    """Test 3: Mutations on restored database do not leak back to source database."""
    bak_path, rest_path = temp_backup_paths

    backup_database(SOURCE_DB, bak_path)
    restore_database(bak_path, rest_path)

    # Count rows in source
    src_conn = sqlite3.connect(SOURCE_DB)
    src_cnt_before = src_conn.cursor().execute("SELECT count(*) FROM tasks;").fetchone()[0]
    src_conn.close()

    # Insert row in restored DB
    rest_conn = sqlite3.connect(rest_path)
    rest_cursor = rest_conn.cursor()
    rest_cursor.execute("INSERT INTO tasks (id, title, description, status, priority, assigned_agent_id, organization_id, task_type, retry_count, max_retries, created_at, updated_at) VALUES ('t-iso-test', 'Iso Title', 'Desc', 'queued', 'normal', 'agent-exec-ceo', 'org_default_company', 'general', 0, 3, datetime('now'), datetime('now'));")
    rest_conn.commit()
    rest_cnt_after = rest_cursor.execute("SELECT count(*) FROM tasks;").fetchone()[0]
    rest_conn.close()

    assert rest_cnt_after == src_cnt_before + 1

    # Verify source was unaffected
    src_conn = sqlite3.connect(SOURCE_DB)
    src_cnt_after = src_conn.cursor().execute("SELECT count(*) FROM tasks;").fetchone()[0]
    src_conn.close()

    assert src_cnt_after == src_cnt_before
