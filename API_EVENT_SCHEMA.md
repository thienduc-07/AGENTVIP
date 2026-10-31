# PROVIPAGENT — AUTHORITATIVE EVENT CONTRACT & SCHEMA
**Version**: `1.0.0-draft`
**Protocol**: JSON over WebSocket (`/api/v1/events/ws`) & REST Event Archives (`/api/v1/events`)
**Design Standard**: Typed, Monotonic, Idempotent, Multi-Tenant Event Envelopes

---

## 1. Core Event Envelope Structure

Every event emitted by the PROVIPAGENT backend adheres to the following unified schema:

```json
{
  "event_id": "evt_7f8a9b1c2d3e4f50",
  "event_type": "task.execution.started",
  "schema_version": "1.0",
  "organization_id": "org_enterprise_001",
  "project_id": "proj_ecommerce_v1",
  "task_id": "task_a1b2c3d4e5f6",
  "specialist_id": "spec-eng-arch-01",
  "execution_id": "exec_99a8b7c6d5e4",
  "timestamp": "2026-10-31T19:55:00.000000Z",
  "sequence_id": 489,
  "correlation_id": "corr_req_11223344",
  "payload": {
    "step_index": 2,
    "activity": "WRITING",
    "details": "Authoring technical architecture specification in workspace_sandbox/"
  }
}
```

### 1.1 Envelope Field Definitions

| Field Name | Type | Requirement | Description |
| :--- | :--- | :--- | :--- |
| `event_id` | `String` (UUID/hex) | Required | Globally unique identifier for this event instance. |
| `event_type` | `String` (dotted) | Required | Standardized hierarchical event type (e.g., `task.execution.progress`). |
| `schema_version` | `String` | Required | Schema version string (currently `"1.0"`). |
| `organization_id` | `String` | Required | Identifier of the tenant company that owns the project/workforce. |
| `project_id` | `String` | Optional | Identifier of the corporate initiative/project (null for global org events). |
| `task_id` | `String` | Optional | Unique identifier of the associated task or DAG subtask. |
| `specialist_id` | `String` | Optional | Unique slug/ID of the specialist definition (`specialist_definitions.id`). |
| `execution_id` | `String` | Optional | Active execution loop instance ID (null if agent is idle/catalog). |
| `timestamp` | `String` (ISO 8601) | Required | Authoritative UTC timestamp of event occurrence. |
| `sequence_id` | `Integer` | Required | Monotonically increasing sequence ID per organization for ordering & replay. |
| `correlation_id` | `String` | Required | Originating trace ID to correlate multi-agent requests and parent tasks. |
| `payload` | `JSON Object` | Required | Domain-specific structured event payload. |

---

## 2. Standardized Event Catalog

### 2.1 Specialist Workforce Lifecycle Events

| Event Type | Trigger Condition | 3D Visual State Transition | Key Payload Fields |
| :--- | :--- | :--- | :--- |
| `specialist.recruited` | CEO or HR Leader recruits a specialist from the global catalog into an organization. | Allocates workstation; character spawns at department doorway or walks in. | `agent_id`, `department`, `manager_id`, `station`, `budget_limit_usd` |
| `specialist.activated` | Recruited specialist initialized in memory with execution context. | Character transitions to `AVAILABLE` at assigned desk. | `agent_id`, `model_preference`, `permission_profile` |
| `specialist.suspended` | Daily task limit reached, budget ceiling hit, or manual hold placed. | Character transitions to `WAITING` or leaves desk to lounge. | `agent_id`, `reason`, `spend_usd`, `budget_limit_usd` |
| `specialist.retired` | Organization archives or offboards the specialist. | Character packs desk, walks to elevator, and de-spawns. | `agent_id`, `effective_at`, `total_tasks_completed` |

### 2.2 Task & Workflow Lifecycle Events

| Event Type | Trigger Condition | 3D Visual State Transition | Key Payload Fields |
| :--- | :--- | :--- | :--- |
| `task.created` | Customer or CEO registers a new business objective. | Displays notification ping on CEO terminal & Executive Suite. | `title`, `priority`, `assigned_agent_id`, `parent_task_id` |
| `task.assigned` | MultiAgentPlanner assigns subtask to a specific department specialist. | Task telemetry beam (`TaskHandoffVFX`) travels from manager to specialist. | `assigned_agent_id`, `subtask_key`, `dependencies` |
| `task.execution.started` | `ExecutionLoop` launches LLM reasoning/execution loop. | Specialist transitions to `WORKING` / `THINKING` (typing animation, glowing status ring). | `execution_id`, `step_index`, `max_iterations`, `tools_whitelisted` |
| `task.execution.progress` | Tool called (file read, calculation, code search). | Specialist transitions to `READING`, `WRITING`, or displays tool badge above avatar. | `tool_name`, `arguments_summary`, `iteration` |
| `task.completed` | Verifier verifies deliverable; subtask completes successfully. | Specialist transitions to `COMPLETED` (green beacon, brief celebration cue). | `result_summary`, `artifact_ids`, `duration_ms`, `tokens_used` |
| `task.failed` | Unrecoverable error, timeout, or validation rejection. | Specialist transitions to `ERROR` (red pulsing beacon, alert badge). | `error_message`, `retry_count`, `fatal` |

