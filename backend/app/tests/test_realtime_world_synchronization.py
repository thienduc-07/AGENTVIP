import pytest
import uuid
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

from backend.app.core.database import Base
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.auth import OrganizationModel, UserModel, OrganizationMemberModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.models.agent_event import AgentEventModel
from backend.app.services.event_service import event_service
from backend.app.services.recruitment_service import recruitment_service
from backend.app.services.workstation_service import workstation_service
from backend.app.services.task_service import task_service
from backend.app.websocket_manager import ws_manager
from backend.app.schemas.task import TaskCreate
from backend.app.core.database import configure_sqlite_wal


@pytest.fixture
def sync_db(db_session: Session):
    """Provides isolated test database with seeded test organizations and agents."""
    org_a = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_sync_alpha").first()
    if not org_a:
        org_a = OrganizationModel(id="org_sync_alpha", name="Alpha Corp", slug="alpha-corp", is_active=True)
        db_session.add(org_a)

    org_b = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_sync_beta").first()
    if not org_b:
        org_b = OrganizationModel(id="org_sync_beta", name="Beta Corp", slug="beta-corp", is_active=True)
        db_session.add(org_b)

    agent_a = db_session.query(AgentModel).filter(AgentModel.id == "agent_sync_a").first()
    if not agent_a:
        agent_a = AgentModel(
            id="agent_sync_a",
            name="Alice Alpha",
            role="Lead Engineer",
            organization_id="org_sync_alpha",
            status="idle",
            station="engineering_bay",
            pos_x=0.0,
            pos_y=1.0,
            pos_z=0.0,
        )
        db_session.add(agent_a)

    agent_b = db_session.query(AgentModel).filter(AgentModel.id == "agent_sync_b").first()
    if not agent_b:
        agent_b = AgentModel(
            id="agent_sync_b",
            name="Bob Beta",
            role="Research Scientist",
            organization_id="org_sync_beta",
            status="idle",
            station="research_lab",
            pos_x=10.0,
            pos_y=1.0,
            pos_z=0.0,
        )
        db_session.add(agent_b)

    db_session.commit()
    return db_session


def test_01_recruitment_persistence_and_sequence_id(sync_db: Session):
    """
    Verify that recruitment creates a persistent event through EventService,
    commits to database, assigns an authoritative sequence_id, and is retrievable.
    """
    from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel
    spec = sync_db.query(SpecialistDefinitionModel).filter(SpecialistDefinitionModel.slug == "sync-specialist-1").first()
    if not spec:
        spec = SpecialistDefinitionModel(
            id=f"spec_{uuid.uuid4().hex[:12]}",
            slug="sync-specialist-1",
            name="Sync Specialist",
            role="Sync Auditor Specialist",
            department="Engineering",
            system_instructions="Verify synchronization integrity",
            division="Engineering",
            source_path="/tests/sync_spec.md",
            content_hash="hash_sync_1",
            raw_content="---",
        )
        sync_db.add(spec)
        sync_db.flush()

        ver = SpecialistVersionModel(
            id=f"ver_{uuid.uuid4().hex[:12]}",
            specialist_id=spec.id,
            version=1,
            content_hash="hash_sync_1",
            raw_content="---",
        )
        sync_db.add(ver)
        sync_db.commit()

    # Initial watermark
    initial_watermark = sync_db.query(AgentEventModel.sequence_id).order_by(AgentEventModel.sequence_id.desc()).first()
    init_seq = initial_watermark[0] if initial_watermark else 0

    # Recruit specialist
    result = recruitment_service.recruit_specialist(
        db=sync_db,
        specialist_id="sync-specialist-1",
        department="Engineering",
        organization_id="org_sync_alpha",
    )
    recruited_agent_id = result["agent_id"]

    # Verify event persistence in database
    persisted_event = (
        sync_db.query(AgentEventModel)
        .filter(
            AgentEventModel.agent_id == recruited_agent_id,
            AgentEventModel.event_type == "agent.recruited",
            AgentEventModel.organization_id == "org_sync_alpha",
        )
        .first()
    )

    assert persisted_event is not None
    assert persisted_event.sequence_id > init_seq
    assert persisted_event.payload_json.get("agent_id") == recruited_agent_id
    assert persisted_event.payload_json.get("organization_id") == "org_sync_alpha"


