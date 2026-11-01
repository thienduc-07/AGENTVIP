# PROVIPAGENT — PHASE 3.2.5 AUDIT FINDINGS
**Independent Integration, Data Integrity & Security Audit**
**Date**: 2026-11-01  
**Audit Team**: Independent Principal Software Architect, Application Security Engineer, Distributed Systems Engineer, QA Automation Engineer  
**Status**: Initial Audit Completed — Findings Cataloged for Remediation  

---

## 1. Executive Summary of Audit Findings

The independent audit conducted a rigorous inspection across all six specified audit domains. While the high-level architecture adheres to the single source of truth principle, multiple hidden defects were identified in event stream ordering, workstation telemetry arithmetic, task creation idempotency, and state bridge rerender isolation.

| Finding ID | Severity | Domain | Title | Affected Component |
| :--- | :---: | :---: | :--- | :--- |
| **FINDING-325-01** | **HIGH** | Sync | Monotonic sequence discard bug drops valid out-of-order events | `frontend/lib/websocket/syncManager.ts` |
| **FINDING-325-02** | **HIGH** | Data | Workstation telemetry arithmetic contradiction violates physical desk invariants | `backend/app/api/v1/endpoints/workstations.py`<br>`frontend/lib/spatial/workstationMapper.ts` |
| **FINDING-325-03** | **MEDIUM** | Sync | Snapshot watermark race condition can cause skipped events on replay | `backend/app/services/event_service.py` |
| **FINDING-325-04** | **MEDIUM** | Data | Lack of task creation idempotency & reconciliation on network timeout | `backend/app/services/task_service.py`<br>`frontend/components/hud/InteractiveMissionTerminal.tsx` |
| **FINDING-325-05** | **MEDIUM** | State | StateBridge unconditionally re-projects scene visuals on every worldStore mutation | `frontend/lib/stateBridge.ts` |
| **FINDING-325-06** | **LOW** | Security | WebSocket authentication token exposed in URL query parameter | `backend/app/websocket_manager.py` |
| **FINDING-325-07** | **LOW** | Testing | Test assertions hardcode false telemetry arithmetic in test suite | `backend/app/tests/test_v1_workstations.py` |

---

## 2. Detailed Findings Catalog

### FINDING-325-01: Monotonic Sequence Discard Bug Drops Valid Out-of-Order Events
- **Severity**: **HIGH**
- **Domain**: Real-Time Event Synchronization
- **Evidence**: `frontend/lib/websocket/syncManager.ts:344-355`
  ```typescript
  // Strictly monotonic watermark: If sequence_id < lastAppliedSequenceId, it is already represented in snapshot
  if (sequence_id > 0 && sequence_id < this.lastAppliedSequenceId) {
    this.duplicateCount++;
    return false;
  }

  if (sequence_id > 0) {
    this.lastAppliedSequenceId = Math.max(this.lastAppliedSequenceId, sequence_id);
  }
  ```
- **Reproduction**:
  1. Authoritative snapshot hydrated with sequence 100. Watermark = 100.
  2. Live event A arrives with sequence 105. `lastAppliedSequenceId` jumps to 105.
  3. Live event B arrives with sequence 103 (e.g. from concurrent execution or packet reordering).
  4. Condition `103 < 105` evaluates to true: Event B is permanently discarded and counted as a duplicate, even though it was never applied.
- **Root Cause**: Conflating the authoritative snapshot hydration watermark with the live event deduplication boundary. In a live event stream, an event with a lower sequence ID than a previously observed event is not automatically a duplicate.
- **Impact**: Silent loss of business state updates when events arrive slightly out of sequence.
- **Recommended Fix**:
  - Maintain an explicit `snapshotWatermark`. Only events with `sequence_id <= snapshotWatermark` are discarded as "already in snapshot".
  - For events with `sequence_id > snapshotWatermark`, rely strictly on `processedEventIds.has(event_id)` for duplicate suppression.
  - Advance `lastAppliedSequenceId` to `Math.max(lastAppliedSequenceId, sequence_id)` upon successful application, while allowing any unseen event with `sequence_id > snapshotWatermark` to be processed.
- **Regression Test**: Send sequence 105, then sequence 103 (both > snapshot watermark 100). Verify sequence 103 is applied and listeners are notified.

---

