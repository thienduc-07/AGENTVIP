# PROVIPAGENT — Phase 4.1: Real-Time Event Report
## Milestone 5 Event Streaming, Monotonic Sequencing, and State Transitions

**Version:** 1.0.0  
**Date:** 2026-11-02  
**Baseline Git Checkpoint:** `2209f67faa875ed0bfe2fd91009a81f17e3652e2`  
**Streaming Protocol:** WebSocket (`/api/v1/events/ws`), Milestone 5 Envelope Standard  

---

### 1. Milestone 5 Envelope Protocol Specification

All real-time communications flow through the Milestone 5 Event Envelope schema, guaranteeing distributed auditability, causation tracking, and monotonic sequencing:

```typescript
export interface EventEnvelope {
  schema_version: number;        // Monotonically increasing schema (1)
  event_id: string;              // Unique UUIDv4 (e.g. "evt_abc123")
  event_type: string;            // Namespaced event type (e.g. "agent.behavioral_state_changed")
  occurred_at: string;           // ISO 8601 UTC timestamp
  sequence_id: number;           // Authoritative monotonically increasing sequence number
  organization_id: string;       // Multi-tenant organization isolation scope
  agent_id?: string | null;      // Subject agent identifier
  task_id?: string | null;       // Associated task scope
  correlation_id?: string | null;// Request origin trace identifier
  causation_id?: string | null;  // Parent event trigger
  payload: Record<string, any>;  // Event-specific typed data
}
```

---

### 2. Supported Event Types & 3D Spatial Transitions

The Phase 4.1 3D Office ingests 6 core event families, translating discrete backend database events into fluid 3D visual reactions:

#### 2.1 `agent.behavioral_state_changed`
- **Trigger**: Emitted whenever an agent transitions between any of the 9 canonical behavioral states (`IDLE`, `QUEUED`, `ASSIGNED`, `IN_PROGRESS`, `WAITING`, `REVIEW`, `COMPLETED`, `FAILED`, `CANCELLED`).
- **3D Office Effect**:
  - Updates the agent's `<AgentAvatar>` mesh material and floating billboard badge.
  - Changes the status beacon ring color to match `CANONICAL_STATE_CONFIGS[state].beaconColor`.
  - Dynamically alters the emissive display screen color of the agent's assigned workstation (`Workstation.tsx`).
  - Adjusts avatar animation cycle (e.g. typing posture for `IN_PROGRESS`, arm-folding for `REVIEW`, celebratory wave for `COMPLETED`).

#### 2.2 `agent.movement_started`
- **Trigger**: Emitted when the CEO or workforce orchestrator dispatches an agent to navigate across departments (e.g. from Executive Suite to AI Research Lab).
- **3D Office Effect**:
  - Parses `payload.target_position` into 3D world coordinates `[target_x, target_y, target_z]`.
  - Sets `isMoving = true`.
  - Switches avatar animation to walking gait with reciprocal limb oscillations.
  - Updates target destination tag in the floating billboard.

#### 2.3 `agent.movement_completed`
- **Trigger**: Emitted by backend `SpatialNavigationService` upon arrival at the target destination or workstation.
- **3D Office Effect**:
  - Reconciles agent position strictly to `payload.position`.
  - Clears `targetPosition` to `null`.
  - Sets `isMoving = false`.
  - Transitions avatar animation back to `idle` or seated `working` posture.

#### 2.4 `tool.execution_started`
- **Trigger**: Emitted when an agent invokes an operational tool (e.g. `bash_sandbox_exec`, `web_search`, `write_artifact`).
- **3D Office Effect**:
  - Immediately transitions agent to `IN_PROGRESS`.
  - Updates billboard task status to `Đang chạy công cụ: <tool_name>`.
  - Activates high-frequency typing animation and workstation screen data streams.

#### 2.5 `task.completed` & `subtask.completed`
- **Trigger**: Emitted when all execution deliverables have passed validation gates and the task successfully concludes.
- **3D Office Effect**:
  - Transitions agent to `COMPLETED` (`#10b981`).
  - Clears active task title.
  - Triggers brief celebration posture.
  - Updates HUD active task metrics.

#### 2.6 `task.failed` & `subtask.failed`
- **Trigger**: Emitted when an unrecoverable exception, timeout, or validation failure occurs.
- **3D Office Effect**:
  - Transitions agent to `FAILED` (`#ef4444`).
  - Displays error reason `Lỗi: <error_message>` in the floating billboard.
  - Triggers red distress beacon.

---

### 3. Monotonic Watermark Sequencing & Out-of-Order Rejection

Under concurrent multi-agent workloads, WebSocket events may arrive out of order due to network multiplexing. The 3D Office enforces strict monotonic sequencing:

```typescript
// useOfficeSync.ts
if (evSeq && evSeq > 0) {
  setSequenceId((prev) => Math.max(prev, evSeq));
}
```

1. **Monotonic Watermark**: The HUD and state stores track `sequenceId`. Any event with an older `sequence_id` cannot roll back the sequence counter.
2. **Snapshot Reconciliation**: When a snapshot arrives, its `sequence_id` is compared with the current watermark. If an older snapshot arrives late, it is discarded to prevent stale state from overwriting real-time updates.
3. **No Event Fabrication**: The event ingestion loop strictly reads from `envelope.payload`. If an event lacks payload data, defaults are applied safely without inventing synthetic entities.

---

### 4. Connection State Machine & Auto-Recovery

The WebSocket connection (`syncManager.ts`) implements an exponential-backoff resilient state machine:

```
[ DISCONNECTED ] ---> [ CONNECTING ] ---> [ CONNECTED ]
      ^                      |                   |
      |                      v                   v
      +-------------- [ RECONNECTING ] <--- [ ERROR / TIMEOUT ]
```

- **`CONNECTED`**: Renders glowing green `LIVE SYNC` badge with sequence counter.
- **`CONNECTING`** / **`RECONNECTING`**: Displays pulsing amber indicator; existing 3D scene remains interactive and does not flicker or unmount.
- **`ERROR`**: Non-blocking toast with retry button.