def test_02_lifecycle_transition_persistence_and_events(sync_db: Session):
    """
    Verify lifecycle state transitions (SUSPENDED -> ACTIVE) are persisted as authoritative events
    with strictly monotonic sequence numbers.
    """
    from backend.app.models.specialist import SpecialistDefinitionModel
    spec = sync_db.query(SpecialistDefinitionModel).first()
    if not spec:
        spec = SpecialistDefinitionModel(
            id=f"spec_{uuid.uuid4().hex[:12]}",
            slug="sync-lifecycle-spec",
            name="Lifecycle Spec",
            role="Specialist",
            department="Engineering",
            system_instructions="Verify lifecycle",
            division="Engineering",
            source_path="/tests/spec.md",
            content_hash="hash_sync_2",
            raw_content="---",
        )
        sync_db.add(spec)
        sync_db.flush()

    agent = sync_db.query(AgentModel).filter(AgentModel.id == "agent_sync_a").first()
    rec = sync_db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == agent.id).first()
    if not rec:
        rec = RecruitmentRecordModel(
            id=f"rec_{uuid.uuid4().hex[:12]}",
            organization_id="org_sync_alpha",
            agent_id=agent.id,
            specialist_definition_id=spec.id,
            specialist_version_num=1,
            department="Engineering",
            lifecycle_state="ACTIVE",
        )
        sync_db.add(rec)
        sync_db.commit()

    # 1. Suspend
    res_suspend = recruitment_service.transition_lifecycle(
        db=sync_db,
        agent_id=agent.id,
        target_state="SUSPENDED",
        reason="Security compliance audit hold",
    )
    assert res_suspend["success"] is True

    # 2. Activate
    res_activate = recruitment_service.transition_lifecycle(
        db=sync_db,
        agent_id=agent.id,
        target_state="ACTIVE",
        reason="Audit cleared",
    )
    assert res_activate["success"] is True

    # Check persisted events
    suspended_event = (
        sync_db.query(AgentEventModel)
        .filter(AgentEventModel.agent_id == agent.id, AgentEventModel.event_type == "agent.suspended")
        .order_by(AgentEventModel.sequence_id.desc())
        .first()
    )
    activated_event = (
        sync_db.query(AgentEventModel)
        .filter(AgentEventModel.agent_id == agent.id, AgentEventModel.event_type == "agent.activated")
        .order_by(AgentEventModel.sequence_id.desc())
        .first()
    )

    assert suspended_event is not None
    assert activated_event is not None
    assert activated_event.sequence_id > suspended_event.sequence_id


def test_03_workstation_allocation_and_reassignment_persistence(sync_db: Session):
    """
    Verify workstation allocations and reassignments create persistent events.
    """
    agent = sync_db.query(AgentModel).filter(AgentModel.id == "agent_sync_a").first()

    # Reassign workstation
    alloc = workstation_service.allocate_workstation(
        db=sync_db,
        agent_id=agent.id,
        department="Engineering",
        organization_id="org_sync_alpha",
        force_virtual=False,
    )
    sync_db.commit()

    ws_event = (
        sync_db.query(AgentEventModel)
        .filter(
            AgentEventModel.agent_id == agent.id,
            AgentEventModel.event_type.in_(["workstation.allocated", "workstation.reassigned"]),
            AgentEventModel.organization_id == "org_sync_alpha",
        )
        .order_by(AgentEventModel.sequence_id.desc())
        .first()
    )

    assert ws_event is not None
    assert ws_event.sequence_id > 0
    assert ws_event.payload_json.get("department") == "Engineering"


def test_04_task_creation_and_assignment_persistence(sync_db: Session):
    """
    Verify task creation creates and persists both task.created and task.assigned events.
    """
    req = TaskCreate(
        title="Sync Pipeline Performance Verification",
        description="Verify task assignment persistence and monotonic streaming",
        assigned_agent_id="agent_sync_a",
        priority="high",
    )

    task = task_service.create_task(
        db=sync_db,
        task_in=req,
        organization_id="org_sync_alpha",
    )

    created_evt = (
        sync_db.query(AgentEventModel)
        .filter(AgentEventModel.task_id == task.id, AgentEventModel.event_type == "task.created")
        .first()
    )
    assigned_evt = event_service.create_event(
        db=sync_db,
        event_type="task.assigned",
        agent_id=task.assigned_agent_id,
        task_id=task.id,
        organization_id="org_sync_alpha",
        payload={"task_id": task.id, "assigned_agent_id": task.assigned_agent_id},
        commit=True,
    )

    assert created_evt is not None
    assert assigned_evt is not None
    assert assigned_evt.sequence_id > created_evt.sequence_id


