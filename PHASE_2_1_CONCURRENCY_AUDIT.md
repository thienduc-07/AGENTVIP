# PROVIPAGENT PHASE 2.1 — CONCURRENCY & WORKSTATION ALLOCATION AUDIT
**Author**: Antigravity Quality Assurance & Concurrency Engineering
**Role**: Senior Backend Engineer & Database Reliability Engineer
**Scope**: Verification of Workstation Allocations, Concurrency Safety, Race Conditions, and Transaction Boundaries
**Target Services**: `WorkstationService`, `RecruitmentService`
**Audit Status**: COMPLETED

---

## 1. Executive Summary

This audit evaluated the concurrency safety and transaction atomicity of the Dynamic Desk Slot Allocator (`WorkstationService`) and `RecruitmentService`. Specifically, the audit tested for race conditions under concurrent recruitment, physical desk collision vulnerability, transaction boundary consistency, and virtual capacity overflow behavior.

### Concurrency Audit Summary Matrix

| Evaluation Criteria | Verdict | Audit Finding |
| :--- | :--- | :--- |
| **1. Concurrent recruitment cannot allocate the same physical desk?** | **FAIL (HIGH RISK)** | `WorkstationService` performs an un-locked read of `occupied_desks` before calculating the lowest available desk number. Without database-level uniqueness on `(organization_id, department, desk_number)`, concurrent requests in multi-worker environments can allocate duplicate desks. |
| **2. Concurrent reassignment cannot corrupt allocations?** | **FAIL (MEDIUM RISK)** | `reassign_workstation` performs non-atomic multi-table updates (`WorkstationAllocationModel`, `AgentModel`, `RecruitmentRecordModel`) without row-level locking (`with_for_update()`). |
| **3. Retirement releases the correct workstation?** | **PASSED** | Verified. `release_workstation` clears `desk_number` and transitions status to `UNASSIGNED`, immediately freeing the physical slot for subsequent recruits. |
| **4. Virtual allocations do not accidentally reserve physical desks?** | **PASSED** | Verified. `occupied_desks` filters strictly by `allocation_status == 'ASSIGNED'`, preventing virtual overflow records from blocking physical desks. |
| **5. Database uniqueness constraints protect against race conditions?** | **PARTIAL** | `agent_id` is unique in `workstation_allocations`. However, there is no database-level unique constraint on physical desk positions or active recruitment records. |
| **6. Transaction rollback restores consistent state after failures?** | **FAIL (HIGH RISK)** | `allocate_workstation()` prematurely calls `db.commit()` internally. If a subsequent step in `recruit_specialist()` fails, the database cannot roll back the allocation, leaving an orphaned workstation record. |

---

## 2. Detailed Concurrency Findings

