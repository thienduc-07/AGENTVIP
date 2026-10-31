# PROVIPAGENT — DATABASE ARCHITECTURE & TENANT ISOLATION SPECIFICATION
**Storage Engine**: SQLite (`agency.db`) / PostgreSQL (Production Target)
**ORM**: SQLAlchemy 2.0
**Migration Tool**: Alembic
**Preservation Rule**: Zero-Data-Loss, Non-Destructive Migrations Only

---

## 1. Complete Table Classification Matrix

Every table currently present in `agency.db` (24 total tables) is classified according to its architectural scope:

| Table Name | Scope Classification | Multi-Tenant Key | Rationale & Retention Policy |
| :--- | :--- | :--- | :--- |
| `specialist_definitions` | **Global Catalog** | *None (Shared)* | 268 imported specialist definitions from Agency Agents. Immutable, shared globally across all customer organizations. |
| `specialist_versions` | **Global Catalog** | *None (Shared)* | Historical revisions and source SHA hashes of specialists. Global reference. |
| `tool_definitions` | **Global Catalog** | *None (Shared)* | Whitelisted tool capabilities (22 tools: file, code, memory, web, data). System-wide capability library. |
| `agents` | **Organization-Owned** | `organization_id` *(New)* | Physical agent instances active in an organization (8 founding executives + recruited specialists). |
| `recruitment_records` | **Organization-Owned** | `organization_id` *(New)* | Employment records binding a customer organization to a specialist definition, budget limit, and manager. |
| `workstation_allocations`| **Organization-Owned** | `organization_id` *(Phase 2)* | Dynamic logical desk slot allocations, 3D coordinates, and office zones decoupled from physical rendering limits. |
| `agent_performance` | **Organization-Owned** | `organization_id` *(New)* | Performance statistics (tasks completed, token spend, quality score) aggregated per agent per organization. |
| `tasks` | **Organization-Owned** | `organization_id` *(New)* | Customer-submitted initiatives, workflows, and DAG subtasks. Strictly tenant-isolated. |
| `artifacts` | **Organization-Owned** | `organization_id` *(New)* | Real deliverables generated in sandbox (code files, reports, spreadsheets, PDFs). Must never leak between tenants. |
| `memories` | **Organization-Owned** | `organization_id` *(New)* | Semantic and episodic memory entries learned during customer projects. |
| `memory_citations` | **Organization-Owned** | `organization_id` *(New)* | Source references linking memories to task execution artifacts. |
| `pa_scoped_memory_records`| **Organization-Owned** | `organization_id` *(Existing)*| 4-tier scoped memory records (`working`, `episodic`, `semantic`, `long_term`). Already has `organization_id`. |
| `pa_governance_audit_logs`| **Organization-Owned** | `organization_id` *(New)* | Audit logs of high-impact action approvals and governance enforcement. |
| `pa_business_opportunities`| **Organization-Owned** | `organization_id` *(New)* | Verified customer demand opportunities identified by AI Research. |
| `pa_manufactured_products`| **Organization-Owned** | `organization_id` *(New)* | Software packages compiled and unit-tested by the Autonomous Product Factory. |
| `pa_marketing_campaigns` | **Organization-Owned** | `organization_id` *(New)* | Marketing campaign assets and email outreach sequences. |
| `pa_sales_leads_crm` | **Organization-Owned** | `organization_id` *(New)* | Lead pipeline, qualification tiers, and prospect CRM entries. |
| `pa_support_tickets` | **Organization-Owned** | `organization_id` *(New)* | Customer service tickets and automated resolution logs. |
| `pa_financial_ledger` | **Organization-Owned** | `organization_id` *(New)* | Strict P&L accounting (owner budget deposits, expenses, received revenue). |
| `pa_org_recommendations` | **Organization-Owned** | `organization_id` *(New)* | Automated skill-gap recruitment recommendations generated for the organization. |
| `task_steps` | **Execution-Level** | *Inherited via `task_id`* | Individual tool execution iterations within a subtask execution loop. |
| `agent_events` | **Execution-Level** | `organization_id` *(New)* | Authoritative event stream entries for real-time WebSocket distribution and audit replays. |
| `approvals` | **Execution-Level** | *Inherited via `task_id`* | Pending and resolved human authorization requests for high-impact actions. |
| `tool_executions` | **Execution-Level** | *Inherited via `task_id`* | Execution telemetry, input parameters, execution duration, and sandbox outputs. |
| `alembic_version` | **System-Level** | *None* | Schema migration tracking ledger. |

---

