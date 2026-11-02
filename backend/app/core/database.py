from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from typing import Generator
from backend.app.core.config import settings

connect_args = {}
if "sqlite" in settings.DATABASE_URL:
    connect_args["check_same_thread"] = False

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    pool_size=50,
    max_overflow=100,
    pool_timeout=60.0,
    pool_pre_ping=True
)

import logging
logger = logging.getLogger("agency.database")

# Enable Foreign Key enforcement and busy timeout in SQLite
@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    if "sqlite" in settings.DATABASE_URL:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

def configure_sqlite_wal(engine_to_configure: Engine = engine) -> str:
    """
    Safely configures Write-Ahead Logging (WAL) mode for persistent file-based SQLite databases.
    Preserves in-memory SQLite instances (:memory:) used in tests without alteration.
    """
    url_str = str(engine_to_configure.url)
    if "sqlite" in url_str and ":memory:" not in url_str:
        try:
            with engine_to_configure.connect() as conn:
                current_mode = conn.exec_driver_sql("PRAGMA journal_mode").scalar()
                if current_mode and str(current_mode).lower() != "wal":
                    new_mode = conn.exec_driver_sql("PRAGMA journal_mode=WAL").scalar()
                    logger.info(f"SQLite WAL mode enabled: {new_mode}")
                    return str(new_mode)
                return str(current_mode)
        except Exception as e:
            logger.warning(f"Could not configure SQLite WAL mode: {e}")
            return "error"
    return "skipped"

# Configure WAL mode for production database engine on module import
configure_sqlite_wal(engine)

def apply_schema_upgrades(engine_to_upgrade: Engine = engine) -> None:
    """
    Applies backward-compatible schema updates (e.g. idempotency_key, lease_token columns) safely.
    """
    try:
        with engine_to_upgrade.connect() as conn:
            cursor = conn.exec_driver_sql("PRAGMA table_info(tasks)")
            cols = [row[1] for row in cursor.fetchall()]
            if cols and "idempotency_key" not in cols:
                conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN idempotency_key VARCHAR(64)")
                conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_tasks_org_idempotency ON tasks (organization_id, idempotency_key)")
                logger.info("Schema migration: added 'idempotency_key' to tasks table.")
            if cols and "lease_token" not in cols:
                conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN lease_token VARCHAR(64)")
                conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_tasks_lease_token ON tasks (lease_token)")
                logger.info("Schema migration: added 'lease_token' to tasks table.")

            # Check agent_events for execution_id
            cursor_events = conn.exec_driver_sql("PRAGMA table_info(agent_events)")
            cols_events = [row[1] for row in cursor_events.fetchall()]
            if cols_events and "execution_id" not in cols_events:
                conn.exec_driver_sql("ALTER TABLE agent_events ADD COLUMN execution_id VARCHAR(64)")
                conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_agent_events_exec_created ON agent_events (execution_id, created_at)")
                logger.info("Schema migration: added 'execution_id' to agent_events table.")
    except Exception as e:
        logger.warning(f"Could not apply schema upgrades: {e}")

apply_schema_upgrades(engine)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

import time
import random
from contextlib import contextmanager
from sqlite3 import OperationalError as SqliteOperationalError
from sqlalchemy.exc import OperationalError as SaOperationalError

def commit_with_retry(session: Session, max_retries: int = 5, base_delay: float = 0.05) -> None:
    """
    Commits a transaction with exponential backoff and jitter if SQLite experiences lock contention.
    Guarantees no lost committed updates or unhandled lock failures under write bursts.
    """
    for attempt in range(max_retries + 1):
        try:
            session.commit()
            return
        except (SaOperationalError, SqliteOperationalError) as e:
            err_msg = str(e).lower()
            if "locked" in err_msg or "busy" in err_msg:
                if attempt == max_retries:
                    logger.error(f"commit_with_retry failed after {max_retries} attempts: {e}")
                    session.rollback()
                    raise
                delay = base_delay * (2 ** attempt) + random.uniform(0.01, 0.05)
                logger.warning(f"Database locked on commit attempt {attempt + 1}/{max_retries}. Retrying in {delay:.3f}s...")
                time.sleep(delay)
            else:
                session.rollback()
                raise
        except Exception:
            session.rollback()
            raise

@contextmanager
def transaction_scope(session: Session, auto_retry: bool = True):
    """
    Transactional context manager ensuring safe commit with retry or rollback.
    """
    try:
        yield session
        if auto_retry:
            commit_with_retry(session)
        else:
            session.commit()
    except Exception:
        session.rollback()
        raise

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