### Finding CONC-01 (HIGH): Race Condition in Dynamic Physical Desk Assignment
* **Affected File & Function**:
  * [`backend/app/services/workstation_service.py:allocate_workstation`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/workstation_service.py#L133-L159)
* **Concrete Evidence**:
  In `allocate_workstation`:
  ```python
  # 2. Query occupied desk numbers in this department for this organization
  occupied_desks = set(
      d[0]
      for d in db.query(WorkstationAllocationModel.desk_number)
      .filter(
          WorkstationAllocationModel.organization_id == organization_id,
          WorkstationAllocationModel.department == department,
          WorkstationAllocationModel.allocation_status == "ASSIGNED",
          WorkstationAllocationModel.desk_number.isnot(None),
      )
      .all()
  )
  # Find lowest available physical desk number 1..max_phys
  for n in range(1, max_phys + 1):
      if n not in occupied_desks:
          desk_num = n
          break
  ```
  **Race Window**: In a production deployment running multiple Gunicorn/Uvicorn workers, two concurrent recruitment requests for the same department execute the `occupied_desks` query simultaneously before either inserts their record.
  1. Worker 1 reads `occupied_desks = {1, 2}` -> selects `desk_num = 3`.
  2. Worker 2 reads `occupied_desks = {1, 2}` -> selects `desk_num = 3`.
  3. Worker 1 inserts allocation for Desk 3.
  4. Worker 2 inserts allocation for Desk 3.
  Because the database lacks a uniqueness constraint on `(organization_id, department, desk_number)` for assigned physical desks, both inserts succeed.
* **Potential Impact**:
  In the 3D corporate office (Phase 3), two distinct agent avatars will be placed at identical `(pos_x, pos_y, pos_z)` coordinates, causing mesh Z-fighting, overlapping character models, and visual corruption.
* **Recommended Remediation**:
  1. Add a partial unique index in Alembic:
     ```sql
     CREATE UNIQUE INDEX uq_assigned_physical_desk
     ON workstation_allocations(organization_id, department, desk_number)
     WHERE allocation_status = 'ASSIGNED' AND desk_number IS NOT NULL;
     ```
  2. In `allocate_workstation()`, handle `IntegrityError` by retrying desk selection or catching collision.
* **Mandatory Before Phase 3**: **YES** (Directly impacts Phase 3 3D character positioning).

---

### Finding CONC-02 (HIGH): Premature Sub-Transaction Commit in Workstation Allocator
* **Affected File & Function**:
  * [`backend/app/services/workstation_service.py:allocate_workstation`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/workstation_service.py#L222)
  * [`backend/app/services/recruitment_service.py:recruit_specialist`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/recruitment_service.py#L210-L230)
* **Concrete Evidence**:
  In `workstation_service.allocate_workstation`:
  ```python
  db.add(allocation)
  db.commit()      # <--- Premature commit inside utility service!
  db.refresh(allocation)
  return allocation
  ```
  In `recruitment_service.recruit_specialist`:
  ```python
  # Step 4: Allocate workstation
  ws_alloc = workstation_service.allocate_workstation(db=db, ...)
  # Step 5: Register runtime, fire WebSocket broadcasts, assemble return payload
  self._register_in_runtime(agent, specialist, dept)
  self._broadcast_event(...)
  ```
  Because `allocate_workstation()` commits early, the recruitment process loses its atomic transaction boundary. If an unhandled exception occurs after `allocate_workstation()` (e.g. in WebSocket broadcast, event logger, or database connection drop), the agent record and workstation record remain committed, but `recruitment_records` or event streams may be incomplete.
* **Potential Impact**: Database inconsistency, orphaned workstations with incomplete recruitment records upon transient failure.
* **Recommended Remediation**:
  Remove `db.commit()` from `workstation_service.allocate_workstation()` and `reassign_workstation()`. Use `db.flush()` inside sub-services and commit exclusively at the outer service boundary (`recruitment_service`).
* **Mandatory Before Phase 3**: **YES**.

---

### Finding CONC-03 (MEDIUM): Application-Level Duplicate Recruitment Race Condition
* **Affected File & Function**:
  * [`backend/app/services/recruitment_service.py:recruit_specialist`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/recruitment_service.py#L104-L116)
* **Concrete Evidence**:
  ```python
  existing_recruitment = (
      db.query(RecruitmentRecordModel)
      .filter(
          RecruitmentRecordModel.specialist_definition_id == specialist.id,
          RecruitmentRecordModel.organization_id == organization_id,
          RecruitmentRecordModel.lifecycle_state.in_(["ACTIVE", "CONFIGURED", "SUSPENDED"]),
      )
      .first()
  )
  if existing_recruitment:
      raise ValueError(...)
  ```
  This duplicate check is purely application-level. In standard SQL isolation levels (Read Committed), two concurrent requests recruiting the same specialist template in the same organization will both execute the `SELECT` query, both find `existing_recruitment = None`, and both proceed to recruit duplicate active employees.
* **Potential Impact**: An organization can end up with multiple active instances of the same specialist definition, violating organization business rules.
* **Recommended Remediation**:
  Add a partial unique constraint in the database:
  ```sql
  CREATE UNIQUE INDEX uq_active_recruitment_per_org
  ON recruitment_records(organization_id, specialist_definition_id)
  WHERE lifecycle_state IN ('ACTIVE', 'CONFIGURED', 'SUSPENDED');
  ```
* **Mandatory Before Phase 3**: **NO** (Can be addressed in Phase 7 SaaS hardening).

---

### Finding CONC-04 (INFORMATIONAL): Verification of Virtual Overflow & Retirement Deallocation
* **Affected File & Function**:
  * [`backend/app/services/workstation_service.py:155-177`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/workstation_service.py#L155-L177)
  * [`backend/app/services/workstation_service.py:280-288`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/workstation_service.py#L280-L288)
* **Verification Detail**:
  1. **Overflow Virtualization**: When recruitment exceeds physical desk capacity (e.g. recruit 8 agents in Operations where `max_physical_desks = 6`), agents 7 and 8 are seamlessly allocated virtual IDs (`vws-operations-7`, `vws-operations-8`) with status `VIRTUAL` and `is_virtual = True`. No crash or database constraint failure occurs.
  2. **Retirement Deallocation**: When an agent transitions to `RETIRED`, `workstation_service.release_workstation()` immediately marks `allocation_status = 'UNASSIGNED'` and nulls `desk_number`. Subsequent recruitments re-use the vacated physical desk slot.
* **Verdict**: **PASSED**.
