# PROVIPAGENT PHASE 2.1 — SPECIALIST DATA INTEGRITY & VERSION AUDIT
**Author**: Antigravity Quality Assurance & Architecture Review
**Role**: Principal Software Architect & Senior Backend Engineer
**Scope**: Specialist Definitions, Version Immutability, Upstream Synchronization, and Persona Stability
**Target Entities**: `SpecialistDefinitionModel`, `SpecialistVersionModel`, `RecruitmentRecordModel`, `AgentModel`, `AgencyAgentSynchronizer`, `SpecialistIntegrityChecker`
**Audit Status**: COMPLETED

---

## 1. Executive Summary

This audit conducted an in-depth code and schema inspection of specialist versioning, persona stability, and catalog synchronization. The audit verified whether the 268 specialist personas imported from Agency Agents remain immutable, whether customer employees are insulated from upstream changes, and whether version histories are correctly preserved.

### Core Audit Questions & Integrity Status

| Verification Criterion | Status | Concrete Finding |
| :--- | :--- | :--- |
| **1. Global catalog versions are immutable?** | **PARTIAL** | `SpecialistVersionModel` records are immutable snapshots. However, `SpecialistDefinitionModel` is updated in-place during sync, overwriting previous attributes on the template record. |
| **2. Updating upstream catalog does not silently alter existing recruited employees?** | **FAIL (CRITICAL)** | `RecruitmentRecordModel` stores only `specialist_definition_id` and does NOT pin `specialist_version`. When the global template is mutated in-place, the recruited employee references the new version. |
| **3. Recruited employees retain a stable reference to their selected specialist version?** | **FAIL (CRITICAL)** | There is no `specialist_version` column on `RecruitmentRecordModel` or `AgentModel`. |
| **4. Organizations can independently approve a specialist update?** | **FAIL (HIGH)** | Upstream synchronization updates the global catalog globally. There is no tenant-scoped approval mechanism for an organization to adopt or decline version updates. |
| **5. `REMOVED_UPSTREAM` never deletes local specialists?** | **PASSED** | Verified. Removed upstream markdown files are flagged with `validation_status="WARNING"`; local records are **never deleted**. |
| **6. Hash comparison uses the correct source content?** | **PASSED** | Verified. SHA-256 is computed against UTF-8 bytes of raw Markdown content in both `AgencyAgentImporter` and `AgencyAgentSynchronizer`. |
| **7. Duplicate slugs and conflicting records are handled safely?** | **PASSED** | Unique index `ix_specialist_definitions_slug` rejects duplicate slugs at database level. Upstream modified specialists with active recruitments are categorized as `CONFLICT`. |

---

## 2. Detailed Data Integrity Findings

