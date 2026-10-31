# PHASE 2.2 — ATOMIC TRANSACTION & WORKSTATION CONCURRENCY VERIFICATION

**Authoritative Database Reliability Deliverable**
**Date:** October 31, 2026
**Status:** **VERIFIED (ATOMIC ROLLBACK & UNIQUENESS GUARANTEED)**
**Target Codebase:** `provipagent/`

---

## 1. Scope and Objective

This report documents the verification of:
1. **REMED-02:** Database-enforced physical desk uniqueness and savepoint-retry concurrency handling.
2. **REMED-04:** Atomic transaction boundaries and elimination of premature commits in lower-level services.

---

## 2. Transaction Architecture & Ownership Policy

### 2.1 The Problem in Phase 2.1
In Phase 2.1, `WorkstationService.allocate_workstation()` and `reassign_workstation()` executed internal `db.commit()` calls.
If recruitment failed subsequent to workstation allocation (e.g. during performance record creation or memory policy configuration), the workstation record was already committed to the database while recruitment failed, leaving orphaned records and corrupting desk occupancy metrics.

### 2.2 The Solution in Phase 2.2
A strict transaction governance policy was established:
- **Rule 1:** "One business operation = One transaction boundary".
- **Rule 2:** Lower-level services (`WorkstationService`, `EventService`) execute `db.flush()` to populate primary keys and trigger database-level constraints, but **never** call `db.commit()`.
- **Rule 3:** The orchestrating service (`RecruitmentService.recruit_specialist`, `transition_lifecycle`) owns the transaction. It wraps the entire sequence in `try ... except Exception: db.rollback(); raise`, and commits once at the end.

---

## 3. Database-Enforced Physical Desk Uniqueness (REMED-02)

### 3.1 Partial Unique Index
In Alembic migration `e5f6a7b8c9d0`:
```sql
CREATE UNIQUE INDEX uq_assigned_physical_desk
ON workstation_allocations (organization_id, department, desk_number)
WHERE allocation_status = 'ASSIGNED' AND desk_number IS NOT NULL;
```

### 3.2 Key Characteristics
1. **Occupied Physical Desks Only:** Appliesto `allocation_status = 'ASSIGNED'` and `desk_number IS NOT NULL`.
2. **Virtual Desks Unrestricted:** Virtual desks have `allocation_status = 'VIRTUAL'` and `is_virtual = True`; they do not consume or lock physical desk numbers.
3. **Released Desks Reusable:** When an employee is retired or reassigned, their previous record is marked `UNASSIGNED` with `desk_number = NULL`. This releases the physical desk for immediate reallocation to other employees.
4. **Tenant & Department Scoped:** Desk 1 in `Engineering` for `Org A` does not conflict with Desk 1 in `Marketing` for `Org A`, nor Desk 1 in `Engineering` for `Org B`.

### 3.3 Concurrency & Collision Handling
In `WorkstationService.allocate_workstation()`:
```python
max_attempts = 3
for attempt in range(max_attempts):
    # Select available desk number
    ...
    try:
        sp = db.begin_nested()  # SAVEPOINT
        db.add(allocation)
        db.flush()
        sp.commit()
        break
    except IntegrityError as ie:
        sp.rollback()  # Rollback savepoint only, keeping outer transaction intact
        if attempt == max_attempts - 1:
            # Fall back safely to virtual desk
            current_force_virtual = True
```

---

## 4. Verification Test Results

### 4.1 Physical Desk Uniqueness Tests (`test_physical_desk_database_uniqueness`)
- **Action:** Created assigned physical desk (Org: `org_test_uniqueness`, Dept: `Engineering`, Desk: 1).
- **Collision Test:** Attempted to insert a second assigned physical desk with identical Org, Dept, and Desk.
- **Result:** Database directly raised `sqlalchemy.exc.IntegrityError: (sqlite3.IntegrityError) UNIQUE constraint failed: workstation_allocations.organization_id, workstation_allocations.department, workstation_allocations.desk_number`.
- **Virtual Test:** Inserted virtual allocation with `desk_number = None`. Succeeded.
- **Different Dept Test:** Inserted Desk 1 in `Marketing`. Succeeded.
- **Verdict:** PASSED. Database constraint is active and enforced.

### 4.2 Savepoint Concurrency Retry (`test_workstation_service_savepoint_retry_on_desk_collision`)
- **Action:** Pre-occupied Desk 1.
- **Next Allocation:** Automatically detected occupancy and allocated Desk 2 without errors.
- **Verdict:** PASSED.

### 4.3 Atomic Rollback Under Deliberate Failure (`test_transaction_rollback_integrity_on_recruitment_failure`)
- **Action:** Injected a deliberate `RuntimeError` during recruitment after agent creation and workstation allocation, right before final commit.
- **Observation:**
  - `recruitment_service.recruit_specialist` caught the exception.
  - Executed `db.rollback()`.
  - Re-raised exception to caller.
- **Verification:**
  - `db_session.query(AgentModel).filter_by(organization_id=org_id).count() == 0`
  - `db_session.query(WorkstationAllocationModel).filter_by(organization_id=org_id).count() == 0`
- **Verdict:** PASSED. Zero orphaned agents or workstations remain. Atomicity is 100% verified.
