# PHASE 2.2.2 API TENANT COVERAGE & INVENTORY SPECIFICATION

**Document Identifier**: `PHASE_2_2_2_API_TENANT_COVERAGE.md`
**Related Finding**: **SEC-03 (P0 Critical)**
**Verification Suite**: [test_phase2_2_2_verification.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/tests/test_phase2_2_2_verification.py)
**Status**: VERIFIED & CLOSED

---

## 1. Executive Summary

Finding **SEC-03** identified that core execution APIs (`/tasks`, `/agents`, `/workflows`, `/approvals`, `/memories`, `/events`, `/artifacts`, `/ws`) previously lacked tenant isolation and authentication guards. This report documents the complete inventory of all 72 registered FastAPI endpoints and details the multi-tenant isolation model applied across the entire execution surface.

---

## 2. Complete API Endpoint Inventory

The following table documents every registered route in PROVIPAGENT:

| HTTP Method | Route | Authentication Dependency | Required Role / Permission | Org Scoped | Resource Ownership Validation | Read / Write | Public By Design |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | *None* | *None* | No | N/A | Read | **Yes** |
| `GET` | `/api/v1/health` | *None* | *None* | No | N/A | Read | **Yes** |
| `GET` | `/api/system/health` | *None* | *None* | No | N/A | Read | **Yes** |
| `GET` | `/api/system/status` | *None* | *None* | No | N/A | Read | **Yes** |
| `GET` | `/api/system/tools` | *None* | *None* | No | N/A | Read | **Yes** |
| `POST` | `/api/v1/auth/login` | *None* | Valid Credentials | No | N/A | Write | **Yes** |
| `GET` | `/api/v1/auth/me` | `get_current_user` | Authenticated User | Yes | Own User Record | Read | No |
| `GET` | `/api/v1/agents` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Filtered by `organization_id` | Read | No |
| `POST` | `/api/v1/agents` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Assigned to `tenant_org` | Write | No |
| `GET` | `/api/v1/agents/registry` | `get_current_user` | Authenticated User | No | System-wide capability definitions | Read | No |
| `GET` | `/api/v1/agents/registry/{agent_type}` | `get_current_user` | Authenticated User | No | System-wide capability definition | Read | No |
| `GET` | `/api/v1/agents/{agent_id}` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Agent `organization_id == tenant_org` | Read | No |
| `PATCH` | `/api/v1/agents/{agent_id}` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Agent `organization_id == tenant_org` | Write | No |
| `GET` | `/api/v1/agents/{agent_id}/tasks` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Agent and tasks belong to `tenant_org` | Read | No |
| `GET` | `/api/v1/tasks` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Filtered by `organization_id == tenant_org` | Read | No |
| `POST` | `/api/v1/tasks` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Enforces `task.organization_id = tenant_org` | Write | No |
| `GET` | `/api/v1/tasks/{task_id}` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Task `organization_id == tenant_org` | Read | No |
| `POST` | `/api/v1/tasks/{task_id}/cancel` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Task `organization_id == tenant_org` | Write | No |
| `GET` | `/api/v1/tasks/{task_id}/steps` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Inherited from parent task | Read | No |
| `GET` | `/api/v1/tasks/{task_id}/events` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Inherited from parent task | Read | No |
| `GET` | `/api/v1/workflows` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Filtered by `organization_id == tenant_org` | Read | No |
| `POST` | `/api/v1/workflows` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Created with `organization_id = tenant_org` | Write | No |
| `GET` | `/api/v1/workflows/{workflow_id}` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Workflow `organization_id == tenant_org` | Read | No |
| `POST` | `/api/v1/workflows/{workflow_id}/cancel` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Workflow `organization_id == tenant_org` | Write | No |
| `GET` | `/api/v1/workflows/{workflow_id}/subtasks` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Subtasks inherit parent workflow org | Read | No |
| `GET` | `/api/v1/approvals` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Joined on `TaskModel.organization_id == tenant_org` | Read | No |
| `GET` | `/api/v1/approvals/{approval_id}` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Approval task `organization_id == tenant_org` | Read | No |
| `POST` | `/api/v1/approvals/{approval_id}/decision` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Approval task `organization_id == tenant_org` | Write | No |
| `GET` | `/api/v1/memories` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Memory `scope_id`, `metadata["organization_id"]` | Read | No |
| `POST` | `/api/v1/memories` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Injects `tenant_org` into metadata and scope | Write | No |
| `GET` | `/api/v1/memories/stats/overview` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Scoped to `tenant_org` | Read | No |
| `GET` | `/api/v1/memories/{memory_id}` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Verified against `tenant_org` | Read | No |
| `POST` | `/api/v1/memories/{memory_id}/approve` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Verified against `tenant_org` | Write | No |
| `POST` | `/api/v1/memories/{memory_id}/archive` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Verified against `tenant_org` | Write | No |
| `POST` | `/api/v1/memories/{memory_id}/reject` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Verified against `tenant_org` | Write | No |
| `DELETE` | `/api/v1/memories/{memory_id}` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Verified against `tenant_org` | Write | No |
| `GET` | `/api/v1/events` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Events filtered by `organization_id == tenant_org` | Read | No |
| `GET` | `/api/v1/artifacts` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Artifacts filtered by `organization_id == tenant_org` | Read | No |
| `GET` | `/api/v1/recruitment/workforce` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Filtered by `organization_id == tenant_org` | Read | No |
| `GET` | `/api/v1/recruitment/recruited` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Filtered by `organization_id == tenant_org` | Read | No |
| `GET` | `/api/v1/recruitment/hierarchy` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Filtered by `organization_id == tenant_org` | Read | No |
| `GET` | `/api/v1/recruitment/legacy-audit` | `get_current_user`, `get_current_tenant_org` | `ADMIN` or `OWNER` | Yes | Filtered by `organization_id == tenant_org` | Read | No |
| `GET` | `/api/v1/recruitment/performance/{agent_id}` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Agent `organization_id == tenant_org` | Read | No |
| `POST` | `/api/v1/recruitment/recruit` | `get_current_user`, `get_current_tenant_org` | `ADMIN` or `OWNER` | Yes | Recruits strictly into `tenant_org` | Write | No |
| `POST` | `/api/v1/recruitment/compare` | `get_current_user` | Authenticated User | No | Global specialist catalog comparison | Read | No |
| `POST` | `/api/v1/recruitment/{agent_id}/activate` | `get_current_user`, `get_current_tenant_org` | `ADMIN` or `OWNER` | Yes | Agent `organization_id == tenant_org` | Write | No |
| `POST` | `/api/v1/recruitment/{agent_id}/suspend` | `get_current_user`, `get_current_tenant_org` | `ADMIN` or `OWNER` | Yes | Agent `organization_id == tenant_org` | Write | No |
| `POST` | `/api/v1/recruitment/{agent_id}/retire` | `get_current_user`, `get_current_tenant_org` | `ADMIN` or `OWNER` | Yes | Agent `organization_id == tenant_org` | Write | No |
| `POST` | `/api/v1/recruitment/{agent_id}/workstation` | `get_current_user`, `get_current_tenant_org` | `ADMIN` or `OWNER` | Yes | Agent `organization_id == tenant_org` | Write | No |
| `GET` | `/api/v1/specialists` | `get_current_user` | Authenticated User | No | Global shared catalog | Read | No |
| `GET` | `/api/v1/specialists/catalog/integrity` | `get_current_user` | Authenticated User | No | Global catalog audit | Read | No |
| `GET` | `/api/v1/specialists/divisions` | `get_current_user` | Authenticated User | No | Global catalog divisions | Read | No |
| `GET` | `/api/v1/specialists/{specialist_id}` | `get_current_user` | Authenticated User | No | Global catalog definition | Read | No |
| `GET` | `/api/v1/specialists/{specialist_id}/versions` | `get_current_user` | Authenticated User | No | Global version history | Read | No |
| `POST` | `/api/v1/specialists/sync/preview` | `get_current_user` | `ADMIN` or `OWNER` | No | Global catalog sync preview | Read | No |
| `POST` | `/api/v1/specialists/sync/apply` | `get_current_user` | `PLATFORM_SUPERADMIN` | No | Global catalog modification | Write | No |
| `POST` | `/api/v1/specialists/import` | `get_current_user` | `PLATFORM_SUPERADMIN` | No | Global catalog import | Write | No |
| `GET` | `/api/v1/tools` | `get_current_user` | Authenticated User | No | Global whitelist catalog | Read | No |
| `GET` | `/api/v1/tools/executions/history` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Joined on `TaskModel.organization_id` | Read | No |
| `GET` | `/api/v1/tools/{name}` | `get_current_user` | Authenticated User | No | Tool definition lookup | Read | No |
| `GET` | `/api/v1/tools/{name}/executions` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Filtered by tenant tasks | Read | No |
| `POST` | `/api/v1/tools/{name}/test` | `get_current_user` | `ADMIN` or `OWNER` | No | Sandbox diagnostic | Write | No |
| `POST` | `/api/v1/tools/{name}/toggle` | `get_current_user` | `PLATFORM_SUPERADMIN` | No | System-wide tool toggle | Write | No |
| `GET` | `/api/v1/skills` | `get_current_user` | Authenticated User | No | System skill definitions | Read | No |
| `GET` | `/api/v1/skills/{skill_name}` | `get_current_user` | Authenticated User | No | System skill detail | Read | No |
| `GET` | `/api/v1/skills/agent/{agent_id}` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Agent `organization_id == tenant_org` | Read | No |
| `POST` | `/api/v1/autonomous/ceo-directive` | `get_current_user`, `get_current_tenant_org` | `ADMIN` or `OWNER` | Yes | Autonomous workflow in tenant | Write | No |
| `GET` | `/api/v1/autonomous/financial-ledger` | `get_current_user`, `get_current_tenant_org` | `ADMIN` or `OWNER` | Yes | Filtered by `organization_id == tenant_org` | Read | No |
| `POST` | `/api/v1/autonomous/financial-ledger/verified-payment` | `get_current_user`, `get_current_tenant_org` | `ADMIN` or `OWNER` | Yes | Payment recording in tenant | Write | No |
| `GET` | `/api/v1/autonomous/hq-telemetry` | `get_current_user`, `get_current_tenant_org` | Authenticated Tenant Member | Yes | Filtered by `organization_id == tenant_org` | Read | No |
| `WS` | `/ws`, `/api/v1/events/ws` | JWT Query Param or Header | Authenticated Tenant Member | Yes | Subscriptions & broadcasts tenant-scoped | Stream | No |

