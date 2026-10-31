import os
os.environ.setdefault("SECRET_KEY", "test-suite-secure-signing-secret-at-least-32-bytes-long")
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from backend.app.core.database import Base, get_db
from backend.app.main import app
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.task_step import TaskStepModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.models.approval import ApprovalModel
from backend.app.models.artifact import ArtifactModel

# Use dedicated in-memory SQLite with foreign keys enforced for tests
TEST_DATABASE_URL = "sqlite:///:memory:"

test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

# Enforce foreign keys in SQLite for tests
@event.listens_for(test_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

import backend.app.websocket_manager as ws_mod
ws_mod.SessionLocal = TestingSessionLocal

@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    Base.metadata.create_all(bind=test_engine)
    from backend.app.models.auth import OrganizationModel
    from backend.app.models.agent import AgentModel
    from backend.app.scripts.seed import CORPORATE_AGENTS
    with TestingSessionLocal() as session:
        if not session.query(OrganizationModel).filter(OrganizationModel.id == "org_default_company").first():
            default_org = OrganizationModel(
                id="org_default_company",
                name="Default Organization",
                slug="default-org",
                is_active=True
            )
            session.add(default_org)
            session.commit()
        for agent_data in CORPORATE_AGENTS:
            if not session.query(AgentModel).filter(AgentModel.id == agent_data["id"]).first():
                new_a = AgentModel(
                    id=agent_data["id"],
                    name=agent_data["name"],
                    role=agent_data["role"],
                    station=agent_data["station"],
                    status=agent_data["status"],
                    color=agent_data["color"],
                    avatar=agent_data["avatar"],
                    pos_x=agent_data["pos_x"],
                    pos_y=agent_data["pos_y"],
                    pos_z=agent_data["pos_z"],
                    description=agent_data["description"],
                    organization_id="org_default_company"
                )
                session.add(new_a)
        session.commit()
    yield
    Base.metadata.drop_all(bind=test_engine)

@pytest.fixture
def db_session():
    connection = test_engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)

    yield session

    session.close()
    transaction.rollback()
    connection.close()

@pytest.fixture
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()

@pytest.fixture
def seed_test_agent(db_session):
    agent = AgentModel(
        id="test-captain-agent",
        name="Test Captain Roger",
        role="Fleet Leader",
        station="captain_hq",
        status="idle",
        color="#f59e0b",
        avatar="captain",
        pos_x=0.0,
        pos_y=1.2,
        pos_z=0.0,
        description="Lead testing agent"
    )
    db_session.add(agent)
    db_session.commit()
    db_session.refresh(agent)
    return agent

@pytest.fixture
def auth_client(client, db_session):
    from backend.app.models.auth import OrganizationModel, UserModel, OrganizationMemberModel
    from backend.app.core.auth import create_jwt_token, hash_password

    org = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_default_company").first()
    if not org:
        org = OrganizationModel(
            id="org_default_company",
            name="Default Organization",
            slug="default-org",
            is_active=True
        )
        db_session.add(org)
        db_session.flush()

    user = db_session.query(UserModel).filter(UserModel.id == "user_test_default").first()
    if not user:
        user = UserModel(
            id="user_test_default",
            email="test_default@example.com",
            full_name="Default Tester",
            hashed_password=hash_password("Password123!"),
            is_active=True,
            token_version=1
        )
        db_session.add(user)
        db_session.flush()

        member = OrganizationMemberModel(
            user_id=user.id,
            organization_id=org.id,
            role="ADMIN"
        )
        db_session.add(member)
        db_session.flush()
    db_session.commit()

    token = create_jwt_token({
        "sub": user.id,
        "email": user.email,
        "org_id": org.id,
        "ver": 1
    })
    client.headers["Authorization"] = f"Bearer {token}"
    client.auth_token = token
    return client
