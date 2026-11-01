# PROVIPAGENT — Phase 3.1 Architectural Decision Log (Corrected Baseline)

**Document Identifier:** `PHASE_3_1_DECISION_LOG.md`  
**Revision:** `Phase 3.1.1 Architecture Correction`  
**Project:** PROVIPAGENT — Autonomous AI Company Operating System  
**Roles:** Principal Software Architect, Senior Backend Architect, Real-time Distributed Systems Engineer, Three.js / React Three Fiber Technical Architect, AI Agent Orchestration Architect, Application Security Architect, Performance Engineering Lead  
**Release Checkpoint Baseline:** `5a72886993d0b6721f52381117364894fcf2c39e`  
**Status:** **AUTHORITATIVE ARCHITECTURAL DECISIONS (PHASE 3.1)**  
**Standardized Status Values:** `APPROVED` | `CONDITIONAL` | `REJECTED` | `BLOCKED` | `PROPOSED`  

---

## Decision Record Summary Index

| Decision ID | Title | Status | Primary Rationale & Core Boundary |
| :--- | :--- | :--- | :--- |
| [DEC-3D-01](#dec-3d-01-3d-rendering-framework-selection) | 3D Rendering Framework Selection | **APPROVED** | Reuses verified installed dependencies (`three`, `@react-three/fiber`, `@react-three/drei`). |
| [DEC-3D-02](#dec-3d-02-decoupled-spatial-scene-store-architecture) | Decoupled Spatial Scene Store Architecture | **PROPOSED** | Isolates 3D spatial state from monolithic `worldStore.ts` to eliminate HUD re-render cascading. |
| [DEC-3D-03](#dec-3d-03-multi-tier-entity-identity-separation) | Multi-Tier Entity Identity Separation (8-Tier Architecture) | **APPROVED** | Distinguishes catalog capability from active employee and loaded WebGL geometry. |
| [DEC-3D-05](#dec-3d-05-real-time-event-replay--snapshot-synchronization-protocol) | Real-Time Event Replay & Snapshot Synchronization Protocol | **APPROVED** | Monotonic sequence ID with server-scoped tenant replay (`organization_id == conn_org`) and client watermark tracking. Verified in Phase 2.2.5. |
| [DEC-3D-06](#dec-3d-06-world-coordinate-convention-and-unit-scale) | World Coordinate Convention and Unit Scale | **APPROVED** | Standard Three.js right-handed coordinate system (+Y Up, 1 unit = 1.0 meter). |
| [DEC-3D-07](#dec-3d-07-tactical-camera-director--viewport-modes) | Tactical Camera Director & Viewport Modes | **APPROVED** | Macro isometric perspective with department bookmarks and smooth target lerping. |
| [DEC-3D-08](#dec-3d-08-instanced-batching-and-avatar-level-of-detail-lod) | Instanced Batching and Avatar Level-of-Detail (LOD) | **PROPOSED** | Proposed optimization strategy to batch furniture; performance targets subject to empirical validation. |
| [DEC-3D-09](#dec-3d-09-deterministic-agent-visual-state-resolver) | Deterministic Agent Visual State Resolver | **PROPOSED** | Decouples authoritative business state from transient animation effects; animation never writes to DB. |
| [DEC-3D-10](#dec-3d-10-zero-trust-spatial-interaction-security) | Zero-Trust Spatial Interaction Security | **APPROVED** | All 3D clicks dispatch authenticated REST APIs; server resolves tenant membership from JWT. |
| [DEC-3D-11](#dec-3d-11-isolation-and-removal-of-client-side-demo-simulation) | Isolation & Removal of Client-Side Demo Simulation | **APPROVED** | Isolates fake `executeMissionPipeline` timer loops in Phase 3.2 in favor of real backend task APIs. |

---

### DEC-3D-01: 3D Rendering Framework Selection

- **Decision ID:** `DEC-3D-01`
- **Decision:** Adopt **React Three Fiber (R3F v9) + Three.js + Drei v10** with imperative frame loop mutations inside `useFrame`.
- **Status:** **APPROVED**
- **Evidence:**
  - File: `frontend/package.json` confirms `"three": "^0.186.1"`, `"@react-three/fiber": "^9.8.2"`, `"@react-three/drei": "^10.7.9"`, `"@react-three/postprocessing": "^3.2.2"`.
  - Files: [`frontend/components/world/WorldCanvas.tsx`](file:///Users/thienduc/Desktop/Code/provipagent/frontend/components/world/WorldCanvas.tsx#L1-L92) and [`frontend/components/world/OfficeArchitecture.tsx`](file:///Users/thienduc/Desktop/Code/provipagent/frontend/components/world/OfficeArchitecture.tsx) are already functioning in the React 19 / Next.js 16 environment.
- **Alternatives Considered:**
  1. *Vanilla Three.js (pure imperative loop outside React):* Rejected because lifecycle mounting, clean unmounting, raycasting, and postprocessing composability in React is more fragile.
  2. *Babylon.js:* Rejected because it is not installed, adds ~3.5MB to client bundles, and would require discarding all existing working components.
  3. *Unity / Unreal Engine WASM:* Rejected due to extreme payload sizes (>30MB), poor DOM integration, and inapplicability to dynamic web applications.
- **Consequences:**
  - Must enforce strict React rendering discipline: high-frequency spatial transforms must be mutated imperatively on Three.js object refs inside `useFrame`, never passed as rapidly changing React props.
- **Reversal Conditions:** If React 19 concurrent mode causes unresolvable reconciler panics in R3F that cannot be mitigated by Drei updates.

---

### DEC-3D-02: Decoupled Spatial Scene Store Architecture

- **Decision ID:** `DEC-3D-02`
- **Decision:** Isolate 3D spatial state (interpolated avatar positions, camera targets, visual states) into a dedicated store (`useSceneStore`), subscribing to authoritative enterprise state from `worldStore` via a one-way event bridge.
- **Status:** **PROPOSED**
- **Evidence:**
  - Graphify analysis and file inspection of [`frontend/store/worldStore.ts`](file:///Users/thienduc/Desktop/Code/provipagent/frontend/store/worldStore.ts#L484-L797) reveals high coupling: 2D modal states, chat logs, deliverable artifacts, and local 40ms animation timer loops all reside in one monolithic Zustand store.
- **Alternatives Considered:**
  1. *Continue expanding `worldStore.ts`:* Rejected because high-frequency spatial updates cause re-renders across unrelated 2D HUD components and modals.
  2. *Use React Context for 3D state:* Rejected because Context triggers re-render cascades across child component subtrees.
- **Consequences:**
  - Creates two focused stores: `worldStore` (authoritative enterprise business state) and `sceneStore` (spatial transforms and presentation state).
- **Reversal Conditions:** If performance profiling shows that a unified store with granular selectors produces equal or superior frame consistency without selector churn.

---

### DEC-3D-03: Multi-Tier Entity Identity Separation

- **Decision ID:** `DEC-3D-03`
- **Decision:** Establish an unambiguous **8-tier entity model** separating catalog capabilities from active runtime employees, visual entities, and loaded/rendered WebGL meshes:
  1. `SpecialistDefinition` (Catalog capability in `specialist_definitions`)
  2. `SpecialistVersion` (Immutable prompt snapshot in `specialist_versions`)
  3. `AgentModel` (Authoritative database record in `agents`)
  4. `ActiveAgent` (`AgentModel` with `RecruitmentRecordModel.lifecycle_state == 'ACTIVE'`)
  5. `VisualAgent` (Presentation entity in frontend Scene Store)
  6. `LoadedAgent` (Geometry and material buffers resident in browser memory)
  7. `RenderedAgent` (Loaded agent within camera frustum and submitted in draw call)
  8. `AnimatedAgent` (Rendered agent actively receiving bone/IK updates in `useFrame`)
- **Status:** **APPROVED**
- **Evidence:**
  - Database schema: `SpecialistDefinitionModel` ([`backend/app/models/specialist.py:21`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/specialist.py#L21)), `SpecialistVersionModel` ([`specialist.py:107`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/specialist.py#L107)), `AgentModel` ([`backend/app/models/agent.py:10`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/agent.py#L10)), and `RecruitmentRecordModel` ([`backend/app/models/recruitment.py:22`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/recruitment.py#L22)) already exist.
- **Alternatives Considered:**
  1. *1:1 mapping between catalog definitions and 3D avatars:* Rejected because spawning 268 avatars exhausts GPU memory and misrepresents unrecruited catalog roles as active employees.
  2. *Spawning avatars only when a task is active:* Rejected because agents would pop into existence and disappear, violating corporate operational continuity.
- **Consequences:**
  - Guarantees catalog browsing does not pollute the 3D scene.
  - Virtual fleet specialists operate without requiring loaded 3D meshes.
- **Reversal Conditions:** None. Conflating these layers causes architectural instability.

---

### DEC-3D-04: Backend Workstation Allocation Ownership

- **Decision ID:** `DEC-3D-04`
- **Decision:** The **backend owns workstation allocation authoritatively**. The 3D renderer only visualizes allocations recorded in backend state. Total physical capacity is governed by `ZONE_CONFIGS` in `workstation_service.py` (60 physical desks across 8 zones). When capacity is exceeded, the backend gracefully assigns `allocation_status = 'VIRTUAL'`, which the frontend renders as headless telemetry.
- **Status:** **APPROVED**
- **Evidence:**
  - File: [`backend/app/services/workstation_service.py:14-87`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/workstation_service.py#L14-L87) defines `ZONE_CONFIGS`: Engineering (12), AI Research (10), Marketing (8), Sales (8), Operations (6), Finance (6), Customer Success (6), Executive (4). Total = 60 desks.
  - Method: `WorkstationService.allocate_workstation` ([lines 99-253](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/workstation_service.py#L99-L253)) computes 3D coordinates, detects capacity overflow, and assigns virtual status.
  - Constraints: Partial unique index `uq_assigned_physical_desk` in [`backend/app/models/workstation.py:51-59`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/workstation.py#L51-L59) strictly prevents double-booking physical desks.
- **Alternatives Considered:**
  1. *Frontend-managed desk assignment:* Rejected because frontend state cannot guarantee cross-client consistency or database transaction integrity.
  2. *Arbitrary 48-desk limit:* Rejected because backend source code specifies 60 desks across its 8 zones.
- **Consequences:**
  - The frontend must never independently assign an agent to a desk.
  - Physical-to-virtual transitions never happen automatically in the frontend.
- **Reversal Conditions:** If dynamic multi-floor office building architecture is added in a future milestone.

---

### DEC-3D-05: Real-Time Event Replay & Snapshot Synchronization Protocol

- **Decision ID:** `DEC-3D-05`
- **Decision:** Implement reliable event synchronization with monotonic `sequence_id`, client replay requests (`{"action": "replay", "last_sequence_id": N}`), and authoritative snapshot fallback (`{"action": "resync"}`).
- **Status:** **APPROVED**
- **Evidence & Resolution:**
  - Codebase support: Migration `63860d006311` added `sequence_id` to `agent_events`. [`websocket_manager.py:252-280`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/websocket_manager.py#L252-L280) handles `resync` and `replay`.
  - **SECURITY RESOLUTION (Verified Phase 2.2.5):** In `websocket_manager.py:270-285` and `event_service.py:240-255`, `get_events_after` enforces strict `organization_id == conn_org` filtering. Migration `b8c9d0e1f2a3` added `organization_id` foreign key with `RESTRICT`. Replay frame client spoofing of `is_superadmin` or `organization_id` is rejected. Verified by 28 automated tests.
  - **ARCHITECTURAL CONTRACT RESOLUTION:** Monotonic database `sequence_id` produces strictly increasing sequences per tenant. Non-contiguous sequence jumps during live broadcasts reflect inter-tenant events and are tolerated by client high-watermark tracking (`last_applied_sequence_id = max(...)`). On reconnect, replay retrieves only tenant events with `sequence_id > last_applied_sequence_id`.
  - **SNAPSHOT WATERMARK RESOLUTION:** `build_initial_snapshot` queries `max(sequence_id)` and records within a read transaction, transmitting atomic `watermark_sequence_id`.
- **Alternatives Considered:**
  1. *REST polling every 3 seconds:* Rejected due to HTTP overhead and lack of real-time fidelity.
  2. *Unsequenced WebSocket broadcasts:* Rejected because dropped packets leave characters permanently frozen in stale states.
- **Consequences:** Frontend implementation of Phase 3.2 and 3.3 can safely consume the verified replay and snapshot endpoints.
- **Reversal Conditions:** None. Secure, scoped event replay is mandatory.

---

### DEC-3D-06: World Coordinate Convention and Unit Scale

- **Decision ID:** `DEC-3D-06`
- **Decision:** Standardize on **Three.js Standard Right-Handed Coordinates** with metric units:
  - `+Y is UP` (Ceiling/Sky)
  - `+X is EAST` (Right: Marketing & Sales)
  - `-X is WEST` (Left: Engineering & AI Research)
  - `-Z is NORTH` (Deep: Executive Suite & Boardroom)
  - `+Z is SOUTH` (Camera/Entrance: Operations & Lounge)
  - Exactly `1 Three.js unit = 1.0 meter`.
- **Status:** **APPROVED**
- **Evidence:**
  - Standardized across [`frontend/data/worldConfig.ts`](file:///Users/thienduc/Desktop/Code/provipagent/frontend/data/worldConfig.ts) and [`frontend/components/world/WorldCanvas.tsx`](file:///Users/thienduc/Desktop/Code/provipagent/frontend/components/world/WorldCanvas.tsx).
- **Alternatives Considered:**
  1. *Z-up convention (Blender native):* Rejected because Three.js defaults to Y-up, and converting coordinates in every R3F hook introduces unnecessary overhead.
  2. *Arbitrary unit scaling:* Rejected because lighting attenuation, character scale, and camera depth planes require a consistent metric baseline.
- **Consequences:** All imported 3D models (GLTF/GLB) must be exported with Y-up orientation.
- **Reversal Conditions:** None.

---

### DEC-3D-07: Tactical Camera Director & Viewport Modes

- **Decision ID:** `DEC-3D-07`
- **Decision:** Implement a **Tactical Isometric Perspective Camera** with predefined department bookmarks, boundary clamping, and smooth target lerping. Remove legacy One Piece naming (`ISLAND_CAMERA_BOOKMARKS`).
- **Status:** **APPROVED**
- **Evidence:**
  - Predefined bookmarks exist in [`frontend/data/worldConfig.ts:36-100`](file:///Users/thienduc/Desktop/Code/provipagent/frontend/data/worldConfig.ts#L36-L100). Smooth interpolation is managed by [`frontend/components/world/WorldCamera.tsx`](file:///Users/thienduc/Desktop/Code/provipagent/frontend/components/world/WorldCamera.tsx).
- **Alternatives Considered:**
  1. *Free-flying First/Third Person action camera:* Rejected as disorienting and inefficient for business operations.
  2. *Strict 2D Orthographic top-down camera:* Rejected because orthographic views obscure 3D monitors, facial gestures, and architectural depth.
- **Consequences:** Camera controller must clamp elevation (`Y >= 0.5m`) to prevent clipping through floors or furniture.
- **Reversal Conditions:** None.

---

### DEC-3D-08: Instanced Batching and Avatar Level-of-Detail (LOD)

- **Decision ID:** `DEC-3D-08`
- **Decision:** Batch repeated static office furniture (desks, chairs, monitors) using `THREE.InstancedMesh` and apply distance-based Level-of-Detail (LOD 0, LOD 1, LOD 2) to avatars. Convert prior performance claims (<45 draw calls, 60 FPS across 500 agents) to **proposed benchmark hypotheses** subject to empirical profiling.
- **Status:** **PROPOSED**
- **Evidence:**
  - Currently, [`frontend/components/world/OfficeFurniture.tsx`](file:///Users/thienduc/Desktop/Code/provipagent/frontend/components/world/OfficeFurniture.tsx) renders individual JSX groups for 6 desks. Instanced batching is an established Three.js optimization, but performance claims in prior docs lacked empirical measurement.
- **Alternatives Considered:**
  1. *Render every piece of furniture as an individual mesh:* Rejected because draw calls multiply rapidly.
  2. *Monolithic merged geometry:* Rejected because individual desks cannot support interactive highlights or dynamic monitor state changes.
- **Consequences:** Requires managing 4x4 instance matrices (`setMatrixAt`) instead of simple JSX positioning.
- **Reversal Conditions:** If benchmarks show that standard R3F memoization produces acceptable frame rates without instancing overhead on Tier 1 hardware.

---

### DEC-3D-09: Deterministic Agent Visual State Resolver

- **Decision ID:** `DEC-3D-09`
- **Decision:** Implement an `AgentVisualStateResolver` that deterministically derives presentation state (`IDLE`, `THINKING`, `WORKING`, `WAITING_APPROVAL`, `ERROR`, `OFFLINE`) from authoritative backend state (`TaskModel.status`, `AgentModel.status`, `RecruitmentRecordModel.lifecycle_state`). Transient animations (completion nod, error shake) run for a fixed timer and revert to resolved state. Animation state must **NEVER** write to backend or store state.
- **Status:** **PROPOSED**
- **Evidence:**
  - `dispatcher.py` sets `agent.status = "idle"` upon single task completion. The resolver prevents premature idle transitions if multiple tasks are active, and guarantees transient VFX cleanly expire.
- **Alternatives Considered:**
  1. *Allow animations to mutate store state on completion:* Rejected because local animation timers can desynchronize with authoritative backend execution.
- **Consequences:** All visual state transitions are predictable, testable headlessly, and idempotent.
- **Reversal Conditions:** None.

---

### DEC-3D-10: Zero-Trust Spatial Interaction Security

- **Decision ID:** `DEC-3D-10`
- **Decision:** 3D spatial clicks (e.g. clicking an agent or desk) cannot mutate application state directly or supply client-asserted tenant IDs. All mutations must invoke authenticated REST API endpoints with the user's JWT bearer token, with tenant membership validated server-side against `OrganizationMemberModel`.
- **Status:** **APPROVED**
- **Evidence:**
  - Phase 2.2.2 established server-side authorization in [`backend/app/core/auth.py:get_current_tenant_org`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/core/auth.py) and [`backend/app/websocket_manager.py:79-98`](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/websocket_manager.py#L79-L98).
- **Alternatives Considered:**
  1. *Allow 3D components to execute direct mutations:* Rejected as a critical security bypass of RBAC, audit logging, and tenant boundaries.
- **Consequences:** All interactive user actions incur network roundtrips (~20–80ms) and require optimistic or pending UI state indicators.
- **Reversal Conditions:** None. Permanent security invariant.

---

### DEC-3D-11: Isolation and Phased Removal of Client-Side Demo Simulation

- **Decision ID:** `DEC-3D-11`
- **Decision:** Isolate and eliminate `executeMissionPipeline` from [`frontend/store/worldStore.ts`](file:///Users/thienduc/Desktop/Code/provipagent/frontend/store/worldStore.ts#L484-L797). In Phase 3.2, gate it behind `NEXT_PUBLIC_ENABLE_DEMO_SIMULATION=false` and rewire [`InteractiveMissionTerminal.tsx`](file:///Users/thienduc/Desktop/Code/provipagent/frontend/components/hud/InteractiveMissionTerminal.tsx#L103) to dispatch real authenticated tasks to `POST /api/v1/tasks`. In Phase 3.4, remove the mock simulation loop completely once WebSocket event ingestion is verified.
- **Status:** **APPROVED**
- **Evidence:**
  - `worldStore.ts:484-797` executes fake timer loops (`setTimeout(r, 40)`, `setTimeout(r, 1500)`) generating hardcoded deliverables (`Enterprise_Autonomous_Platform_PRD.docx`, `Corporate_Financial_Forecast.xlsx`), completely bypassing backend tasks.
- **Alternatives Considered:**
  1. *Keep demo simulation active in parallel:* Rejected because fake telemetry directly conflicts with real backend task execution events.
- **Consequences:** Requires creating real backend tasks during UI testing rather than relying on synthetic mock deliverables.
- **Reversal Conditions:** None.

---

*End of Decision Log. All status tags strictly reflect verified codebase reality.*
