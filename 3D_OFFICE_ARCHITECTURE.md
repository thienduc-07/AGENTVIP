# PROVIPAGENT — 3D OFFICE ARCHITECTURE & VISUAL RUNTIME
**Interactive Corporate Headquarters Specification**
**Technology Foundation**: React 19 + React Three Fiber (`@react-three/fiber`) + Three.js (`three`) + Drei (`@react-three/drei`) + Zustand (`worldStore.ts`)
**Design Reference**: My Office (`scratch/my-office`) Adapted into Scalable Enterprise Multi-Agent HQ

---

## 1. Architectural Philosophy: The Real-Time Reflection Principle

In PROVIPAGENT, the 3D office is **strictly an observational telemetry and interaction surface**, not an autonomous simulation.

```
                                  [Real AI Execution]
                                 Task / Orchestrator / LLM
                                            │
                                            ▼
                               [Authoritative Backend Event]
                                (e.g., task.execution.started)
                                            │
                                            ▼
                               [WebSocket Event Envelope]
                                            │
                                            ▼
                           [Zustand Store (`worldStore.ts`)]
                                            │
                                            ▼
                    ┌────────────────────────────────────────────────┐
                    │      3D Office Visual Engine (React Three)     │
                    │                                                │
                    │  - Character State Machine (IDLE -> WORKING)   │
                    │  - Waypoint Navigation (Walking to Station)    │
                    │  - Procedural Attire & Department Styling      │
                    │  - Telemetry Beacons & Data VFX Streams        │
                    └────────────────────────────────────────────────┘
```

**Golden Rules**:
1. Characters in the 3D world **NEVER** invent their own state.
2. A specialist character is `WORKING` only if a real AI execution loop is active in the backend.
3. A character enters `IN_MEETING` only when a multi-agent dependency or joint review event is issued by the orchestrator.
4. No background decorative agents wandering aimlessly without backend entity binding.

---

## 2. Scalable Performance Architecture (268+ Specialists)

While PROVIPAGENT supports an imported workforce of 268+ specialists, rendering 268 skeletal skinned meshes with real-time soft shadows will cripple browser performance on non-discrete GPUs.

The system implements a **Tiered Workforce Hydration Architecture**:

```
+-----------------------------------------------------------------------------------------+
| TOTAL SPECIALIST CATALOG (268+ Specialists in Database)                                  |
|   - 0 model tokens consumed                                                             |
|   - 0 Three.js geometry memory                                                          |
+-----------------------------------------------------------------------------------------+
                                      │
                                      ▼ (Recruitment Action)
+-----------------------------------------------------------------------------------------+
| ORGANIZATION WORKFORCE (e.g., 20 - 50 Recruited Specialists)                            |
|   - Assigned department and desk workstation                                            |
|   - Stored in database `recruitment_records`                                            |
+-----------------------------------------------------------------------------------------+
                                      │
           ┌──────────────────────────┴──────────────────────────┐
           ▼                                                     ▼
+---------------------------------------+ +-----------------------------------------------+
| IDLE WORKFORCE (At Desks, Dormant)    | | ACTIVE WORKFORCE (Executing Tasks / Meetings) |
| - High-performance instanced geometry | | - Fully hydrated dynamic avatar               |
| - Skeletal animations throttled to 5Hz| | - 60 FPS smooth procedural animations         |
| - Far LOD / silhouette shading        | | - Active typing, gestures, telemetry beacons  |
+---------------------------------------+ +-----------------------------------------------+
```

### 2.1 Optimization Techniques

1. **Frustum Culling & Visibility-Based Ticking**:
   - Every agent group is wrapped in bounding spheres. When outside the camera frustum, procedural `useFrame` vertex updates are completely paused.

2. **Hierarchical Level of Detail (LOD)**:
   - **LOD 0 (< 12 meters)**: Full procedural avatar with tailored suit geometry, tie/scarf, metallic watch, lanyard ID badge, blinking eyes, and typing fingers.
   - **LOD 1 (12 - 35 meters)**: Simplified capsule torso, head, and limbs with unlit flat department-toned materials.
   - **LOD 2 (> 35 meters)**: Instanced glowing status pin and desk light indicator (zero skeletal calculations).

3. **Animation Throttling by Distance**:
   - Characters within 8 meters animate at full 60 FPS.
   - Characters between 8–25 meters update procedural arm movements on alternate frames (30 FPS).
   - Characters beyond 25 meters update at 10 FPS.

4. **Instanced Prop Rendering**:
   - Identical office furniture (ergonomic chairs, 4K monitors, keyboard/mouse mats, planters) are rendered using Three.js `InstancedMesh`. 50 desks consume only 4 draw calls instead of 300+.

5. **Office Capacity & Dynamic Desk Pooling**:
   - Physical office floor provides **48 active workstations** divided across department pods.
   - If an organization recruits more specialists than available desk pods, specialists are rotated: active specialists occupy desks, while idle specialists can be displayed in the executive lounge, library, or retrieved on-demand via the Talent HUD without cluttering the scene.

---

## 3. The 13-State Visual Character Machine

Every character's appearance and posture maps directly to the following state machine:

