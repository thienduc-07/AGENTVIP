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

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