### Finding DATA-01 (CRITICAL): Absence of Specialist Version Pinning in Recruited Records
* **Affected Files & Models**:
  * [`backend/app/models/recruitment.py:RecruitmentRecordModel`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/recruitment.py#L22)
  * [`backend/app/services/recruitment_service.py:recruit_specialist`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/recruitment_service.py#L90)
* **Concrete Evidence**:
  In `RecruitmentRecordModel`:
  ```python
  class RecruitmentRecordModel(Base):
      __tablename__ = "recruitment_records"
      id = Column(String(64), primary_key=True, default=generate_uuid)
      specialist_definition_id = Column(
          String(64),
          ForeignKey("specialist_definitions.id", ondelete="RESTRICT"),
          nullable=False,
          index=True
      )
      # NOTICE: NO specialist_version column exists!
  ```
  In `recruit_specialist()`:
  ```python
  recruitment = RecruitmentRecordModel(
      specialist_definition_id=specialist.id,
      agent_id=agent.id,
      department=dept,
      manager_agent_id=manager_id,
      ...
  )
  ```
  The recruitment record stores only `specialist_definition_id`. It does not record which version (`version=1`, `version=2`, etc.) the customer approved.
* **Potential Impact**:
  Direct violation of the core architectural requirement:
  *"If a recruited specialist uses an older version, preserve that version as its active configuration unless an administrator explicitly approves an update."*
  Because the recruitment record has no version foreign key, when an upstream sync updates `specialist_definitions`, any joins (e.g. in `/recruited`, `/hierarchy`, or task planners) implicitly read the latest template version.
* **Recommended Remediation**:
  1. Add `specialist_version: int` and `specialist_version_id: Optional[str]` to `RecruitmentRecordModel`.
  2. Pin `recruitment.specialist_version = specialist.version` at recruitment time.
  3. When assembling prompts or instructions, resolve instructions from `SpecialistVersionModel` matching the pinned version.
* **Mandatory Before Phase 3**: **YES** (Must be resolved before multi-agent runtime execution is wired to 3D office).

---

### Finding DATA-02 (HIGH): In-Place Mutation of Global Specialist Template Rows
* **Affected Files & Functions**:
  * [`backend/app/services/agency_agent_synchronizer.py:apply_sync`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/agency_agent_synchronizer.py#L311-L331)
* **Concrete Evidence**:
  ```python
  elif status in ("UPDATED", "CONFLICT"):
      new_version = local_spec.version + 1
      local_spec.version = new_version
      local_spec.name = parsed["name"]
      local_spec.role = parsed["role"]
      local_spec.system_instructions = parsed["system_instructions"]
      local_spec.core_mission = parsed["core_mission"]
      local_spec.critical_rules = parsed["critical_rules"]
      local_spec.content_hash = parsed["content_hash"]
      local_spec.raw_content = parsed["raw_content"]
  ```
  `SpecialistDefinitionModel` acts as a mutable head pointer rather than an immutable record. While an audit snapshot is saved to `SpecialistVersionModel`, any existing queries reading `SpecialistDefinitionModel` directly have their underlying data modified under their feet.
* **Potential Impact**:
  If a customer organization recruits "Principal Cloud Architect" v1, and upstream synchronizes v2 with altered instructions or tool permissions, the customer's active employee configuration is mutated without customer consent.
* **Recommended Remediation**:
  Treat `SpecialistVersionModel` as the authoritative source of persona content (`system_instructions`, `tools`, `rules`), and ensure recruited agents are bound to specific version IDs rather than mutating shared template rows.
* **Mandatory Before Phase 3**: **YES**.

---

### Finding DATA-03 (MEDIUM): Missing Server Startup Re-Hydration of Recruited Agents
* **Affected Files & Functions**:
  * [`backend/app/main.py:lifespan`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/main.py#L22)
  * [`backend/app/scripts/seed.py:seed_database`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/scripts/seed.py#L8)
* **Concrete Evidence**:
  During recruitment, [`recruitment_service._register_in_runtime()`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/recruitment_service.py#L250) registers the recruited agent in `default_agent_registry`:
  ```python
  default_agent_registry.register(agent_def)
  ```
  However, `default_agent_registry` is an in-memory dictionary. On server restart:
  1. `main.py` calls `seed_database()`, which registers only the 8 founding corporate executive agents (`agent-exec-ceo`, `agent-eng-lead`, etc.).
  2. No startup routine iterates through `recruitment_records` to re-register active recruited specialists.
* **Potential Impact**:
  After a server restart, all recruited specialists exist in the database, but attempts by `MultiAgentOrchestrator` to lookup `default_agent_registry.get(agent_id)` return `None` or raise an unhandled exception until the agent is re-recruited.
* **Recommended Remediation**:
  Add a re-hydration routine in `main.py` lifespan:
  ```python
  def rehydrate_recruited_agents(db: Session):
      records = db.query(RecruitmentRecordModel).filter(
          RecruitmentRecordModel.lifecycle_state.in_(["ACTIVE", "CONFIGURED"])
      ).all()
      for rec in records:
          recruitment_service._register_in_runtime(rec.agent, rec.specialist_definition, rec.department)
  ```
* **Mandatory Before Phase 3**: **NO** (Mandatory before Phase 4 Multi-Agent Runtime; does not block Phase 3 3D visualization).

---

### Finding DATA-04 (LOW): Dynamic Division Fallback Discrepancy
* **Affected Files & Functions**:
  * [`backend/app/services/recruitment_service.py:120`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/recruitment_service.py#L120)
* **Concrete Evidence**:
  ```python
  dept = department or specialist.department
  if not dept or dept not in DEPARTMENT_STATIONS:
      dept = "Operations"
  ```
  If an upstream specialist file introduces a new division (e.g. `legal` or `security`), the specialist catalog accepts it with validation status `VALID`, but recruitment silently forces the department to `"Operations"`.
* **Potential Impact**: Specialists in novel divisions cannot have custom department zones allocated unless `DEPARTMENT_STATIONS` and `ZONE_CONFIGS` are dynamically extensible.
* **Recommended Remediation**:
  Allow dynamic department registration or fallback to a general "Special Projects" zone rather than hardcoded "Operations".
* **Mandatory Before Phase 3**: **NO**.
