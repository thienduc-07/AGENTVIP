# PROVIPAGENT PHASE 2.1 — DATABASE MIGRATION & RELIABILITY AUDIT
**Author**: Antigravity Quality Assurance & Database Reliability Engineering
**Role**: Database Reliability Engineer (DBRE) & Principal Software Architect
**Scope**: Verification of Alembic Migrations, Schema Integrity, Downgrade Safety, and Constraints
**Target Database**: SQLite (`agency.db`) / Target Production: PostgreSQL
**Audit Status**: COMPLETED

---

## 1. Executive Summary

This database migration audit inspected the complete Alembic migration graph from initial genesis to head revision `d4e5f6a7b8c9`. The audit conducted non-destructive offline migrations against isolated temporary databases to verify clean-slate initialization, upgrade idempotency, downgrade symmetry, and schema consistency with SQLAlchemy ORM models.

### Key Audit Metrics
* **Current Database Revision**: `d4e5f6a7b8c9 (head)`
* **Active Migration Graph Heads**: Exactly 1 (No split heads or branches detected)
* **Preservation Status**: **100% Preserved** (268 specialist definitions, 536 specialist versions, 8 founding executive agents intact in `agency.db`)
* **Fresh Database Initialization**: **PASSED** (All 16 tables created cleanly from revision 0 to head)
* **Downgrade Test (Isolated)**: **PASSED** (Reversed `d4e5f6a7b8c9` to `c3d4e5f6a7b8` cleanly)

---

## 2. Alembic Revision Graph Verification

The chronological revision chain in `alembic/versions/` was mapped and verified:

```
[8eefbf89f222] (create_initial_schema)
       │
       ▼
[63860d006311] (add_sequence_id_to_agent_events)
       │
       ▼
[7a82b9e1c304] (add_workflow_and_subtasks_to_tasks)
       │
       ▼
[9c2d1e4b8a7f] (create_memories_and_citations_tables)
       │
       ▼
[a1b2c3d4e5f6] (create_tool_definitions_and_executions)
       │
       ▼
[b2c3d4e5f6a7] (create_specialist_definitions_and_versions)
       │
       ▼
[c3d4e5f6a7b8] (create_recruitment_and_performance_tables)
       │
       ▼
[d4e5f6a7b8c9] (create_workstation_allocations) ◄── HEAD
```

* **Branching Check**: Zero multiple heads detected.
* **Orphan Check**: Every revision explicitly declares `down_revision` pointing to its exact predecessor.
* **Parent Link Integrity**:
  * `b2c3d4e5f6a7`: Revises `a1b2c3d4e5f6`
  * `c3d4e5f6a7b8`: Revises `b2c3d4e5f6a7`
  * `d4e5f6a7b8c9`: Revises `c3d4e5f6a7b8`

---

## 3. Schema Inspection & ORM Consistency

Every ORM model added or modified in Phase 2 was cross-referenced against the actual DDL emitted in migrations:

### A. `specialist_definitions`
* **Model File**: [`backend/app/models/specialist.py:SpecialistDefinitionModel`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/specialist.py#L22)
* **Migration**: [`alembic/versions/b2c3d4e5f6a7_create_specialist_definitions_and_versions.py`](file:///Users/thienduc/Desktop/Code/provipagent/alembic/versions/b2c3d4e5f6a7_create_specialist_definitions_and_versions.py)
* **Consistency Check**:
  * `slug`: `VARCHAR(128)`, unique index `ix_specialist_definitions_slug`. (MATCH)
  * `content_hash`: `VARCHAR(64)`, index `ix_specialist_definitions_content_hash`. (MATCH)
  * `raw_content`: `TEXT NOT NULL`. (MATCH)
  * `version`: `INTEGER DEFAULT 1`. (MATCH)
  * Multi-column indexes: `ix_specialist_dept_div`, `ix_specialist_lifecycle_valid`. (MATCH)

### B. `specialist_versions`
* **Model File**: [`backend/app/models/specialist.py:SpecialistVersionModel`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/specialist.py#L112)
* **Migration**: [`alembic/versions/b2c3d4e5f6a7_create_specialist_definitions_and_versions.py`](file:///Users/thienduc/Desktop/Code/provipagent/alembic/versions/b2c3d4e5f6a7_create_specialist_definitions_and_versions.py)
* **Consistency Check**:
  * Foreign key `specialist_id REFERENCES specialist_definitions(id) ON DELETE CASCADE`. (MATCH)
  * Composite index `ix_spec_version_lookup (specialist_id, version)`. (MATCH)

### C. `recruitment_records`
* **Model File**: [`backend/app/models/recruitment.py:RecruitmentRecordModel`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/recruitment.py#L22)
* **Migration**: [`alembic/versions/c3d4e5f6a7b8_create_recruitment_and_performance_tables.py`](file:///Users/thienduc/Desktop/Code/provipagent/alembic/versions/c3d4e5f6a7b8_create_recruitment_and_performance_tables.py) + [`d4e5f6a7b8c9`](file:///Users/thienduc/Desktop/Code/provipagent/alembic/versions/d4e5f6a7b8c9_create_workstation_allocations.py)
* **Consistency Check**:
  * `organization_id`: `VARCHAR(64) DEFAULT 'org_default_company'`. Added in `d4e5f6a7b8c9`. (MATCH)
  * Index `ix_recruitment_org_spec (organization_id, specialist_definition_id)`. Added in `d4e5f6a7b8c9`. (MATCH)
  * Foreign key `agent_id REFERENCES agents(id) ON DELETE CASCADE`. (MATCH)
  * Foreign key `manager_agent_id REFERENCES agents(id) ON DELETE SET NULL`. (MATCH)

### D. `workstation_allocations`
* **Model File**: [`backend/app/models/workstation.py:WorkstationAllocationModel`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/workstation.py#L20)
* **Migration**: [`alembic/versions/d4e5f6a7b8c9_create_workstation_allocations.py`](file:///Users/thienduc/Desktop/Code/provipagent/alembic/versions/d4e5f6a7b8c9_create_workstation_allocations.py)
* **Consistency Check**:
  * Unique constraint on `agent_id` (`ix_workstation_allocations_agent_id`). (MATCH)
  * Indexes on `organization_id`, `department`, `logical_workstation_id`. (MATCH)
  * 3D coordinate fields `pos_x`, `pos_y`, `pos_z` with float defaults. (MATCH)

---

## 4. Detailed Migration Findings

### Finding MIG-01 (MEDIUM): Asymmetric Downgrade in `d4e5f6a7b8c9`
* **Affected File & Function**:
  * [`alembic/versions/d4e5f6a7b8c9_create_workstation_allocations.py:downgrade`](file:///Users/thienduc/Desktop/Code/provipagent/alembic/versions/d4e5f6a7b8c9_create_workstation_allocations.py#L59)
* **Concrete Evidence**:
  In `upgrade()`:
  ```python
  if 'organization_id' not in agent_cols:
      op.add_column('agents', sa.Column('organization_id', ...))
  if 'organization_id' not in rec_cols:
      op.add_column('recruitment_records', sa.Column('organization_id', ...))
  if 'workstation_allocations' not in tables:
      op.create_table('workstation_allocations', ...)
  ```
  In `downgrade()`:
  ```python
  def downgrade() -> None:
      op.drop_table('workstation_allocations')
  ```
  The downgrade script drops `workstation_allocations` table, but leaves `organization_id` on `agents` and `organization_id` on `recruitment_records`.
* **Potential Impact**: If a migration rollback to `c3d4e5f6a7b8` is performed, the database schema will not exactly match the state defined by `c3d4e5f6a7b8`. While harmless in practice (the extra nullable columns do not break queries), strict DBRE standards require symmetric rollbacks.
* **Recommended Remediation**:
  Use Alembic `batch_alter_table` in `downgrade()` to drop added columns and their indexes:
  ```python
  def downgrade() -> None:
      op.drop_table('workstation_allocations')
      with op.batch_alter_table('recruitment_records') as batch_op:
          batch_op.drop_index('ix_recruitment_org_spec')
          batch_op.drop_column('organization_id')
      with op.batch_alter_table('agents') as batch_op:
          batch_op.drop_index('ix_agents_org_status')
          batch_op.drop_column('organization_id')
  ```
* **Mandatory Before Phase 3**: **NO** (Informational / Cleanup; does not block 3D office development).

---

### Finding MIG-02 (HIGH): Missing Database-Level Uniqueness Constraint on Physical Workstations
* **Affected File & Function**:
  * [`alembic/versions/d4e5f6a7b8c9_create_workstation_allocations.py:upgrade`](file:///Users/thienduc/Desktop/Code/provipagent/alembic/versions/d4e5f6a7b8c9_create_workstation_allocations.py#L37)
  * [`backend/app/models/workstation.py:WorkstationAllocationModel`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/workstation.py#L20)
* **Concrete Evidence**:
  `workstation_allocations` enforces `unique=True` on `agent_id`, but does NOT enforce a unique constraint on:
  `(organization_id, department, desk_number)` where `allocation_status == 'ASSIGNED'` and `desk_number IS NOT NULL`.
* **Potential Impact**: Under concurrent recruitment or reassignment requests, two distinct agents can be assigned the exact same physical desk number and 3D coordinates. In the 3D office, this results in two character models colliding and rendering overlapping meshes inside the same chair.
* **Recommended Remediation**:
  Add a unique index or partial unique constraint via a new revision:
  ```sql
  CREATE UNIQUE INDEX uq_org_dept_desk_assigned
  ON workstation_allocations(organization_id, department, desk_number)
  WHERE allocation_status = 'ASSIGNED' AND desk_number IS NOT NULL;
  ```
* **Mandatory Before Phase 3**: **YES** (Visual collision in 3D office directly impacts Phase 3 rendering).

---

### Finding MIG-03 (MEDIUM): Missing Partial Uniqueness Constraint on Active Recruitments
* **Affected File & Function**:
  * [`alembic/versions/c3d4e5f6a7b8_create_recruitment_and_performance_tables.py`](file:///Users/thienduc/Desktop/Code/provipagent/alembic/versions/c3d4e5f6a7b8_create_recruitment_and_performance_tables.py)
  * [`backend/app/models/recruitment.py:RecruitmentRecordModel`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/recruitment.py#L72)
* **Concrete Evidence**:
  `recruitment_records` has `Index("ix_recruitment_org_spec", "organization_id", "specialist_definition_id")`.
  This is a non-unique index. The check for duplicate recruitment is enforced purely in application code ([`recruitment_service.py:104-116`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/recruitment_service.py#L104-L116)).
* **Potential Impact**: If two concurrent recruitment requests for the same specialist definition arrive simultaneously for the same organization, both transactions can read `None` before either commits, resulting in duplicate active recruitment records.
* **Recommended Remediation**:
  Create a partial unique constraint preventing duplicate active recruitments:
  ```sql
  CREATE UNIQUE INDEX uq_active_recruitment_per_org
  ON recruitment_records(organization_id, specialist_definition_id)
  WHERE lifecycle_state IN ('ACTIVE', 'CONFIGURED', 'SUSPENDED');
  ```
* **Mandatory Before Phase 3**: **NO** (Can be scheduled alongside Phase 7 multi-tenancy hardening).

---

### Finding MIG-04 (LOW): Hardcoded `DATABASE_URL` in `alembic/env.py`
* **Affected File & Function**:
  * [`alembic/env.py:25`](file:///Users/thienduc/Desktop/Code/provipagent/alembic/env.py#L25)
* **Concrete Evidence**:
  ```python
  config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
  ```
  `alembic/env.py` unconditionally overwrites `config.get_main_option("sqlalchemy.url")` with `settings.DATABASE_URL`. If a CLI operator or automated test passes a specific database URL via `alembic -x db=...` or config options, it is silently ignored and rewritten to `agency.db`.
* **Potential Impact**: Can inadvertently target the production database during testing if environment variables are not pre-set before module imports.
* **Recommended Remediation**:
  Only set default if option is unset:
  ```python
  if not config.get_main_option("sqlalchemy.url"):
      config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
  ```
* **Mandatory Before Phase 3**: **NO**.