### FINDING-325-02: Workstation Telemetry Arithmetic Contradiction Violates Physical Desk Invariants
- **Severity**: **HIGH**
- **Domain**: Data Integrity & Workstation Allocation
- **Evidence**: `backend/app/api/v1/endpoints/workstations.py:78-84, 107`
  ```python
  if alloc.allocation_status in ("ASSIGNED", "VIRTUAL"):
      dept_alloc_stats[dept_key]["allocated"] += 1

  if alloc.is_virtual or alloc.allocation_status == "VIRTUAL":
      dept_alloc_stats[dept_key]["virtual"] += 1
  elif alloc.allocation_status == "ASSIGNED" and alloc.desk_number is not None:
      dept_alloc_stats[dept_key]["physical_assigned"] += 1
  ...
  available_desks = max(0, cap - stats["physical_assigned"])
  ```
- **Reproduction**:
  1. Create 1 physical desk allocation and 1 virtual workforce allocation in Engineering (capacity: 12).
  2. Call `GET /api/v1/workstations/overview`.
  3. Response reports: `allocated_count = 2`, `available_physical_count = 11`, `max_physical_desks = 12`.
  4. Contradiction: $Allocated (2) + Available (11) = 13 \ne Capacity (12)$.
- **Root Cause**: The calculation added virtual workforce into `allocated_count` and `total_allocated`, while calculating `available` from physical desks only.
- **Impact**: Contradictory API telemetry violating the core invariant $Capacity = Allocated + Unallocated$.
- **Recommended Fix**:
  - Define `allocated_count` strictly as physical desks allocated (`physical_assigned`).
  - Calculate `reserved_unoccupied_count = allocated_count - physical_occupied_count`.
  - Calculate `available_physical_count = max_physical_desks - allocated_count`.
  - Isolate virtual workforce strictly to `virtual_count` and `total_virtual_workforce`.
  - Enforce the domain invariants:
    $$0 \le \text{Occupied} \le \text{Allocated} \le \text{Capacity}$$
    $$\text{Unallocated} = \text{Capacity} - \text{Allocated}$$
    $$\text{Reserved} = \text{Allocated} - \text{Occupied}$$
    $$\text{Capacity} = \text{Occupied} + \text{Reserved} + \text{Unallocated}$$
- **Regression Test**: Test all 8 zones and overall telemetry for strict arithmetic invariant satisfaction.

---

### FINDING-325-03: Snapshot Watermark Race Condition Can Cause Skipped Events on Replay
- **Severity**: **MEDIUM**
- **Domain**: Real-Time Event Synchronization
- **Evidence**: `backend/app/services/event_service.py:309-334`
  ```python
  all_agents = agent_query.all()
  active_tasks = task_query.filter(...).all()
  max_seq = seq_query.scalar() or 0
  ```
- **Reproduction**:
  1. Client connects; backend initiates `build_initial_snapshot`.
  2. `all_agents` and `active_tasks` are queried.
  3. A new task is created and event emitted at sequence 500.
  4. `seq_query` executes and reads `max_seq = 500`.
  5. Snapshot is returned with `last_sequence_id = 500`, but without the new task in `active_tasks`.
  6. Client later requests replay with `last_sequence_id = 500`.
  7. Backend returns events with `sequence_id > 500`, permanently skipping event 500!
- **Root Cause**: Reading the sequence watermark after querying entity records without a repeatable read transaction boundary.
- **Impact**: Events occurring during snapshot construction can be permanently missed during replay.
- **Recommended Fix**: Query `max_seq` BEFORE reading entity records. Any event committed after that point will have `sequence_id > max_seq` and will be replayed to the client.
- **Regression Test**: Verify snapshot watermark reflects the sequence ID prior to entity query.

---

### FINDING-325-04: Lack of Task Creation Idempotency & Reconciliation on Network Timeout
- **Severity**: **MEDIUM**
- **Domain**: Task Submission & Data Integrity
- **Evidence**: `frontend/components/hud/InteractiveMissionTerminal.tsx:163-191`, `backend/app/services/task_service.py:72-82`
- **Reproduction**:
  1. Client submits a task.
  2. Backend successfully creates the task record.
  3. Network timeout occurs before response arrives at client.
  4. Terminal sets `submissionState = "OUTCOME_UNKNOWN"`, then automatically resets to `IDLE` after 6 seconds.
  5. User clicks Send again -> A second duplicate task is created on the backend.
- **Root Cause**: `TaskCreate` schema and `TaskService` do not support client-generated task IDs or idempotency keys, and the frontend lacks a reconciliation loop.
- **Impact**: Duplicate task creation during network timeouts or poor connection conditions.
- **Recommended Fix**:
  - Add optional `id` (or `idempotency_key`) to `TaskCreate`.
  - In `TaskService.create_task`, if `id` is provided and a task with that ID already exists for the organization, return the existing task record idempotently.
  - In `InteractiveMissionTerminal`, generate a client task UUID before submitting, and on `OUTCOME_UNKNOWN`, offer an active reconciliation action.
