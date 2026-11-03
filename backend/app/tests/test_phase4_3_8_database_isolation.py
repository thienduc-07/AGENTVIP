"""
PROVIPAGENT Phase 4.3.8: Database Isolation & Online Backup Verification Suite
Proves that E2E operations against disposable database (e2e_agency.db)
have zero side-effects or mutations on production agency.db.
"""
import os
import hashlib
import sqlite3
import pytest
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.database import Base
from backend.app.models.auth import OrganizationModel
from backend.app.models.agent import AgentModel
from backend.app.models.execution import ExecutionModel, TerminalLineModel
from backend.app.services.workstation_execution_service import WorkstationExecutionService

ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
AGENCY_DB_PATH = ROOT_DIR / "agency.db"
E2E_DB_PATH = ROOT_DIR / "e2e_agency.db"


def compute_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def test_01_sqlite_online_backup_consistency():
    """Verifies that e2e_agency.db is created via SQLite Online Backup API with full consistency."""
    assert AGENCY_DB_PATH.exists(), f"agency.db not found at {AGENCY_DB_PATH}"

    # Perform online backup
    src_conn = sqlite3.connect(str(AGENCY_DB_PATH))
    dst_conn = sqlite3.connect(str(E2E_DB_PATH))
    with dst_conn:
        src_conn.backup(dst_conn, pages=1000)
    dst_conn.close()
    src_conn.close()

    assert E2E_DB_PATH.exists()
    assert E2E_DB_PATH.stat().st_size > 0

    # Verify integrity and foreign keys
    conn = sqlite3.connect(str(E2E_DB_PATH))
    c = conn.cursor()
    c.execute("PRAGMA integrity_check")
    assert c.fetchone()[0] == "ok"

    c.execute("PRAGMA foreign_key_check")
    assert len(c.fetchall()) == 0

    c.execute("SELECT version_num FROM alembic_version")
    assert c.fetchone()[0] == "e1f2a3b4c5d6"
    conn.close()


def test_02_database_isolation_and_immutability():
    """
    Explicitly proves database isolation:
    Mutations on e2e_agency.db never leak to agency.db, and agency.db SHA-256 remains immutable.
    """
    initial_agency_hash = compute_sha256(AGENCY_DB_PATH)

    # Connect to e2e_agency.db via SQLAlchemy engine
    e2e_engine = create_engine(f"sqlite:///{E2E_DB_PATH}")
    E2ESession = sessionmaker(bind=e2e_engine, autocommit=False, autoflush=False)

    probe_org_id = "org_isolation_verification_test"
    probe_agent_id = "agt_isolation_probe_99"

    with E2ESession() as session:
        # Create new probe org and agent in e2e_agency.db
        org = OrganizationModel(
            id=probe_org_id,
            name="Isolation Probe Org",
            slug="isolation-probe",
            is_active=True,
        )
        session.add(org)

        agent = AgentModel(
            id=probe_agent_id,
            organization_id=probe_org_id,
            name="Isolation Agent",
            role="Auditor",
            status="idle",
            station="desk_e2e",
            behavioral_state="IDLE",
        )
        session.add(agent)
        session.commit()

        # Start execution and append terminal lines
        exec_model = WorkstationExecutionService.start_execution(
            db=session,
            agent_id=probe_agent_id,
            organization_id=probe_org_id,
            correlation_id="corr_isolation_probe",
        )
        WorkstationExecutionService.append_terminal_line(
            db=session,
            execution_id=exec_model.id,
            stream="stdout",
            content="Isolated execution output line 1",
            broadcast=False,
        )
        WorkstationExecutionService.complete_execution(
            db=session,
            execution_id=exec_model.id,
            status="completed",
            summary="Execution finished on isolated database",
        )
        session.commit()

    # 1. Verify records exist in e2e_agency.db
    e2e_conn = sqlite3.connect(str(E2E_DB_PATH))
    e2e_cur = e2e_conn.cursor()
    e2e_cur.execute("SELECT count(*) FROM organizations WHERE id = ?", (probe_org_id,))
    assert e2e_cur.fetchone()[0] == 1, "Probe org missing from e2e_agency.db"

    e2e_cur.execute("SELECT count(*) FROM agents WHERE id = ?", (probe_agent_id,))
    assert e2e_cur.fetchone()[0] == 1, "Probe agent missing from e2e_agency.db"

    e2e_cur.execute("SELECT count(*) FROM executions WHERE organization_id = ?", (probe_org_id,))
    assert e2e_cur.fetchone()[0] == 1, "Probe execution missing from e2e_agency.db"
    e2e_conn.close()

    # 2. Verify records DO NOT exist in production agency.db
    prod_conn = sqlite3.connect(str(AGENCY_DB_PATH))
    prod_cur = prod_conn.cursor()
    prod_cur.execute("SELECT count(*) FROM organizations WHERE id = ?", (probe_org_id,))
    assert prod_cur.fetchone()[0] == 0, "CRITICAL LEAK: Probe org found in production agency.db!"

    prod_cur.execute("SELECT count(*) FROM agents WHERE id = ?", (probe_agent_id,))
    assert prod_cur.fetchone()[0] == 0, "CRITICAL LEAK: Probe agent found in production agency.db!"

    prod_cur.execute("SELECT count(*) FROM executions WHERE organization_id = ?", (probe_org_id,))
    assert prod_cur.fetchone()[0] == 0, "CRITICAL LEAK: Probe execution found in production agency.db!"
    prod_conn.close()

    # 3. Verify SHA-256 of production agency.db is byte-for-byte identical
    final_agency_hash = compute_sha256(AGENCY_DB_PATH)
    assert final_agency_hash == initial_agency_hash, (
        f"CRITICAL IMMUTABILITY VIOLATION: agency.db checksum changed! Before: {initial_agency_hash}, After: {final_agency_hash}"
    )

    e2e_engine.dispose()

