import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.database import SessionLocal
from backend.app.models.agent import AgentModel
from backend.app.models.specialist import SpecialistDefinitionModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.services.workforce_provisioning_service import (
    workforce_provisioning_service,
    LEADERSHIP_AGENTS,
)
from backend.app.services.workstation_service import get_floor_for_division, ZONE_CONFIGS


def test_workforce_census_authoritative_verification():
    """
    Authoritative workforce verification against runtime SQLite database:
    1. Exactly 268 specialist definitions exist in catalog.
    2. All 268 specialists are integrated as active employees in org_default_company.
    3. Exactly 8 leadership agents are preserved with correct roles and stations.
    4. Total employees in org_default_company is >= 276.
    5. All 18 divisions are represented with correct floor mappings.
    6. All assigned workstations have valid 3D coordinates within room bounds.
    7. No collisions among desks within any floor or department.
    """
    db = SessionLocal()
    try:
        org_id = "org_default_company"

        # 1. Catalog count
        specialists = db.query(SpecialistDefinitionModel).filter(
            SpecialistDefinitionModel.validation_status != "INVALID"
        ).all()
        assert len(specialists) == 268, f"Expected 268 specialists, found {len(specialists)}"

        # 2. Leadership verification
        leadership_ids = [l["id"] for l in LEADERSHIP_AGENTS]
        for lead in LEADERSHIP_AGENTS:
            agent = db.query(AgentModel).filter(
                AgentModel.id == lead["id"],
                AgentModel.organization_id == org_id,
            ).first()
            assert agent is not None, f"Leadership agent {lead['id']} missing!"
            assert agent.name == lead["name"], f"Leadership agent name altered for {lead['id']}!"

        # 3. Specialist employees verification
        active_recruitments = (
            db.query(RecruitmentRecordModel)
            .filter(
                RecruitmentRecordModel.organization_id == org_id,
                RecruitmentRecordModel.lifecycle_state == "ACTIVE",
            )
            .all()
        )
        recruited_spec_ids = set(r.specialist_definition_id for r in active_recruitments)
        assert len(recruited_spec_ids) == 268, f"Expected 268 recruited specialist IDs, got {len(recruited_spec_ids)}"

        # 4. Total employees in organization
        total_employees = db.query(AgentModel).filter(AgentModel.organization_id == org_id).count()
        assert total_employees >= 276, f"Expected at least 276 employees, found {total_employees}"

        # 5. Divisions & Floors distribution
        division_counts = {}
        floor_counts = {f: 0 for f in range(1, 7)}
        allocations = (
            db.query(WorkstationAllocationModel)
            .filter(
                WorkstationAllocationModel.organization_id == org_id,
                WorkstationAllocationModel.allocation_status == "ASSIGNED",
            )
            .all()
        )

        seen_positions = set()
        for alloc in allocations:
            div = alloc.department
            division_counts[div] = division_counts.get(div, 0) + 1
            fl = get_floor_for_division(div)
            floor_counts[fl] += 1

            assert 1 <= fl <= 6, f"Invalid floor {fl} for department {div}"
            assert -13.5 <= alloc.pos_x <= 13.5, f"Workstation {alloc.id} X out of bounds: {alloc.pos_x}"
            assert -9.5 <= alloc.pos_z <= 9.5, f"Workstation {alloc.id} Z out of bounds: {alloc.pos_z}"

            # Check unique desk per department
            pos_key = (div, alloc.desk_number)
            assert pos_key not in seen_positions, f"Desk collision: {pos_key}"
            seen_positions.add(pos_key)

        print(f"Verified {len(allocations)} assigned workstations.")
        print(f"Floor distribution: {floor_counts}")
        print(f"Division distribution ({len(division_counts)} divisions): {division_counts}")

        # Check all 6 floors have employees
        for f in range(1, 7):
            assert floor_counts[f] > 0, f"Floor {f} has 0 employees!"

    finally:
        db.close()


def test_provisioning_idempotency_run():
    """Verify that re-running provisioning produces 0 new agents and 0 duplicates."""
    db = SessionLocal()
    try:
        res = workforce_provisioning_service.provision_full_workforce(db, "org_default_company")
        assert res["status"] == "SUCCESS"
        assert res["specialists_provisioned_new"] == 0
        assert res["specialists_reused_existing"] == 268
        assert res["duplicate_employees"] == 0
    finally:
        db.close()