- **Regression Test**: Call task creation twice with the same client task ID; verify exact same task record is returned with no duplicates.

---

### FINDING-325-05: StateBridge Unconditionally Re-projects Scene Visuals on Every WorldStore Mutation
- **Severity**: **MEDIUM**
- **Domain**: State Architecture & Performance
- **Evidence**: `frontend/lib/stateBridge.ts:81-83, 114-117`
  ```typescript
  this.unsubscribeWorldStore = useWorldStore.subscribe((state) => {
    this.projectWorldToScene(state);
  });
  ...
  const currentHash = `${agentsCount}:${tasksCount}`;
  // currentHash is never compared or saved, setBatchAgentVisuals runs unconditionally!
  useSceneStore.getState().setBatchAgentVisuals(nextVisuals);
  ```
- **Reproduction**:
  1. User types in chat terminal, triggering `addChatMessage` in `worldStore`.
  2. `projectWorldToScene` executes and calls `setBatchAgentVisuals`, creating a new `agentVisuals` object in `sceneStore`.
  3. Any 3D component subscribed to `agentVisuals` rerenders unnecessarily.
- **Root Cause**: Incomplete dirty-checking logic in `stateBridge.ts`.
- **Impact**: Redundant state recalculation and unnecessary React rerenders during chat and UI navigation.
- **Recommended Fix**: Memoize previous `agents` and `activeTasks` references or content hash. If neither changed, skip projection immediately.
- **Regression Test**: Mutate unrelated worldStore property (`addChatMessage`); verify `setBatchAgentVisuals` is NOT invoked.

---

### FINDING-325-06: WebSocket Authentication Token Exposed in URL Query Parameter
- **Severity**: **LOW**
- **Domain**: Application Security
- **Evidence**: `backend/app/websocket_manager.py:48-57`, `frontend/lib/websocket/syncManager.ts:167`
  ```typescript
  const url = `${this.wsUrl}?token=${encodeURIComponent(this.token)}&organization_id=${encodeURIComponent(this.organizationId)}`;
  ```
- **Impact**: JWT tokens may appear in server access logs, reverse proxies (NGINX/Cloudflare), and browser devtools URLs.
- **Recommended Fix**:
  - Support `Sec-WebSocket-Protocol` (`"bearer.<token>"`) in `websocket_manager.py` as a log-safe authentication mechanism for browser WebSockets.
  - Keep query param support for backward compatibility.
- **Regression Test**: Connect via WebSocket using `Sec-WebSocket-Protocol: bearer.<jwt>` without query token; verify successful authentication.

---

### FINDING-325-07: Test Assertions Hardcode False Telemetry Arithmetic
- **Severity**: **LOW**
- **Domain**: QA & Test Quality
- **Evidence**: `backend/app/tests/test_v1_workstations.py:184, 194-196`
  ```python
  assert telemetry["total_allocated"] == 2  # 1 physical + 1 virtual in Org A
  ...
  assert eng_zone["allocated_count"] == 2
  assert eng_zone["available_physical_count"] == 11  # 12 - 1 assigned desk
  ```
- **Impact**: Masks arithmetic contradiction by asserting contradictory values ($2 + 11 \ne 12$).
- **Recommended Fix**: Update assertions to reflect the corrected invariants: `allocated_count == 1`, `available_physical_count == 11`, `virtual_count == 1`, `total_allocated == 1`, `total_physical_available == 59`.
- **Regression Test**: Run updated test suite ensuring all invariants pass.

---

## 3. Remediation Strategy

We will remediate all findings systematically in order of priority:
1. **Sync Ordering & Snapshot Watermark**: Fix `syncManager.ts` (FINDING-325-01) and `event_service.py` (FINDING-325-03).
2. **Workstation Arithmetic & Telemetry**: Fix `workstations.py`, `workstationMapper.ts`, and `test_v1_workstations.py` (FINDING-325-02 & FINDING-325-07).
3. **Task Idempotency & Reconciliation**: Fix `task.py`, `task_service.py`, and `InteractiveMissionTerminal.tsx` (FINDING-325-04).
4. **StateBridge Performance**: Fix dirty-checking in `stateBridge.ts` (FINDING-325-05).
5. **WebSocket Log Security**: Add `Sec-WebSocket-Protocol` token extraction in `websocket_manager.py` (FINDING-325-06).
6. **Regression Verification**: Write and run automated tests for every fix.
