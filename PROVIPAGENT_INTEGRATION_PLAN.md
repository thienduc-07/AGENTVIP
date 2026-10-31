# PROVIPAGENT — ARCHITECTURAL INTEGRATION PLAN
**Autonomous AI Company Operating System**
**Document Status**: Certified Architecture Blueprint (Phase 1)
**Authoritative Location**: `/Users/thienduc/Desktop/Code/provipagent/PROVIPAGENT_INTEGRATION_PLAN.md`

---

## 1. Executive Summary

This document specifies the complete, production-grade integration architecture uniting three distinct paradigms into a unified commercial product:

1. **Agency Agents** (`msitarzewski/agency-agents`): The workforce talent catalog containing 268+ specialized role definitions, skills, workflows, and success metrics.
2. **My Office** (`khanh020905/my-office`): The visual and interaction reference for 3D corporate office visualization, character animation states, and waypoint navigation.
3. **PROVIPAGENT**: The central autonomous AI company operating system that recruits, orchestrates, executes, governs, meters, and monetizes the workforce.

---

## 2. End-to-End System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     PROVIPAGENT ARCHITECTURE DATA FLOW                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  [1. SPECIALIST CATALOG] (Agency Agents)
    - 268 Specialist Definitions (`specialist_definitions`)
    - Source Provenance, Hash & Frontmatter (`specialist_versions`)
    - 18 Division Classifications (Engineering, AI, Sales, Finance...)
                │
                ▼ (Recruitment Action by CEO / HR)
  [2. ORGANIZATION WORKFORCE]
    - Employment Binding (`recruitment_records`)
    - Department & Reporting Line (`agents.station`, `manager_agent_id`)
    - Security Clearance & Resource Ceilings (`budget_limit_usd`, `ToolPermissionLevel`)
                │
                ▼ (Customer Directive: "Develop and launch e-commerce system")
  [3. COMPANY MANAGEMENT & GOVERNANCE]
    - Executive Leadership Core (Victoria Vance, David Chen, Julian Thorne...)
    - Strategic Policy Checks & Governance Audit (`pa_governance_audit_logs`)
    - Budget Authorization (`pa_financial_ledger`)
                │
                ▼ (Delegates Directive to Multi-Agent Orchestrator)
  [4. TASK ORCHESTRATOR]
    - DAG Task Planner (`MultiAgentPlanner`)
    - Kahn's Topological Sort & Dependency Cycle Detection
    - Dynamic Specialist Capability Matching
                │
                ▼ (Dispatches Subtasks adhering to DAG)
  [5. AI AGENT RUNTIME]
    - Stateful Execution Loop (`ExecutionLoop`)
    - Scoped Sandbox Tools (`default_tool_registry`)
    - Security Sandbox & High-Risk Gateways (`ApprovalModel`, `./workspace_sandbox`)
    - Multi-Provider Adapter (OpenAI, Gemini, Anthropic, Ollama, Deterministic)
                │
                ▼ (Subtasks Produce Output)
  [6. MULTI-AGENT COLLABORATION]
    - Inter-Agent Contracts (`SubtaskResultContract`)
    - Evidence, Citations & Artifact Handoffs
    - Independent Quality Audit (`verifier.py`)
                │
                ▼ (Verifiable Deliverables Produced)
  [7. DELIVERABLE MANAGEMENT]
    - Real Code Packages, Documents & Reports (`artifacts`)
    - Customer Approval & Revision Gateway
                │
                ▼ (Authoritative State Transitions)
  [8. EXECUTION EVENT SYSTEM]
    - Monotonic Sequencing (`agent_events.sequence_id`)
    - Standardized Event Envelope (`API_EVENT_SCHEMA.md`)
                │
                ▼ (Real-time Broadcast & Replay Engine)
  [9. WEBSOCKET INFRASTRUCTURE] (`/api/v1/events/ws`)
    - Origin Filtering, Heartbeats & Authoritative Snapshots
    - Reconnection Replay from Sequence Cursor
                │
                ▼ (Reactive State Hydration in Zustand `worldStore.ts`)
  [10. REAL-TIME 3D CORPORATE OFFICE] (React Three Fiber)
    - Character State Machine (IDLE -> WORKING -> IN_MEETING -> REVIEWING)
    - Waypoint Pathfinding (Desk-to-Meeting Collisions Avoided)
    - Telemetry Beacons, Typing Animations, & Task VFX Streams