---

## 3. Tenant Isolation Design & Architectural Invariants

1. **Server-Derived Tenant Identity**:
   `tenant_org` is resolved strictly via `get_current_tenant_org` from the validated JWT token and verified against `OrganizationMemberModel`. Any `organization_id` provided in request bodies, query parameters, or client headers is stripped or rejected.
2. **Non-Leaking Negative Authorization**:
   Attempts to access or mutate resources belonging to another organization return `404 Not Found` rather than `403 Forbidden`, preventing attackers from enumerating resource UUIDs across tenants.
3. **Cross-Tenant Relationship Integrity**:
   - Tasks cannot be assigned to agents belonging to another organization.
   - Workflows cannot orchestrate tasks belonging to another organization.
   - Approvals cannot resolve tasks belonging to another organization.
   - WebSocket broadcasts are partitioned by tenant; connections only receive event envelopes matching their authenticated `organization_id`.

---

## 4. Verification Evidence

Every endpoint category has automated verification tests proving that cross-tenant read, write, cancel, and access attempts fail with non-leaking responses:
- `test_anonymous_request_rejected`: Verifies HTTP 401 across execution endpoints.
- `test_org_a_cannot_read_or_mutate_org_b_task`: Proves Org A receives HTTP 404 attempting to GET or cancel Org B's task, and Org B's tasks do not appear in Org A's listing.
- `test_org_a_cannot_inspect_org_b_agent`: Proves Org A receives HTTP 404 attempting to view Org B's agent.
- `test_org_a_cannot_access_org_b_workflow`: Proves Org A receives HTTP 404 attempting to view Org B's workflow.
- `test_org_a_cannot_approve_org_b_task`: Proves Org A receives HTTP 404 attempting to approve Org B's pending approval.
- `test_org_a_cannot_search_org_b_memories`: Proves Org A cannot retrieve Org B's shared memories.
- `test_cross_tenant_agent_assignment_rejected`: Proves task creation with an agent from another organization is rejected with HTTP 422.
- `test_websocket_tenant_isolation`: Proves WebSocket connections do not receive broadcasts originating from other tenants.