## 2. Multi-Tenant Relational Schema Diagram

```
+-----------------------------------------------------------------------------------------------+
|                                    GLOBAL CATALOG (SHARED)                                    |
|                                                                                               |
|  [specialist_definitions] 1:N ──► [specialist_versions]                                       |
|  [tool_definitions]                                                                           |
+-----------------------------------------------------------------------------------------------+
                                               │
                                               │ (Recruitment & Tool Whitelisting)
                                               ▼
+-----------------------------------------------------------------------------------------------+
|                               CUSTOMER TENANT BOUNDARY (ISOLATED)                              |
|                                     `organization_id`                                         |
|                                                                                               |
|  [organizations]                                                                              |
|    ├── id (PK)                                                                                |
|    ├── name, slug, tier ("TRIAL", "PRO", "ENTERPRISE")                                        |
|    └── monthly_budget_usd, balance_usd                                                        |
|         │                                                                                     |
|         ├───────── 1:N ─────────┐                                                             |
|         ▼                       ▼                                                             |
|    [recruitment_records]     [agents] ◄── 1:1 ──► [agent_performance]                         |
|         │                       ▲                                                             |
|         └───── links to ────────┘                                                             |
|                                 │                                                             |
|                                 ▼ (Assigned To)                                               |
|                              [tasks] (DAG Root & Subtasks)                                    |
|                                 │                                                             |
|              ┌──────────────────┼──────────────────┬─────────────────┐                        |
|              ▼                  ▼                  ▼                 ▼                        |
|        [task_steps]       [approvals]        [artifacts]     [agent_events]                   |
|              │                                                       │                        |
|              ▼                                                       ▼                        |
|      [tool_executions]                                       WebSocket Broadcast              |
|                                                              (Filtered by org_id)             |
+-----------------------------------------------------------------------------------------------+
```

---

## 3. Non-Destructive Migration Strategy

To transition the existing single-tenant `agency.db` into multi-tenancy without losing any records:

### Phase A: Add Seed Organization
1. Create table `organizations` with default seed tenant:
   - `id`: `"org_default_company"`
   - `name`: `"Default Corporate Headquarters"`
   - `slug`: `"default-hq"`
   - `tier`: `"ENTERPRISE"`

### Phase B: Safe Column Additions (Nullable Default)
1. Add `organization_id` to `agents`, `recruitment_records`, `agent_performance`, `tasks`, `artifacts`, `memories`, `agent_events`, and all `pa_*` tables.
2. In the migration script, execute:
   ```sql
   ALTER TABLE tasks ADD COLUMN organization_id VARCHAR(64) DEFAULT 'org_default_company';
   ALTER TABLE agents ADD COLUMN organization_id VARCHAR(64) DEFAULT 'org_default_company';
   ALTER TABLE recruitment_records ADD COLUMN organization_id VARCHAR(64) DEFAULT 'org_default_company';
   ALTER TABLE agent_events ADD COLUMN organization_id VARCHAR(64) DEFAULT 'org_default_company';
   CREATE INDEX ix_tasks_org_status ON tasks(organization_id, status);
   CREATE INDEX ix_events_org_seq ON agent_events(organization_id, sequence_id);
   ```
3. Existing records immediately inherit `'org_default_company'`, preserving all 8 leadership agents, historical tasks, and event logs.

### Phase C: Fast-API Tenant Isolation Dependency
Create a reusable FastAPI dependency `get_current_tenant_org(req: Request) -> str`:
- Extracts JWT bearer token claims and server-side organization memberships.
- Validates caller permissions before allowing access to organization scopes.
- Injects verified `tenant_org` filter into all database queries:
  ```python
  def get_tasks_for_org(db: Session, org_id: str):
      return db.query(TaskModel).filter(TaskModel.organization_id == org_id).all()
  ```

---

## 4. Phase 2.2 Schema Updates (`e5f6a7b8c9d0`)

### 4.1 Authentication & Multi-Tenancy Tables
- **`organizations`**:
  - `id` VARCHAR(64) PRIMARY KEY
  - `name` VARCHAR(128) NOT NULL
  - `slug` VARCHAR(64) UNIQUE NOT NULL INDEX
  - `tier` VARCHAR(32) DEFAULT 'pro' NOT NULL
  - `is_active` BOOLEAN DEFAULT 1 NOT NULL
  - `settings` JSON NULL
  - `created_at`, `updated_at` DATETIME NOT NULL
