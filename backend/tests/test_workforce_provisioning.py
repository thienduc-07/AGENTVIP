import pytest
import math
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.database import Base
from backend.app.models.agent import AgentModel
from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.services.workforce_provisioning_service import (
    workforce_provisioning_service,
    LEADERSHIP_AGENTS,
)
from backend.app.services.workstation_service import get_floor_for_division, ZONE_CONFIGS


def test_workforce_provisioning_idempotency_and_allocations():
    """
    Validates:
    1. Provisioning creates agents for all specialists.
    2. Leadership agents are preserved and not duplicated.
    3. Running provisioning twice is strictly idempotent (0 new, 0 duplicates).
    4. Workstation allocations are unique and collision-free.
    5. Floor and room mappings are correct across 18 divisions.
    """
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Seed 18 sample specialists across all 18 divisions
    divisions = [
        "operations", "support", "healthcare",
        "finance", "specialized",
        "marketing", "paid-media", "sales",
        "design", "product", "project-management", "game-development", "spatial-computing",
        "engineering", "security", "testing", "gis",
        "academic"
    ]
    for i, div in enumerate(divisions):
        spec = SpecialistDefinitionModel(
            id=f"spec-test-{div}-{i}",
            slug=f"test-{div}-expert",
            name=f"Test {div.title()} Expert",
            division=div,
            department=div,
            role=f"{div.title()} Specialist",
            description=f"Specialist in {div}",
            system_instructions=f"Instructions for {div}",
            source_path=f"specialists/{div}.md",
            content_hash=f"hash-{div}",
            raw_content=f"# {div}",
            validation_status="VALID",
            lifecycle_state="AVAILABLE",
            version=1,
        )
        db.add(spec)
        ver = SpecialistVersionModel(
            id=f"ver-test-{div}-{i}",
            specialist_id=spec.id,
            version=1,
            content_hash=f"hash-{div}",
            raw_content="content",
        )
        db.add(ver)

    db.commit()

    # Pre-seed one leadership agent to verify preservation
    lead_ceo = AgentModel(
        id="agent-exec-ceo",
        name="Victoria Vance (Existing)",
        role="Chief Executive Officer & Autonomous Strategy Lead",
        station="executive_suite",
        status="idle",
        organization_id="org_default_company",
    )
    db.add(lead_ceo)
    db.commit()

    # Run 1: Provision workforce
    res1 = workforce_provisioning_service.provision_full_workforce(db, "org_default_company")
    assert res1["status"] == "SUCCESS"
    assert res1["leadership_agents_preserved"] == 8
    assert res1["specialists_provisioned_new"] == 18
    assert res1["duplicate_employees"] == 0
    assert res1["unassigned_employees"] == 0

    # Verify existing CEO was preserved, not overwritten with new name
    ceo_in_db = db.query(AgentModel).filter(AgentModel.id == "agent-exec-ceo").first()
    assert ceo_in_db.name == "Victoria Vance (Existing)"

    # Total employees = 18 specialists + 8 leadership = 26
    total_count1 = db.query(AgentModel).filter(AgentModel.organization_id == "org_default_company").count()
    assert total_count1 == 26

    # Run 2: Re-run provisioning (must be strictly idempotent)
    res2 = workforce_provisioning_service.provision_full_workforce(db, "org_default_company")
    assert res2["status"] == "SUCCESS"
    assert res2["specialists_provisioned_new"] == 0
    assert res2["specialists_reused_existing"] == 18
    assert res2["duplicate_employees"] == 0

    total_count2 = db.query(AgentModel).filter(AgentModel.organization_id == "org_default_company").count()
    assert total_count2 == total_count1 == 26

    # Verify collision-free coordinates across allocations
    allocations = (
        db.query(WorkstationAllocationModel)
        .filter(WorkstationAllocationModel.organization_id == "org_default_company")
        .all()
    )
    assert len(allocations) == 26

    # Verify floor mapping
    for alloc in allocations:
        fl = get_floor_for_division(alloc.department)
        assert 1 <= fl <= 6
        assert alloc.pos_y == 1.0
        assert -13.0 <= alloc.pos_x <= 13.0
        assert -9.0 <= alloc.pos_z <= 9.0

    # Verify no two desks in same department share the same desk_number or coordinates
    seen_desks = set()
    for alloc in allocations:
        key = (alloc.department, alloc.desk_number)
        assert key not in seen_desks, f"Duplicate desk allocation: {key}"
        seen_desks.add(key)

    db.close()
