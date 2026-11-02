# PROVIPAGENT — Phase 4.1: Architecture Report
## Real-Time 3D AI Company Office Architectural Blueprint

**Version:** 1.0.0  
**Date:** 2026-11-02  
**Baseline Git Checkpoint:** `2209f67faa875ed0bfe2fd91009a81f17e3652e2`  
**System Status:** Production Ready  

---

### 1. Executive Summary

Phase 4.1 establishes the foundational 3D Company Office for PROVIPAGENT. Rather than an isolated visual demo or synthetic mockup, this system is deeply anchored into the authoritative backend state machine (FastAPI, SQLAlchemy, SQLite, Milestone 5 event streaming). Every floor element, glass perimeter wall, department zone, desk workstation, and humanoid agent avatar corresponds directly to authoritative database records and physical coordinates computed by backend spatial and organization services.

The architecture bridges high-performance WebGL graphics (via Three.js, React Three Fiber, Drei) with enterprise-grade state synchronization, guaranteed monotonic watermark sequencing, and complete zero-fabrication integrity.

```
+---------------------------------------------------------------------------------------------------------+
|                                    PROVIPAGENT REAL-TIME 3D OFFICE                                      |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|  +---------------------------+   +----------------------------+   +----------------------------------+  |
|  |     OfficeHUD / UI        |   |    OfficeInspector Drawer  |   |        EmptyOfficeState          |  |
|  |  Org scope, telemetry,    |   |  Agent / Station / Dept    |   |  Zero-fabrication overlay for    |  |
|  |  monotonic sequence watermark|  metadata inspection       |   |  unpopulated organizations       |  |
|  +-------------+-------------+   +--------------+-------------+   +-----------------+----------------+  |
|                |                                |                                   |                   |
|                +--------------------------------+-----------------------------------+                   |
|                                                 |                                                       |
|                                       [ OfficeScene Router ]                                            |
|                                                 |                                                       |
|                        +------------------------+------------------------+                              |
|                        |                                                 |                              |
|             +----------v----------+                           +----------v-----------+                  |
|             |   useOfficeSync     |                           |     OfficeCanvas     |                  |
|             |   Sync & Hydration  |                           |     R3F / Three.js   |                  |
|             +----------+----------+                           +----------+-----------+                  |
|                        |                                                 |                              |
|     +------------------+------------------+                   +----------+-----------------------+      |
|     |                                     |                   |                                  |      |
|  +--v------------------+  +---------------v----+          +---v---------------+  +---------------v---+  |
|  | REST Hydration      |  | WebSocket Streaming|          | Environment & PBR |  | Spatial Entities  |  |
|  | - /world/snapshot   |  | - /events/ws       |          | - Skyline Backdrop|  | - Dept Zones      |  |
|  | - /workstations/ovw |  | - Monotonic Seq    |          | - Glass Mullions  |  | - Desks & Monitors|  |
|  +---------------------+  +--------------------+          | - Terrazzo Floor  |  | - 9-State Avatars |  |
|                                                           | - Daylight PBR    |  | - Billboard HUDs  |  |
|                                                           +-------------------+  +-------------------+  |
+---------------------------------------------------------------------------------------------------------+
```

---

### 2. Component Hierarchy & Module Decomposition

The 3D office foundation is structured modularly in `frontend/components/office/`:

1. **`OfficeScene.tsx`**: Top-level coordinator. Manages camera focus interpolation, selection state, inspector drawer visibility, telemetry computation, and delegates rendering to `OfficeCanvas`.
2. **`OfficeCanvas.tsx`**: React Three Fiber Canvas with ACESFilmic tone mapping, soft shadow maps, frustum near/far boundaries, camera rig, and pointer raycasting.
3. **`OfficeHUD.tsx`**: Glassmorphic top navigation bar displaying:
   - Organization identifier (`organizationId`)
   - Monotonic sequence watermark (`seq #`)
   - Active workforce telemetry (Agent count, Active tasks count, Workstation occupancy ratio)
   - Real-time connection badge (`LIVE SYNC`, `CONNECTING`, `RECONNECTING`, `ERROR`)
   - Quick camera bookmarks (Tactical Overview, CEO Executive Suite)
   - Operational triggers (Task Dispatch, Recruitment Hub, Mission Terminal)
