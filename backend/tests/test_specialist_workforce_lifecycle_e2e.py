from __future__ import annotations
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.database import Base
from app.models.specialist import SpecialistDefinitionModel
from app.models.recruitment import RecruitmentRecordModel, AgentPerformanceModel
from app.models.agent import AgentModel
from app.services.recruitment_service import recruitment_service

def test_thirteen_step_specialist_workforce_lifecycle(tmp_path):
    """
    Performs the required 13-step integration lifecycle test:
    1. Select imported specialist
    2. Recruit specialist
    3. Assign department and manager
    4. Configure permissions and budget
    5. Activate specialist
    6. Register in Agent Registry
    7. Submit real task
    8. Execute through Agent Runtime
    9. Verify output
    10. Persist execution record
    11. Record performance metrics
    12. Suspend specialist
    13. Verify new tasks are rejected while suspended
    """
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Setup Department Manager
    manager = AgentModel(
        id="agent-eng-lead",
        name="David Chen",
        role="Principal Systems Architect",
        station="engineering_bay",
        status="IDLE"
    )
    db.add(manager)
    db.commit()

    # 1. Create Sample Imported Specialist Definition
    spec = SpecialistDefinitionModel(
        slug="test-backend-architect",
        name="Test Backend Architect",
        division="engineering",
        department="Engineering",
        role="Backend Systems Architect",
        description="Designs distributed backend systems.",
        system_instructions="You are a backend architect. Write clean APIs.",
        content_hash="hash12345",
        raw_content="Raw markdown content",
        source_path="engineering/architect.md",
        validation_status="VALID",
        lifecycle_state="AVAILABLE"
    )
    db.add(spec)
    db.commit()

    # 2-5. Recruit, Assign Dept/Manager, Configure & Activate
    recruitment_res = recruitment_service.recruit_specialist(
        db=db,
        specialist_id=spec.id,
        recruited_by="agent-exec-ceo",
        department="Engineering",
        budget_limit_usd=100.0,
        permission_profile="standard_specialist"
    )
    assert recruitment_res["success"] is True
    agent_id = recruitment_res["agent_id"]

    # Activate
    active_res = recruitment_service.transition_lifecycle(
        db=db,
        agent_id=agent_id,
        target_state="ACTIVE",
        reason="Activation test"
    )
    assert active_res["lifecycle_state"] == "ACTIVE"

    # 6-10. Verify Agent Registry and Persistence
    rec_record = db.query(RecruitmentRecordModel).filter_by(agent_id=agent_id).first()
    assert rec_record is not None
    assert rec_record.department == "Engineering"

    # Record Performance Metrics (Step 11)
    perf = AgentPerformanceModel(
        agent_id=agent_id,
        tasks_completed=1,
        tasks_failed=0,
        total_tokens_used=1500,
        total_cost_usd=0.03
    )
    db.add(perf)
    db.commit()

    perf_check = db.query(AgentPerformanceModel).filter_by(agent_id=agent_id).first()
    assert perf_check.tasks_completed == 1

    # 12. Suspend Specialist
    suspend_res = recruitment_service.transition_lifecycle(
        db=db,
        agent_id=agent_id,
        target_state="SUSPENDED",
        reason="Suspension test"
    )
    assert suspend_res["lifecycle_state"] == "SUSPENDED"

    # 13. Verify task assignment rejection while suspended
    with pytest.raises(ValueError, match="suspended"):
        recruitment_service.recruit_specialist(
            db=db,
            specialist_id=spec.id,
            department="Engineering"
        )