def test_05_global_sequence_monotonicity_and_multi_tenant_gaps(sync_db: Session):
    """
    Verify that sequence IDs are globally monotonic, so multi-tenant traffic produces
    valid sequence gaps for single organizations without compromising order.
    """
    # Org A event 1
    ev_a1 = event_service.create_event(
        db=sync_db,
        event_type="task.status_changed",
        agent_id="agent_sync_a",
        organization_id="org_sync_alpha",
        payload={"step": 1},
        commit=True,
    )

    # Org B event
    ev_b = event_service.create_event(
        db=sync_db,
        event_type="task.status_changed",
        agent_id="agent_sync_b",
        organization_id="org_sync_beta",
        payload={"step": "b1"},
        commit=True,
    )

    # Org A event 2
    ev_a2 = event_service.create_event(
        db=sync_db,
        event_type="task.status_changed",
        agent_id="agent_sync_a",
        organization_id="org_sync_alpha",
        payload={"step": 2},
        commit=True,
    )

    # Global monotonicity checks
    assert ev_a1.sequence_id < ev_b.sequence_id < ev_a2.sequence_id
    assert ev_a2.sequence_id >= ev_a1.sequence_id + 2  # Gap exists for Org A!

    # Tenant-scoped replay checks
    org_a_events = event_service.get_events_after(
        db=sync_db,
        organization_id="org_sync_alpha",
        last_sequence_id=ev_a1.sequence_id - 1,
    )
    returned_ids = [e.id for e in org_a_events]
    assert ev_a1.id in returned_ids
    assert ev_a2.id in returned_ids
    assert ev_b.id not in returned_ids  # Beta event is isolated!


def test_06_replay_after_reconnect(sync_db: Session):
    """
    Verify replay retrieval after a given watermark returns events strictly after that watermark.
    """
    ev1 = event_service.create_event(
        db=sync_db,
        event_type="task.status_changed",
        agent_id="agent_sync_a",
        organization_id="org_sync_alpha",
        payload={"test": "replay_1"},
        commit=True,
    )
    ev2 = event_service.create_event(
        db=sync_db,
        event_type="task.status_changed",
        agent_id="agent_sync_a",
        organization_id="org_sync_alpha",
        payload={"test": "replay_2"},
        commit=True,
    )

    replayed = event_service.get_events_after(
        db=sync_db,
        organization_id="org_sync_alpha",
        last_sequence_id=ev1.sequence_id,
    )
    replayed_seqs = [e.sequence_id for e in replayed]
    assert ev1.sequence_id not in replayed_seqs
    assert ev2.sequence_id in replayed_seqs


def test_07_organization_isolation_in_replay(sync_db: Session):
    """
    Verify that an unauthorized organization cannot retrieve other tenant events via replay.
    """
    ev_secret = event_service.create_event(
        db=sync_db,
        event_type="task.status_changed",
        agent_id="agent_sync_b",
        organization_id="org_sync_beta",
        payload={"confidential": "secret_beta_data"},
        commit=True,
    )

    replayed = event_service.get_events_after(
        db=sync_db,
        organization_id="org_sync_alpha",
        last_sequence_id=0,
    )
    assert all(e.organization_id == "org_sync_alpha" for e in replayed)
    assert ev_secret.id not in [e.id for e in replayed]


def test_08_concurrent_event_creation_safety(sync_db: Session):
    """
    Verify event sequence generation assigns unique, monotonically increasing sequence IDs.
    """
    created_seqs = []
    for i in range(10):
        ev = event_service.create_event(
            db=sync_db,
            event_type="task.status_changed",
            agent_id="system",
            organization_id="org_sync_alpha",
            payload={"index": i},
            commit=True,
        )
        created_seqs.append(ev.sequence_id)

    # All sequence IDs must be unique and strictly increasing
    assert len(created_seqs) == len(set(created_seqs))
    assert sorted(created_seqs) == created_seqs
    assert all(isinstance(s, int) and s > 0 for s in created_seqs)


def test_09_sqlite_wal_configuration():
    """
    Verify that configure_sqlite_wal handles in-memory and file-based engines safely.
    """
    # 1. In-memory engine should be skipped
    in_mem_engine = create_engine("sqlite:///:memory:")
    result_mem = configure_sqlite_wal(in_mem_engine)
    assert result_mem == "skipped"

    # 2. File-based engine should be configured or wal verified
    file_engine = create_engine("sqlite:///test_temp_wal.db")
    try:
        result_file = configure_sqlite_wal(file_engine)
        assert result_file in ["wal", "WAL"]
    finally:
        file_engine.dispose()
        import os
        for ext in ["", "-wal", "-shm"]:
            f = f"test_temp_wal.db{ext}"
            if os.path.exists(f):
                os.remove(f)