| Visual State | Visual Presentation & Posture | Triggering Backend Event |
| :--- | :--- | :--- |
| `IDLE` | Sitting straight at desk, subtle breathing, occasional slow head glance. | `agent.idle`, `task.step.completed` |
| `AVAILABLE` | Relaxed seated posture; green indicator ring; ready for task dispatch. | `specialist.activated`, `task.completed` |
| `WORKING` | Leaning slightly forward; rapid procedural arm typing on keyboard. | `task.execution.started`, `tool.execution_started` |
| `READING` | Head tilted downward; holding virtual tablet/paper or gazing at screen. | `task.execution.progress` (tool: `file_read`, `data.inspect`) |
| `WRITING` | Focused typing with rhythmic pause; creating sandbox artifact. | `task.execution.progress` (tool: `workspace_write`, `artifact.create`) |
| `THINKING` | Head tilted slightly up; subtle pulsing amber glow around avatar head. | LLM reasoning phase between tool calls (`thought` chunk stream) |
| `IN_MEETING` | Sitting/standing at boardroom conference table with open notebook. | `meeting.convened`, `workflow.review_started` |
| `COLLABORATING`| Positioned adjacent to peer specialist's desk; periodic nodding. | `collaboration.started`, `agent.delegated` |
| `WAITING` | Hands resting on lap; gentle head sway; waiting on external API. | Long-running asynchronous execution or batch query |
| `REVIEWING` | Standing inspecting peer deliverable; audit checklist badge active. | QA specialist verifying subtask contract (`verifier.py`) |
| `BLOCKED` | Arms folded; steady amber warning halo above head. | `approval.requested`, `budget.warning` |
| `COMPLETED` | Brief fist pump / celebratory nod; pulsing emerald confirmation ring. | `task.completed`, `workflow.completed` |
| `ERROR` | Head lowered; red flashing warning beacon; status badge reads `ERROR`. | `task.failed`, `subtask.failed` |

---

## 4. Scalable Department Layout & Waypoint Navigation

The office layout is organized as a **high-end modern corporate penthouse** spanning a 44m × 34m architectural grid.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                                SKYLINE SKYBRIDGE                              │
├───────────────────────┬───────────────────────────────┬───────────────────────┤
│    ENGINEERING BAY    │        EXECUTIVE SUITE        │     AI RESEARCH LAB   │
│   (12 Workstations)   │        (CEO & Strategy)       │    (10 Workstations)  │
│    Slate / Cyan       │        Navy / Gold            │     Indigo / Violet   │
├───────────────────────┼───────────────────────────────┼───────────────────────┤
│                       │    CENTRAL GLASS BOARDROOM    │                       │
│      WEST AISLE       │     (12-Seat Meeting Table)   │      EAST AISLE       │
│                       │        Waypoints: M0 - M11    │                       │
├───────────────────────┼───────────────────────────────┼───────────────────────┤
│   MARKETING STUDIO    │     CUSTOMER SUCCESS LOUNGE   │      SALES WING       │
│    (8 Workstations)   │     & KNOWLEDGE RECEPTION     │    (8 Workstations)   │
│     Amber / Coral     │        Teal / Sand            │     Emerald / Mint    │
├───────────────────────┴───────────────────────────────┴───────────────────────┤
│        OPERATIONS & FINANCE CORE (8 Workstations - Operations & CFO Hub)      │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Department Pods & Coordinates

| Department Pod | Station Key | Base Position `[X, Y, Z]` | Floor Material / Color Accent |
| :--- | :--- | :--- | :--- |
| **Executive Suite** | `executive_suite` | `[0.0, 0.0, -12.0]` | Polished Terrazzo + Navy Wool (`#0f172a`) |
| **Engineering Bay** | `engineering_bay` | `[-14.0, 0.0, -4.0]` | Brushed Aluminum + Slate Carpet (`#0f172a`) |
| **AI Research Lab** | `research_lab` | `[14.0, 0.0, -4.0]` | Technical Glass + Indigo Carpet (`#1e1b4b`) |
| **Marketing Studio** | `marketing_studio` | `[-14.0, 0.0, 10.0]`| Creative Oak + Amber Accent (`#271b1e`) |
| **Sales Wing** | `sales_wing` | `[14.0, 0.0, 10.0]` | Leather Trim + Emerald Accent (`#062e24`) |
| **Operations Hub** | `operations_hub` | `[-6.0, 0.0, 20.0]` | Modern Steel + Cyan Carpet (`#06b6d4`) |
| **Finance Office** | `finance_office` | `[6.0, 0.0, 20.0]` | Dark Walnut + Gold Slate (`#eab308`) |
| **Support Lounge** | `support_lounge` | `[0.0, 0.0, 11.0]` | Greige Textile + Teal Cushion (`#132a2f`) |
| **Central Boardroom**| `boardroom` | `[0.0, 0.0, 0.0]` | Acoustic Glass + Conference Table |

### 4.2 Waypoint Walking Graph (My Office Adaptation)

To avoid awkward teleportation, characters move using a clean **Waypoint Pathfinding Network**:

```text
[Desk Spot] ──► [Aisle Node] ──► [Corridor Node] ──► [Boardroom Door] ──► [Meeting Seat]
```

1. **Waypoints (Nodes)**:
   - Placed along clear walking lanes between furniture pods, ensuring characters never clip through desks, walls, or monitors.
2. **Path Generation**:
   - Breadth-First Search (BFS) / Dijkstra computes the shortest collision-free sequence of waypoints between any desk spot and destination (meeting seat, colleague's desk, coffee station).
3. **Motion Smoothing**:
   - `CatmullRomCurve3` splines interpolate positions.
   - Rotation is smoothed using `THREE.Quaternion.slerp` towards the facing tangent of the curve.
