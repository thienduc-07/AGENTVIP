# PROVIPAGENT — Phase 3.5 Idempotency Report
## End-to-End Idempotency, External Side-Effect Boundaries & Tool Semantics Audit

**Date:** November 2, 2026  
**Auditor:** Principal Distributed Systems Engineer & Application Security Architect  
**Project:** PROVIPAGENT — Autonomous AI Company OS  
**Status:** PASS — Explicitly Bounded Execution Semantics  
**Test Suite:** `backend/app/tests/test_phase3_5_2_idempotency_side_effects.py` (10/10 Passed)  

---

### 1. Executive Summary

Idempotency in autonomous multi-agent systems is frequently misunderstood as simple in-memory deduplication. This audit establishes the fundamental architectural boundary between **internal tool-call caching** and **external distributed side effects**.

While internal caching (`executed_call_ids`) prevents an agent from re-running the same tool call *within an active execution turn*, it does NOT guarantee exactly-once execution against external payment gateways, partner APIs, or filesystem writes across process restarts.

In Phase 3.5.2, PROVIPAGENT explicitly formalized the execution semantics of every tool in its runtime registry (`ToolExecutionSemantics`), enforced tenant-scoped task idempotency, enabled stable key propagation (`Idempotency-Key` and `X-Request-Id`) to external API partners, and validated all 10 failure and recovery scenarios with automated tests.

---

### 2. Tool Execution Semantics Classification

Every tool in the PROVIPAGENT registry is formally categorized under one of four execution semantics:

| Tool Category | Tools Included | Side Effect Level | Execution Semantics | Idempotency Guarantee Mechanism |
|:---|:---|:---:|:---:|:---|
| **Workspace Inspection** | `workspace.read_file`, `workspace.list`, `workspace.search`, `calculator` | Read-Only | **Effectively-Once** | Pure read operations; multiple evaluations produce identical outcomes with zero state mutation. |
| **Workspace Mutation** | `workspace.write_file`, `artifact.create`, `artifact.verify` | Reversible Mutation | **Effectively-Once** | Atomic POSIX replacement (`.tmp.{uuid}` $\to$ `os.replace`), name-based upsert in database, and deterministic SHA-256 digesting. |
| **Corporate Memory** | `memory.search`, `memory.get`, `memory.propose`, `memory.archive` | Mutation / Query | **Effectively-Once** | Queries are pure reads; memory candidate proposals are deduplicated by hash and scoped to `organization_id`. |
| **External API** | `api.call` (GET) | Read-Only | **Effectively-Once** | Safe HTTP GET queries to allowlisted partner endpoints. |
| **External API** | `api.call` (POST) | High Risk | **At-Least-Once** | Propagates `Idempotency-Key` and `X-Request-Id` derived from the workflow task context. Dependent on provider adherence. |
| **Command Execution** | `command.exec` (System commands) | High Risk | **Unknown / Unbounded** | Requires mandatory Human-in-the-Loop (HITL) approval gate before execution; cannot be assumed idempotent. |

---

### 3. Detailed Verification of the 10 Required Scenarios

All 10 scenarios in `test_phase3_5_2_idempotency_side_effects.py` were executed and verified:

#### Scenario 1: Same Task Submitted Twice
- **Mechanism:** Client submits identical `idempotency_key` within the same organization.
- **Result:** `task_service.create_task` queries `(organization_id, idempotency_key)` index and returns the existing task record without inserting a duplicate row.
- **Verification:** Verified in `test_3_5_2_01_same_task_submitted_twice` (count = 1).

#### Scenario 2: Same Idempotency Key Across Different Organizations
- **Mechanism:** Tenant A and Tenant B submit tasks with the identical idempotency key string.
- **Result:** Both organizations receive distinct tasks scoped to their respective `organization_id`. Neither tenant collides or overwrites the other.
- **Verification:** Verified in `test_3_5_2_02_same_idempotency_key_different_organizations`.

#### Scenario 3: Worker Crashes Before Execution Begins
- **Mechanism:** Task is dequeued and marked `running`, but worker process crashes before turn 1.
- **Result:** `recover_abandoned_tasks` identifies the abandoned task, evaluates retry policy, increments `retry_count`, and returns it to `queued`.
- **Verification:** Verified in `test_3_5_2_03_worker_crashes_before_execution`.