### 2.3 Collaboration & Meeting Events

| Event Type | Trigger Condition | 3D Visual State Transition | Key Payload Fields |
| :--- | :--- | :--- | :--- |
| `collaboration.started` | Subtask dependency requires direct inter-agent data handoff or review. | Characters navigate to adjacent desks or meeting table; transition to `COLLABORATING`. | `from_agent_id`, `to_agent_id`, `subtask_contract_id` |
| `collaboration.completed`| Data contract accepted; review verdict signed off. | Characters return to home workstations; transition to `AVAILABLE`. | `verdict`, `duration_ms`, `contract_hash` |
| `meeting.convened` | CEO / Department Manager initiates cross-discipline alignment. | All participating agents walk along waypoints to Glass Conference Room; `IN_MEETING`. | `meeting_id`, `agenda`, `participants: List[agent_id]`, `room: "boardroom"` |
| `meeting.adjourned` | Strategic directive finalized; subtasks assigned. | Participants disperse along waypoints back to department desks. | `meeting_id`, `outcome_summary`, `tasks_spawned` |

### 2.4 Governance, Security & High-Impact Approval Events

| Event Type | Trigger Condition | 3D Visual State Transition | Key Payload Fields |
| :--- | :--- | :--- | :--- |
| `approval.requested` | Agent requests execution of Level 2 tool (file write, script exec, external call). | Agent transitions to `WAITING` / `BLOCKED`; amber beacon; HUD renders Approval Modal. | `approval_id`, `tool_name`, `risk_level`, `payload_preview` |
| `approval.granted` | Human owner clicks "Authorize Execution". | Agent resumes execution (`WORKING`); beacon turns blue. | `approval_id`, `authorized_by`, `authorized_at` |
| `approval.rejected` | Human owner clicks "Deny". | Agent aborts action; replans alternative path. | `approval_id`, `rejection_reason` |

### 2.5 Cost, Budget & Token Metering Events

| Event Type | Trigger Condition | 3D Visual State Transition | Key Payload Fields |
| :--- | :--- | :--- | :--- |
| `budget.warning` | Task or specialist spend crosses 80% of authorized budget. | Subtle amber warning ring on department floor HUD. | `budget_limit_usd`, `current_spend_usd`, `pct_used` |
| `budget.exhausted` | Budget limit reached (100%); hard stop triggered. | Execution automatically paused; specialist transitions to `BLOCKED`. | `budget_limit_usd`, `spend_usd`, `overage_prevented_usd` |

---

## 3. Protocol Guarantees & Fault Tolerance

```
[Client App]                                                 [FastAPI + ws_manager]
     │                                                                 │
     │── 1. WS Connect (with JWT & org_id header) ────────────────────►│
     │                                                                 │ (Auth & origin check)
     │◄── 2. Authoritative Snapshot {last_sequence_id: 520, agents...}─│
     │                                                                 │
     │── 3. Normal Event Stream (521, 522, 523...) ───────────────────►│
     │                                                                 │
   [Network Disconnect / Reconnect]                                    │
     │                                                                 │
     │── 4. WS Reconnect with { action: "replay", last_sequence_id: 523 }─►│
     │                                                                 │ (Queries events where seq > 523)
     │◄── 5. Replay Batch [524, 525, 526] ─────────────────────────────│
     │                                                                 │
     │◄── 6. Resumes Live Real-time Stream (527+) ─────────────────────│
```

1. **Monotonic Sequence Ordering**:
   - `sequence_id` is an auto-incrementing integer assigned inside a transaction in `agency.db`.
   - The frontend drops any incoming message whose `sequence_id <= lastProcessedSequenceId`.

2. **Idempotent Client Processing**:
   - Every event maintains a UUID `event_id`.
   - The Zustand store (`worldStore.ts`) retains a rolling ring buffer of `processedEventIds: string[]` (capacity: 500). If an event arrives with an existing `event_id`, it is acknowledged and ignored.

3. **Reconnection & Missed-Event Recovery**:
   - When a WebSocket client reconnects after temporary network loss, it issues a replay handshake:
     ```json
     {
       "action": "replay",
       "organization_id": "org_enterprise_001",
       "last_sequence_id": 523
     }
     ```
   - The backend retrieves all event envelopes from `agent_events` where `sequence_id > 523` and streams them in strict ascending order before resuming live events.

4. **Authoritative State Snapshots**:
   - If the client's `last_sequence_id` is missing or older than 1,000 events, the server sends a full state snapshot (`message_type: "snapshot"`) containing active agent states, pending approvals, and active tasks. This prevents massive replay overhead.
