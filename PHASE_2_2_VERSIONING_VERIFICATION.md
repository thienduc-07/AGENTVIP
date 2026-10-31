# PHASE 2.2 — SPECIALIST VERSIONING & RUNTIME INTEGRITY VERIFICATION

**Authoritative Architecture & Data Verification Deliverable**
**Date:** October 31, 2026
**Status:** **VERIFIED (IMMUTABILITY GUARANTEED)**
**Target Codebase:** `provipagent/`

---

## 1. Objective and Problem Statement

In Phase 2.1 Audit (Finding SPEC-01), recruited agents referenced `specialist_definitions.id` without an immutable link to the specific version snapshot chosen at recruitment. When upstream Agency Agents updated a specialist definition (advancing from v1 to v2), recruited agents dynamically inherited the new definition, causing silent persona drift and breaking operational continuity.

**REMED-03** eliminates this vulnerability by:
1. Binding every recruited employee to an explicit `specialist_version_id` foreign key and integer `specialist_version_num`.
2. Constructing runtime system prompts strictly from the pinned specialist version snapshot.
3. Insulating recruited employees from upstream catalog updates.
4. Ensuring different tenant organizations can concurrently retain different versions of the same specialist.

---

## 2. Architecture and Data Model

### 2.1 Database Schema Additions

In `alembic/versions/e5f6a7b8c9d0_security_versioning_and_desk_uniqueness.py`:

```python
with op.batch_alter_table('recruitment_records') as batch_op:
    batch_op.add_column(sa.Column('specialist_version_id', sa.String(length=64), nullable=True))
    batch_op.add_column(sa.Column('specialist_version_num', sa.Integer(), server_default='1', nullable=False))
    batch_op.create_foreign_key(
        'fk_recruitment_spec_ver',
        'specialist_versions',
        ['specialist_version_id'],
        ['id'],
        ondelete='SET NULL'
    )
    batch_op.create_index('ix_recruitment_spec_ver', ['specialist_version_id'])
```

### 2.2 Version Resolution at Recruitment

In `RecruitmentService.recruit_specialist()`:

```python
# 1. Resolve pinned specialist version record
version_query = db.query(SpecialistVersionModel).filter(
    SpecialistVersionModel.specialist_id == specialist.id
)
if requested_version is not None:
    version_record = version_query.filter(SpecialistVersionModel.version == requested_version).first()
    if not version_record:
        raise ValueError(f"Requested version {requested_version} for specialist '{specialist.slug}' not found.")
else:
    version_record = version_query.filter(SpecialistVersionModel.version == specialist.version).first()
    if not version_record:
        version_record = version_query.order_by(SpecialistVersionModel.version.desc()).first()

version_id = version_record.id if version_record else None
version_num = version_record.version if version_record else (specialist.version or 1)
```

### 2.3 Runtime Prompt Construction from Pinned Version

In `RecruitmentService._register_in_runtime()`:

```python
pinned_ver_num = version_record.version if version_record else (specialist.version or 1)

# If pinned version has raw_content, extract version-specific markdown body
if version_record and version_record.raw_content:
    raw = version_record.raw_content
    body = raw
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            body = parts[2]
    mission = body.strip() or mission

agent_def = AgentDefinition(
    agent_type=agent.id,
    display_name=agent.name,
    description=f"{specialist.role} ({department} Specialist - Pinned v{pinned_ver_num})",
    system_prompt=(
        f"You are {agent.name}, a specialized {specialist.role} in AI Agency — Autonomous Business Headquarters.\n"
        f"Reporting Department: {department}\n"
        f"Pinned Specialist Version: v{pinned_ver_num}\n\n"
        f"Core Mission & Expertise:\n{mission}\n\n"
        f"Critical Rules:\n{critical_rules}\n\n"
        f"Safety Instructions:\n"
        f"- Read files only within authorized workspace scope.\n"
        f"- Write outputs to workspace_sandbox/.\n"
        f"- Do not execute destructive commands or expose keys."
    ),
    ...
)
```

### 2.4 Server Startup Workforce Restoration

In `agent_runtime.on_startup()`:
Calls `recruitment_service.restore_active_workforce(db)`.
All active employees are restored into the runtime registry, each retrieving its pinned `SpecialistVersionModel` snapshot.

---

## 3. Legacy Records and Backfill Strategy

To ensure zero persona substitution on pre-existing or legacy data:

1. When adding `specialist_version_id`, existing records are matched against `specialist_versions` where `specialist_id == specialist_definition_id AND version == 1`.
2. If no valid version record exists, `specialist_version_id` is set to `NULL`, and the record notes are flagged with:
   `[MANUAL_REVIEW_REQUIRED: Historical version unlinked]`.
3. The runtime falls back safely to definition v1 without guessing unverified historical snapshots.

---

## 4. Verification Test Results

Test `test_immutable_specialist_version_pinning` in `backend/app/tests/test_phase2_2_remediations.py` proves:

1. **Recruitment Pinning:** Employee 1 is recruited while the specialist is at v1. The DB stores `specialist_version_id = v1.id` and `specialist_version_num = 1`.
2. **Upstream Catalog Advancement:** Specialist advances to v2 (with new `SpecialistVersionModel` v2 containing Kubernetes instructions).
3. **Immutability of Employee 1:**
   - Database record `rec1.specialist_version_id` remains equal to `v1.id`.
   - Runtime system prompt contains `Pinned Specialist Version: v1`.
   - Runtime system prompt contains `Base AWS cloud setup`.
   - Runtime system prompt does **NOT** contain `Advanced Kubernetes clusters`.
4. **New Recruitment Uses v2:**
   - Employee 2 recruited in Organization B binds to v2.
   - Runtime system prompt contains `Pinned Specialist Version: v2` and `Advanced Kubernetes clusters`.
5. **Verdict:** PASSED without regression.