#### Scenario 4: Worker Crashes During Execution
- **Mechanism:** Worker crashes after completing 2 of 5 planning iterations.
- **Result:** Crash recovery checks retry limits. If retries remain, re-queued; if `retry_count >= max_retries`, task transitions to terminal `failed` dead-letter state while assigned agent is released to `IDLE`.
- **Verification:** Verified in `test_3_5_2_04_worker_crashes_during_execution`.

#### Scenario 5: Worker Crashes After External Operation Before Saving Result
- **Mechanism:** Agent writes verified deliverable to disk, but crashes before finalizing the parent task status.
- **Result:** `recover_abandoned_tasks` inspects `output_data_json["deliverable"]`. Because `verification_status == "VERIFIED"`, it finalizes the task as `completed` without re-running inference or tools.
- **Verification:** Verified in `test_3_5_2_05_worker_crashes_after_external_op_before_saving_result`.

#### Scenario 6: Retry After an Ambiguous Timeout
- **Mechanism:** An external call times out; worker cannot know if the remote server processed the payload.
- **Result:** `ApiCallTool` automatically injects `Idempotency-Key: {task_id}` into HTTP headers, allowing remote servers supporting IETF Idempotency Key standards to deduplicate repeated attempts.
- **Verification:** Verified in `test_3_5_2_06_retry_after_ambiguous_timeout`.

#### Scenario 7: Duplicate Tool Invocation Deduplication
- **Mechanism:** LLM emits duplicate tool call with identical `call_id` in same turn.
- **Result:** `TaskContext.executed_call_ids` serves the cached execution result instantly without re-invoking the underlying tool function.
- **Verification:** Verified in `test_3_5_2_07_duplicate_tool_invocation_deduplication`.

#### Scenario 8: Duplicate Artifact Creation
- **Mechanism:** Agent or retry logic calls `ArtifactCreateTool` with identical artifact name.
- **Result:** The tool updates the existing `ArtifactModel` record and atomically replaces the file on disk rather than creating duplicate rows.
- **Verification:** Verified in `test_3_5_2_08_duplicate_artifact_creation`.

#### Scenario 9: Duplicate Event Publication
- **Mechanism:** Multiple components submit events with the same `event_id`.
- **Result:** `event_service.create_event` returns the existing `AgentEventModel` without allocating duplicate sequence numbers or publishing duplicate envelopes.
- **Verification:** Verified in `test_3_5_2_09_duplicate_event_publication`.

#### Scenario 10: Repeated Task Completion Requests
- **Mechanism:** Orchestrator or worker invokes `task_lifecycle_engine.transition` with `COMPLETED` multiple times.
- **Result:** The state machine recognizes $current == target$ as an idempotent no-op and returns the task safely without triggering redundant notifications or audit errors.
- **Verification:** Verified in `test_3_5_2_10_repeated_task_completion_requests`.

---

### 4. Idempotency Architecture Bounds

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       IDEMPOTENCY CONTRACT BOUNDARIES                       │
├─────────────────────────┬─────────────────────────┬─────────────────────────┤
│    DATABASE & API       │     AGENT EXECUTION     │      EXTERNAL APIS      │
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ • Tenant Idempotency Key│ • executed_call_ids     │ • Idempotency-Key Header│
│ • CAS Atomic Claims     │ • Atomic POSIX Replace  │ • X-Request-Id Header   │
│ • Event ID Deduplication│ • Verified Deliverable  │ • SSRF Domain Allowlist │
│ • Fencing Lease Tokens  │ • Terminal State No-op  │ • At-Least-Once Semantics│
└─────────────────────────┴─────────────────────────┴─────────────────────────┘
```

1. **Exactly-Once Myth:** PROVIPAGENT does NOT claim global distributed exactly-once execution against arbitrary third-party services.
2. **Explicitly Bounded Guarantee:** Internal operations (tasks, deliverables, artifacts, events) guarantee **effectively-once** semantics through unique keys, atomic writes, and database constraints. External mutations guarantee **at-least-once** with header-based provider deduplication.

---

### 5. Phase 3.5.2 Verdict

**VERDICT: PASS — EXPLICITLY BOUNDED**  
The idempotency model enforces strict tenant scoping, atomic updates, external header propagation, and auditable execution history across all 10 verified failure modes.

