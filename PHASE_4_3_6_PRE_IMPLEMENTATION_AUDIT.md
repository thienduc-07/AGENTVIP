# PROVIPAGENT — PHASE 4.3.6 PRE-IMPLEMENTATION ARCHITECTURAL AUDIT
## Live Terminal & Observable Workstation Execution Environment

**Milestone**: Phase 4.3.6 — Live Terminal & Workstation Screen  
**Auditor**: Principal Software Architect & Systems Engineer  
**Baseline Git Commit**: `82f98583eb5ea329293808ae98290226e43aeac1`  
**Working Tree**: Clean  

---

### 1. Executive Baseline & Scope Assessment

In Phase 4.3.5, PROVIPAGENT established a certified 3D Conference Pavilion and multi-agent meeting collaboration environment. However, when observing individual employee workstations across the 7 corporate departments, workstations currently render static desk geometries and rely on basic agent state badges without exposing live execution internals.

The objective of Phase 4.3.6 is to transform every agent workstation into an authoritative, observable execution environment comprising:
1. **Live Terminal**: Real-time standard output and standard error stream generated during agent reasoning, tool execution, and deliverable creation.
2. **Workstation Screen**: Multi-tab workstation monitor displaying Overview, Live Terminal, Accessed/Modified Files, Activity Timeline, and Execution Details.
3. **Tool Activity Monitor**: Live chronological tracker for tool calls, latency, argument summaries, and execution statuses.
4. **Execution Event Architecture**: Normalized backend execution event pipeline (`execution.*`, `terminal.*`, `tool.*`, `file.*`) integrated into the Milestone 5 WebSocket infrastructure.
5. **Zero-Mock Policy**: All terminal lines, tool traces, file operations, and status indicators must originate from authoritative backend database records and real runtime events; no synthetic client-side fabrication.

---

### 2. Existing Architecture & Reusability Audit

| Subsystem | Existing State | Phase 4.3.6 Integration Plan |
|---|---|---|
| **Event Pipeline (`event_service.py`)** | Robust event recording with monotonic sequence numbering, tenant isolation, and WebSocket broadcasting via `ws_manager`. | Extend with execution event constants (`EXECUTION_STARTED`, `EXECUTION_COMPLETED`, `TERMINAL_OUTPUT`, `TERMINAL_ERROR`, `FILE_OPERATION`). Add `execution_id` to `AgentEventModel`. |
| **Tool Execution (`tool_service.py`)** | Records `ToolExecutionModel` with sanitized arguments, duration, and status. | Correlate tool records with `execution_id`, emit `TOOL_EXECUTION_*` events with live terminal trace integration. |
| **Task Runtime (`executor.py` & `dispatcher.py`)** | `ExecutionLoop` executes LLM steps and tool calls in a loop. | Instrument `ExecutionLoop` and `Dispatcher` to initialize an `ExecutionModel`, stream stdout/stderr lines into `TerminalLineModel`, and emit live execution telemetry. |
| **Workstation Models (`workstation.py`)** | `WorkstationAllocationModel` binds physical desk coordinates and departments to `AgentModel`. | Add workstation execution query endpoints (`/api/v1/workstations/{agent_id}/executions`, `/events`, `/terminal`). |
| **WebSocket Client (`syncManager.ts`)** | Single multiplexed WebSocket client handling real-time envelope ingestion and re-hydration. | Implement `useWorkstationSync.ts` hook utilizing the existing connection with event filtering by `agent_id`. |
| **Zustand Stores (`worldStore.ts`, `meetingStore.ts`)** | Isolated stores for world snapshot and meeting deliberation. | Introduce dedicated `workstationStore.ts` with bounded terminal line buffers and active tab state management. |

---

### 3. Database Schema Design: Execution & Terminal Architecture

To support bounded output storage, fast pagination, and auditability without bloating task records, we introduce:

1. **`executions` (`ExecutionModel`)**:
   - `id`: `String(64)` primary key (e.g. `exec-{uuid}`)
   - `organization_id`: `String(64)` indexed
   - `agent_id`: `String(64)` indexed, FK `agents.id`
   - `task_id`: `String(64)` indexed, FK `tasks.id` (nullable)
   - `status`: `String(32)` (`running`, `completed`, `failed`, `cancelled`, `waiting_approval`)
   - `started_at`: `DateTime`
   - `completed_at`: `DateTime` (nullable)
   - `error_message`: `Text` (nullable)
   - `summary`: `Text` (nullable)
   - `prompt_tokens`: `Integer` default 0
   - `completion_tokens`: `Integer` default 0
   - `total_tokens`: `Integer` default 0
   - `estimated_cost_usd`: `Float` default 0.0
   - `tool_calls_count`: `Integer` default 0
   - `total_lines`: `Integer` default 0
   - `created_at`, `updated_at`: `DateTime`

2. **`terminal_lines` (`TerminalLineModel`)**:
   - `id`: `String(64)` primary key
   - `execution_id`: `String(64)` indexed, FK `executions.id`
   - `organization_id`: `String(64)` indexed
   - `agent_id`: `String(64)` indexed
   - `task_id`: `String(64)` indexed (nullable)
   - `line_number`: `Integer` indexed
   - `stream`: `String(16)` (`stdout`, `stderr`, `system`)
   - `content`: `Text` (bounded, max 4000 chars per line)
   - `metadata_json`: `JSON` (nullable)
   - `timestamp`: `DateTime` indexed

3. **`AgentEventModel` Extension**:
   - Add `execution_id = Column(String(64), nullable=True, index=True)`
   - In `to_envelope()` include `execution_id`.

---

### 4. API Endpoints Specification

1. `GET /api/v1/workstations/{agent_id}`: Authoritative workstation status, allocated desk, active task, and active execution summary.
2. `GET /api/v1/workstations/{agent_id}/executions`: Paginated list of past executions for this agent.
3. `GET /api/v1/workstations/{agent_id}/events`: Paginated event stream for this agent.
4. `GET /api/v1/workstations/{agent_id}/terminal`: Paginated historical terminal lines for the agent's active or latest execution.
5. `GET /api/v1/executions/{execution_id}`: Full execution details (tokens, cost, duration, status, task reference).
6. `GET /api/v1/executions/{execution_id}/events`: Events scoped to a specific execution run.
7. `GET /api/v1/executions/{execution_id}/terminal`: Terminal lines scoped to a specific execution run with pagination (`limit`, `offset`).

---

### 5. Security & Concurrency Guardrails

1. **No Arbitrary Shell Execution**: The terminal is strictly an **event-driven viewer** reflecting runtime logging and authorized sandbox tool execution. No incoming raw shell input from the client is executed on the server.
2. **Tenant Isolation**: Every database query and WebSocket subscription filters strictly by `organization_id`. Cross-tenant requests return 404 or 403.
3. **Secret Redaction**: Terminal lines and tool arguments are sanitized via `redact_secrets()` prior to persistence and broadcasting.
4. **Bounded Buffers**: Frontend store retains a maximum of 1,000 terminal lines per execution in memory, trimming older lines to prevent browser tab memory exhaustion. Backend paginates terminal queries with strict upper limits (`limit <= 200`).

---

### 6. Implementation Plan & Phases

- **Phase 1: Database Models & Migrations**: Create `ExecutionModel` and `TerminalLineModel`, add `execution_id` index to `AgentEventModel`.
- **Phase 2: Execution & Terminal Service**: Implement `workstation_execution_service.py` with line buffering, secret redaction, and event dispatch.
- **Phase 3: Runtime Integration**: Instrument `dispatcher.py` and `executor.py` to initialize executions and pipe reasoning, tool calls, and lifecycle events into terminal lines.
- **Phase 4: Backend REST Endpoints**: Implement `/api/v1/workstations/{agent_id}/*` and `/api/v1/executions/{execution_id}/*`.
- **Phase 5: Frontend Store & Sync Hook**: Create `workstationStore.ts` and `useWorkstationSync.ts`.
- **Phase 6: Frontend Workstation Components**: Build `LiveTerminal.tsx`, `ToolActivityMonitor.tsx`, and `WorkstationScreen.tsx`.
- **Phase 7: 3D Scene Integration**: Wire workstation selection in `OfficeScene.tsx` and `OfficeCanvas.tsx`.
- **Phase 8: Comprehensive Testing & Verification**: Write backend regression tests, vitest suite, run production build, update knowledge graph via `graphify update .`, and produce certified report.