```

---

## 3. Step-by-Step Execution Lifecycle Trace

Below is the concrete end-to-end data flow when a customer delegates a real business objective:

### Step 1: Customer Directive Ingestion
- Customer submits directive: *"Perform competitor audit, design technical architecture, write backend code, and prepare sales proposal."*
- Request hits `POST /api/v1/workflows`.
- `TaskModel` is created with `status: "planning"`, assigned to `agent-exec-ceo` (Victoria Vance).

### Step 2: Capability Matching & Team Resolution
- `MultiAgentPlanner` analyzes the objective and identifies required skill capabilities:
  - Market Research (`spec-marketing-researcher`)
  - Systems Architecture (`spec-eng-arch`)
  - Full-Stack Development (`spec-eng-dev`)
  - Enterprise Sales Proposal (`spec-sales-proposal`)
- Planner queries `default_agent_registry`:
  - If a specialist is already recruited and active in the organization workforce, select them.
  - If not recruited, trigger recruitment recommendation event (`specialist.recommended`) or auto-recruit according to organization hiring policy.

### Step 3: DAG Workflow Generation
- Planner decomposes the directive into a Directed Acyclic Graph (DAG) with 4 subtasks:
  - `subtask_01` (Research): No dependencies.
  - `subtask_02` (Architecture): Depends on `subtask_01`.
  - `subtask_03` (Code Development): Depends on `subtask_02`.
  - `subtask_04` (Sales Proposal): Depends on `subtask_01` and `subtask_02`.
- Topological sorting validates cycle-free execution. Subtasks are saved to SQLite.
- Backend emits `workflow.planned` via WebSocket.

### Step 4: Coordinated Subtask Dispatch
- `MultiAgentOrchestrator` launches `subtask_01`:
  - Status becomes `"running"`.
  - Backend emits `subtask.assigned` and `task.execution.started`.
  - 3D Office: Telemetry beam arcs from CEO desk to Research Lab; Researcher avatar transitions from `AVAILABLE` to `WORKING` (procedural arm typing, glowing cyan ring).

### Step 5: Sandboxed Tool Execution & Data Extraction
- Researcher runs tools: `web.search`, `data.profile`, `file_read`.
- Backend emits `task.execution.progress` with tool telemetry.
- 3D Office: Researcher avatar tilts head (`READING`), tool badge renders above character.
- Researcher writes findings to `./workspace_sandbox/research_audit.md`.

### Step 6: Inter-Agent Contract Handoff
- Subtask 1 finishes. Output is packaged into `SubtaskResultContract`:
  ```json
  {
    "task_id": "subtask_01",
    "status": "completed",
    "summary": "Competitor landscape analysis completed with 4 key differentiators identified.",
    "artifact_ids": ["art_research_md"],
    "evidence": ["workspace_sandbox/research_audit.md:L1-L85"]
  }
  ```
- Subtask 2 (Architecture) unblocks. Data contract is passed as input context.
- Backend emits `collaboration.started`.
- 3D Office: Task handoff VFX fires between Research and Engineering bays. Architect avatar transitions to `WORKING`.

### Step 7: High-Risk Approval Gateway
- Subtask 3 (Developer) attempts to run code execution or system command (`Level 2` tool).
- Security policy suspends execution: task enters `waiting_approval`.
- Backend records `ApprovalModel` and broadcasts `approval.required`.
- 3D Office: Developer avatar transitions to `BLOCKED`; amber warning beacon pulses.
- Frontend HUD: Renders Executive Board Approval Modal.
- Owner reviews payload and clicks **Authorize Execution**.
- Task resumes inside sandbox; developer finishes code package.

### Step 8: Quality Verification & Deliverable Sign-Off
- `result_verifier` audits code and documentation against success criteria.
- Parent workflow completes. `pa_financial_ledger` records exact model tokens and costs.
- Deliverables are registered in `artifacts` vault for customer download.
- Backend emits `workflow.completed`.
- 3D Office: All participating specialists transition to `COMPLETED` (green confirmation ring, celebratory gesture) before returning to `AVAILABLE`.

---

## 4. Reusable vs Missing Components Matrix

| Architectural Subsystem | Existing Reusable Component | Missing Component to Implement |
| :--- | :--- | :--- |
| **Specialist Catalog** | `SpecialistDefinitionModel`, `AgencyAgentImporter`, 268 imported records in `agency.db`. | Automated version diffing for upstream catalog updates. |
| **Recruitment Service** | `RecruitmentService`, `RecruitmentRecordModel`, dynamic registration in `AgentRegistry`. | Dynamic 3D desk slot allocator for newly recruited specialists. |
| **Orchestration & Planning** | `MultiAgentOrchestrator`, `MultiAgentPlanner` (Kahn's DAG), `ExecutionLoop`. | Dynamic team auto-selection based on LLM skill embedding matching. |
| **Agent Runtime & Tools** | 22 sandboxed tools, `ToolPermissionLevel` guards, `ApprovalModel`, `./workspace_sandbox`. | Tool execution isolation using isolated container/subprocess jails. |
| **Real-time Streaming** | `ws_manager.py`, `AgentEventModel`, sequence IDs, snapshot distribution. | Organization tenant filtering in WebSocket broadcast loop. |
| **3D Office Visuals** | `WorldCanvas.tsx`, `OfficeArchitecture.tsx`, `CorporateAgentAvatar.tsx`, `TaskHandoffVFX.tsx`. | 13-state animation machine, waypoint graph pathfinding (`useWaypointNavigation`). |
| **Cost Management** | `AgentPerformanceModel` (tokens, cost), `pa_financial_ledger`. | Provider abstraction adapters for native Gemini/Anthropic SDKs; model pricing table. |
| **Multi-Tenancy SaaS** | Scoped memory table with `organization_id`. | `organizations` table, tenant request middleware, non-destructive migration. |

---

## 5. Phased Implementation Roadmap

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        IMPLEMENTATION PHASES                           │
└────────────────────────────────────────────────────────────────────────┘

 [Phase 1: Architectural Integration Plan] ◄── (CURRENT STAGE - COMPLETED)
   ├── PROVIPAGENT_INTEGRATION_PLAN.md
   ├── API_EVENT_SCHEMA.md
   ├── DATABASE_ARCHITECTURE.md
   ├── 3D_OFFICE_ARCHITECTURE.md
   └── TECHNICAL_DECISIONS.md

 [Phase 2: Workforce Integrity & Dynamic Instantiation]
   ├── Dynamic desk slot assignment for recruited specialists
   ├── Non-destructive catalog synchronization CLI
   └── Automated workforce test suite

 [Phase 3: Event-Driven 3D Office & State Machine]
   ├── 13-state visual animation machine in R3F
   ├── Waypoint pathfinding engine (desk to conference table)
   └── Authoritative event-to-visual state mapper

 [Phase 4: Multi-Agent Execution Engine & Deliverable Vault]
   ├── End-to-end multi-specialist DAG execution
   ├── Structured deliverable review interface
   └── Subprocess sandbox resource limits (CPU/Memory/Time)

 [Phase 5: Company Management Interfaces & Operations HUD]
   ├── Department workforce rosters & talent search
   ├── Executive strategy directive terminal
   └── Real-time operational P&L ledger dashboard

 [Phase 6: Multi-Provider AI Architecture & Cost Governance]
   ├── Native Gemini & Anthropic SDK provider adapters
   ├── Versioned model pricing table
   └── Budget hard stops & execution auto-pausing

 [Phase 7: Multi-Tenant SaaS & Commercial Subscriptions]
   ├── Non-destructive `organization_id` database migration
   ├── Tenant isolation middleware & RBAC
   └── Stripe sandbox payment integration & plan tiers

 [Phase 8: Security Sandbox, Observability & E2E Validation]
   ├── Prompt injection red-teaming tests
   ├── Comprehensive end-to-end customer workflow validation
   └── Production deployment readiness audit
```

---

*Integration Plan certified by PROVIPAGENT Engineering Organization.*