- **`users`**:
  - `id` VARCHAR(64) PRIMARY KEY
  - `email` VARCHAR(255) UNIQUE NOT NULL INDEX
  - `hashed_password` VARCHAR(255) NOT NULL (PBKDF2-SHA256)
  - `full_name` VARCHAR(128) NOT NULL
  - `is_superadmin` BOOLEAN DEFAULT 0 NOT NULL
  - `is_active` BOOLEAN DEFAULT 1 NOT NULL
  - `created_at`, `updated_at` DATETIME NOT NULL
- **`organization_members`**:
  - `id` VARCHAR(64) PRIMARY KEY
  - `organization_id` VARCHAR(64) REFERENCES `organizations(id)` ON DELETE CASCADE
  - `user_id` VARCHAR(64) REFERENCES `users(id)` ON DELETE CASCADE
  - `role` VARCHAR(32) DEFAULT 'ORGANIZATION_MEMBER' NOT NULL
  - `is_active` BOOLEAN DEFAULT 1 NOT NULL
  - `created_at`, `updated_at` DATETIME NOT NULL
  - UNIQUE(`organization_id`, `user_id`)

### 4.2 Specialist Version Pinning Schema
- **`recruitment_records`**:
  - `specialist_version_id` VARCHAR(64) REFERENCES `specialist_versions(id)` ON DELETE SET NULL
  - `specialist_version_num` INTEGER DEFAULT 1 NOT NULL
  - INDEX `ix_recruitment_spec_ver` (`specialist_version_id`)

### 4.3 Database-Level Desk Uniqueness
- **`workstation_allocations`**:
  - Partial Unique Index `uq_assigned_physical_desk`:
    ```sql
    CREATE UNIQUE INDEX uq_assigned_physical_desk
    ON workstation_allocations (organization_id, department, desk_number)
    WHERE allocation_status = 'ASSIGNED' AND desk_number IS NOT NULL;
    ```

### 4.4 Documentation of Asymmetric Migration Finding
The Phase 2.1 audit noted that migration `d4e5f6a7b8c9` added `organization_id` columns to `agents` and `recruitment_records` in `upgrade()`, but did not drop them in `downgrade()`.
- **Architectural Assessment:** This is an intentional SQLite-compatibility limitation. SQLite historically did not support `ALTER TABLE ... DROP COLUMN` without full table recreation (batch alter table). Because dropping tenant keys would cause catastrophic data loss if executed accidentally against production, the down-revision preserves multi-tenant keys.
- **Migration `e5f6a7b8c9d0`:** Implements fully symmetric `downgrade()` utilizing SQLAlchemy batch mode (`batch_alter_table`), allowing clean rollbacks and re-upgrades on temporary databases while maintaining zero-data-loss guarantees on `agency.db`.

---

## 5. Phase 2.2.2 Schema Updates (`f6a7b8c9d0e1`)

Migration `f6a7b8c9d0e1_core_security_and_tenant_isolation.py` introduces four database schema updates enforcing core execution integrity and tenant isolation:

### 5.1 Dynamic User Revocation (`users.token_version`)
- Column: `token_version` INTEGER NOT NULL DEFAULT 1.
- Invariant: Issued JWT tokens include `"ver": user.token_version`. `get_current_user` verifies `payload["ver"] >= user.token_version`. Calling `revoke_user_tokens(db, user_id)` increments `token_version`, immediately invalidating all active sessions.

### 5.2 Tenant-Scoped Task Model (`tasks.organization_id`)
- Column: `organization_id` VARCHAR(64) NOT NULL DEFAULT 'org_default_company'.
- Foreign Key: `ForeignKey("organizations.id", ondelete="CASCADE")`.
- Index: `ix_tasks_org_status` on `(organization_id, status)`.
- Invariant: All tasks are bound to an authoritative tenant organization. Tasks cannot be assigned to agents belonging to another organization. Cross-tenant reads and cancellations return 404.

### 5.3 Immutable Specialist Version Snapshots (`specialist_versions.parsed_metadata`)
- Column: `parsed_metadata` JSON NULL.
- Invariant: Captures the immutable tools, permission level, critical rules, and system instruction snapshot at the exact moment of version creation. Catalog synchronizations bump version numbers and create new rows rather than mutating existing snapshots.

### 5.4 Legacy Version Tracking (`recruitment_records.is_legacy_unpinned`)
- Column: `is_legacy_unpinned` BOOLEAN NOT NULL DEFAULT 0.
- Invariant: Explicitly flags historical recruitment records where `specialist_version_id IS NULL`. Prevents execution fallback to generic prompts; surfaces records via `GET /api/v1/recruitment/legacy-audit`.
