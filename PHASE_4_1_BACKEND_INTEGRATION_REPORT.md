# PROVIPAGENT — Phase 4.1: Backend Integration Report
## Authoritative Integration with FastAPI, Workstation Service, and Spatial APIs

**Version:** 1.0.0  
**Date:** 2026-11-02  
**Baseline Git Checkpoint:** `2209f67faa875ed0bfe2fd91009a81f17e3652e2`  
**Backend Framework:** FastAPI, SQLAlchemy, SQLite, Pydantic v2  

---

### 1. Integration Scope & Principles

The Phase 4.1 3D Office is strictly coupled to the authoritative backend APIs. The frontend acts exclusively as a visual representation and interaction client; all state transitions, spatial layouts, desk assignments, and task lifecycles originate within the backend.

#### 1.1 Non-Negotiable Integration Rules
1. **Zero Client-Side State Invention**: Agents, departments, tasks, and workstations are never created out of thin air.
2. **Authoritative Hydration Precedence**: The initial layout is fully driven by `/api/v1/world/snapshot` and `/api/v1/workstations/overview`.
3. **Monotonic Watermarking**: Every state snapshot and event payload carries a monotonic `sequence_id` to guarantee linear history progression and eliminate race conditions.

---

### 2. Hydration Endpoints & Contract Validation

#### 2.1 World Snapshot (`GET /api/v1/world/snapshot`)
Returns a comprehensive point-in-time state of the organization:
- **`organization_id`**: Active organization scope (e.g. `org_default_company`).
- **`sequence_id`**: Current authoritative event sequence watermark.
- **`agents`**: Array of `AgentSnapshotItem` containing:
  - `employee_id`: Unique persistent identifier (e.g. `agent-exec-ceo`).
  - `name`, `role`, `department`: Identity and organizational role.
  - `lifecycle_state`: `ACTIVE`, `SUSPENDED`, `OFFBOARDED`, etc.
  - `operational_status`: `idle`, `working`, `waiting_approval`, etc.
  - `behavioral_state`: Authoritative 9-state canonical behavior.
  - `spatial_coordinates`: `{ x, y, z }` authoritative world coordinates.
  - `target_coordinates`: `{ x, y, z }` destination coordinates if agent is moving.
  - `assigned_workstation`: Bound workstation identifier.
  - `current_active_task`: Active task metadata (`task_id`, `title`, `status`, `priority`).
- **`workstations`**: Array of physical workstations with spatial coordinates and occupancy status.
- **`activities`**: Active real-time execution activities.

#### 2.2 Workstation Overview (`GET /api/v1/workstations/overview`)
Returns the topological department layout and individual workstation bindings:
- **`zones`**: Array of `ZoneConfig` defining 8 canonical corporate departments:
  - `Executive`: `(0, 0, -12)` — Suite for CEO and executive governance.
  - `Engineering`: `(-14, 0, -4)` — Tech development cluster.
  - `AI Research`: `(-14, 0, 10)` — Autonomous intelligence and models bay.
  - `Marketing`: `(14, 0, -10)` — Growth and branding cluster.
  - `Sales`: `(14, 0, 2)` — Business development cluster.
  - `Operations`: `(14, 0, 14)` — Systems and infra operations bay.
  - `Finance`: `(-6, 0, 18)` — Financial analysis and budgeting suite.
  - `Customer Success`: `(6, 0, 18)` — Customer support and engagement bay.
- **`allocations`**: Array of `WorkstationAllocation` records:
  - `logical_workstation_id`: Authoritative desk key (e.g. `ws-exec-01`).
  - `agent_id`, `agent_name`, `agent_role`: Occupant identity.
  - `pos_x, pos_y, pos_z`: Physical 3D location within the office floorplate.
  - `desk_number`: Sequential desk index within the department.
  - `is_virtual`: Boolean flag indicating whether the desk is a physical desk or virtual overflow.

---

### 3. Client Hydration Pipeline (`frontend/hooks/useOfficeSync.ts`)

```
                          [ Initialize Hook ]
                                  |
                                  v
              +-------------------+-------------------+
              |                                       |
              v                                       v
    [ GET /world/snapshot ]             [ GET /workstations/overview ]
              |                                       |
              +-------------------+-------------------+
                                  |
                                  v
                   [ Promise.allSettled Aggregator ]
                                  |
                                  v
                   [ Reconcile Entities & Zones ]
                   - Map spatial coordinates
                   - Link occupants to desks
                   - Establish sequence watermark
                                  |
                                  v
                   [ Subscribe to WebSocket Stream ]
                   - Register onEvent handler
                   - Listen to connection status changes
```

---

### 4. Integration Verification & Error Resilience

1. **Backend Offline Resilience**: If the backend is unreachable during startup, `useOfficeSync` transitions to `connectionStatus = "error"`, displays an informative non-blocking toast, and allows the operator to click "Thử lại" (Retry) without crashing the 3D viewport.
2. **Graceful Degraded States**: If `snapshotRes` succeeds but `workstationRes` encounters a temporary network timeout, the system populates agents and falls back to snapshot-defined workstation positions without unmounting.
3. **TypeScript Safety**: Fully typed with strict Pydantic-to-TypeScript interfaces matching `backend/app/schemas/world.py` and `backend/app/schemas/workstation.py`.