4. **`OfficeEnvironment.tsx`**: Procedural metropolitan skyline with 42 illuminated skyscraper towers, ambient aerial haze, and floor-to-ceiling perimeter glass curtain walls with structural mullions.
5. **`OfficeFloor.tsx`**: Reflective architectural terrazzo floor grid, corridor LEDs, baseboard trims, and central corporate atrium medallion.
6. **`OfficeLighting.tsx`**: PBR daylight lighting system combining directional sun light with soft shadow mapping, hemisphere sky fill, and ambient executive accent downlights.
7. **`OfficeCamera.tsx`**: Smooth lerp OrbitControls with boundary clamping (`minDistance: 4`, `maxDistance: 75`, `maxPolarAngle: π/2 - 0.05`), target interpolation, and preset restoration.
8. **`DepartmentZone.tsx`**: Dynamic rectangular department zone derived from backend `ZoneConfig`. Renders accent floor carpet, glowing boundary wireframes, floating 3D department badge, and child workstations.
9. **`Workstation.tsx`**: Detailed modern desk rig featuring ash wood surface, dual/triple ultrawide curved monitors with emissive backlighting and screen glow, ergonomic mesh office chair, and status beacon.
10. **`AgentAvatar.tsx`**: Articulated humanoid PBR avatar reflecting the 9 canonical behavioral states with contextual animations (typing, walk cycle, thinking, celebration), color-coded status beacons, and billboard floating name/task tags.
11. **`OfficeInspector.tsx`**: Slide-out drawer presenting detailed real-time metadata for selected agents, workstations, or department zones.
12. **`EmptyOfficeState.tsx`**: Clean, zero-fabrication fallback UI rendered when an organization has 0 departments and 0 agents, preventing synthetic phantom workforce generation.

---

### 3. State Management & Real-Time Sync Hook (`useOfficeSync.ts`)

The synchronization lifecycle operates in two coordinated stages:

#### Stage 1: Authoritative REST Hydration
- Upon initialization or organization switch, `useOfficeSync` triggers parallel REST requests:
  - `GET /api/v1/world/snapshot?organizationId={id}`: Hydrates agent positions, target destinations, active tasks, and initializes the authoritative sequence watermark `sequence_id`.
  - `GET /api/v1/workstations/overview?organizationId={id}`: Hydrates `ZoneConfig` for all departments (coordinates `base_x, base_y, base_z`, capacities, desk spacing) and workstation allocations.
- Entities are reconciled into normalized index dictionaries (`departments`, `workstations`, `agents`).

#### Stage 2: Monotonic WebSocket Stream Ingestion
- Subscribes to `syncManager.onEvent(...)` for Milestone 5 event envelopes.
- Updates monotonic watermark `sequence_id = Math.max(prev, evSeq)` to prevent sequence regressions.
- Processes live events:
  - `agent.behavioral_state_changed`: Reconciles agent state into the 9-state canonical model.
  - `agent.movement_started`: Sets `isMoving: true`, stores target destination coordinates, and switches animation to movement.
  - `agent.movement_completed`: Snaps position to final coordinates, clears target, sets `isMoving: false`.
  - `tool.execution_started`: Transitions agent to `IN_PROGRESS` with dynamic tool execution status.
  - `task.completed`: Transitions agent to `COMPLETED` and clears task assignment.
  - `task.failed`: Transitions agent to `FAILED` with error diagnostic readout.

---

### 4. Canonical 9-State Behavioral Mapping Matrix

| Canonical State | Vietnamese Label | Emissive Intensity | Animation Type | Beacon Color | Monitor Color | Ambient VFX |
| :--- | :--- | :---: | :--- | :---: | :---: | :--- |
| **`IDLE`** | Nghỉ ngơi / Chờ lệnh | 0.15 | `idle` | `#94a3b8` | `#0284c7` | None |
| **`QUEUED`** | Đang xếp hàng | 0.45 | `thinking` | `#facc15` | `#eab308` | `beacon` |
| **`ASSIGNED`** | Đã giao nhiệm vụ | 0.50 | `walking` | `#22d3ee` | `#06b6d4` | None |
| **`IN_PROGRESS`** | Đang thực thi | 0.85 | `working` | `#60a5fa` | `#3b82f6` | `typing` |
| **`WAITING`** | Chờ phê duyệt | 0.75 | `waiting` | `#fb923c` | `#f97316` | `alert_ring` |
| **`REVIEW`** | Thẩm định / Review | 0.70 | `reviewing` | `#a78bfa` | `#8b5cf6` | `document_glow` |
| **`COMPLETED`** | Hoàn tất bàn giao | 0.90 | `celebrating` | `#34d399` | `#10b981` | `pulse_green` |
| **`FAILED`** | Lỗi thực thi | 0.90 | `error` | `#f87171` | `#ef4444` | `sparks_red` |
| **`CANCELLED`** | Đã hủy bỏ | 0.20 | `idle` | `#64748b` | `#334155` | `fade` |

---

### 5. Architectural Verification & Zero-Fabrication Guarantees

1. **Zero-Fabrication Principle**: The 3D scene never creates synthetic placeholder agents or fake workstation metrics. If the backend returns 0 records for an organization, `EmptyOfficeState` is rendered.
2. **Authority Principle**: All entity positions, assignments, and states are driven by the backend database and event broker. The frontend performs interpolation and rendering only.
3. **Resilience Principle**: Out-of-order WebSocket envelopes are reconciled using sequence IDs, and network disconnections trigger automatic reconnection state indicators without corrupting existing world state.
