# PHASE 2.2.2 SPECIALIST VERSION SNAPSHOT & IMMUTABILITY SPECIFICATION

**Document Identifier**: `PHASE_2_2_2_SPECIALIST_VERSION_SNAPSHOT.md`
**Related Findings**: **VER-02 (P1 High)**, **VER-03 (P1 High)**
**Verification Suite**: [test_phase2_2_2_verification.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/tests/test_phase2_2_2_verification.py)
**Status**: VERIFIED & CLOSED

---

## 1. Executive Summary

Findings **VER-02** and **VER-03** addressed version clarity and snapshot immutability:
1. **VER-02**: Legacy recruitment records with `specialist_version_id IS NULL` lacked explicit visibility and safe handling, risking silent runtime errors or unvetted behavior.
2. **VER-03**: Specialist runtime configurations (tools, permissions, rules, metadata) were partly derived dynamically from mutable definitions rather than stored as immutable versioned snapshots. Furthermore, upstream markdown files had the potential to inject unauthorized permission grants.

Phase 2.2.2 establishes structured, immutable version snapshots, adds explicit legacy tracking with administrative visibility, and enforces strict separation between capability definitions and authorization grants.

---

## 2. Immutable Configuration Snapshots (VER-03)

### 2.1 Schema Enhancement
In [models/specialist.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/specialist.py):
Added `parsed_metadata = Column(JSON, nullable=True)` to `SpecialistVersionModel`.

### 2.2 Captured Snapshot Structure
When specialists are imported via [agency_agent_importer.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/agency_agent_importer.py) or synchronized via [agency_agent_synchronizer.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/agency_agent_synchronizer.py), `parsed_metadata` captures an immutable structured dictionary:
```json
{
  "system_instructions": "Exact prompt at time of version creation...",
  "assigned_tools": ["workspace_list", "workspace_write", "document_create"],
  "permission_level": 1,
  "critical_rules": [
    "Never bypass approval gates",
    "Preserve sandbox filesystem boundaries"
  ],
  "source_path": "specialists/engineering/backend-architect.md",
  "content_hash": "sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069"
}
```

### 2.3 Immutability & Content Hash Rules
1. Existing version snapshot records are **never mutated**.
2. Any modification to an upstream specialist's markdown file, instructions, tools, or metadata changes its SHA-256 hash.
3. During catalog synchronization, a hash change creates a **new version row** (`version_num + 1`) with its own independent snapshot.
4. Existing employees pinned to earlier versions remain completely unaffected.

### 2.4 Separation of Capabilities and Permissions
A specialist's upstream markdown definition may specify recommended tools (e.g. `workspace_write`), but it **cannot grant platform-level or organization-level permissions**:
- Specialist capability definitions represent *what the agent knows how to do*.
- Organization permission profiles (e.g., `LEVEL_0_READONLY`, `LEVEL_1_WORKSPACE_WRITE`) dictate *what the tenant allows the agent to execute*.
- If an upstream markdown file attempts to declare `"permission_profile": "SUPERADMIN"`, the synchronizer sanitizer discards it, maintaining tenant governance.

---

## 3. Legacy Version Visibility & Administrative Review (VER-02)

### 3.1 Historical Records Preservation
Historical recruitment records where `specialist_version_id IS NULL` were preserved without guessing or retroactively assigning random versions.

### 3.2 Schema & Execution Guard
1. **Database Column**: Added `is_legacy_unpinned = Column(Boolean, default=False, nullable=False)` to `RecruitmentRecordModel` in [models/recruitment.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/recruitment.py).
2. **Execution Blocking**:
   In [dispatcher.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/agent_runtime/dispatcher/dispatcher.py) and [task_service.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/task_service.py):
   - Tasks cannot be assigned to an employee with `is_legacy_unpinned == True` or `specialist_version_id IS NULL`.
   - Dispatcher immediately cancels any queued tasks with:
     `"Task execution rejected: employee '{id}' has an unpinned legacy version."`
3. **Administrative Audit Endpoint**:
   In [endpoints/recruitment.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/api/v1/endpoints/recruitment.py):
   Added `GET /api/v1/recruitment/legacy-audit` (restricted to `ADMIN` and `OWNER` roles).
   Returns a tenant-scoped report detailing:
   - Total recruited employees.
   - Count of unpinned legacy employees.
   - List of unpinned records with agent ID, department, recruitment date, and diagnostic status.

---

## 4. Automated Test Evidence

| Test Function | Verification Scenario | Expected Outcome | Result |
| :--- | :--- | :--- | :--- |
| `test_specialist_version_parsed_metadata_snapshot` | Inspects `parsed_metadata` JSON snapshot on `SpecialistVersionModel` | Contains immutable tools, rules, and system instructions | **PASSED** |
| `test_markdown_cannot_grant_platform_or_tenant_privileges` | Malicious markdown declaring root platform permissions | Ignored; runtime strictly applies tenant permission profile | **PASSED** |
| `test_unpinned_legacy_employee_execution_blocked` | Task dispatched to employee with `is_legacy_unpinned=True` | Task cancelled; error message cites unpinned legacy version | **PASSED** |
| `test_legacy_audit_endpoint` | `GET /api/v1/recruitment/legacy-audit` | Returns structured audit report identifying unpinned records | **PASSED** |

Version clarity and snapshot immutability are fully enforced across the catalog and runtime.
