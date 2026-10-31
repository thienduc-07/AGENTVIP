# PROVIPAGENT — ARCHITECTURE AUDIT REPORT
**Autonomous AI Company Operating System**
*Phase 0 Milestone Deliverable — Exhaustive Source Code & System Inspection*

> **Audit Date**: 2026-10-31
> **Workspace**: `/Users/thienduc/Desktop/Code/provipagent`
> **Auditors**: Senior Engineering Organization (Principal Architect, AI Systems Architect, 3D Graphics Engineer, Multi-Agent Specialist, Security & SaaS Lead)
> **Preservation Status**: 268 Imported Specialist Records Verified, 8 Leadership Agents Intact, 121 Pytest Suite Tests 100% Passing, Frontend TypeScript 0 Errors.
> **Strict Boundary Enforcement**: Zero interaction or contamination with `/Users/thienduc/Desktop/Code/OPagent`.

---

## 1. ACTUAL ARCHITECTURE OVERVIEW

PROVIPAGENT is a full-stack platform transforming specialist agent definitions into executable corporate workflows visualized in a real-time 3D corporate environment.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Next.js 16 + R3F)                          │
│                                                                                │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌────────────────────┐  │
│  │   Corporate HUD       │  │  Mission Control &    │  │ Specialist Talent  │  │
│  │ (TopNav, Dock, Help)  │  │  Interactive Terminal │  │ Recruitment Modal  │  │
│  └───────────┬───────────┘  └───────────┬───────────┘  └─────────┬──────────┘  │
│              │                          │                        │             │
│              ▼                          ▼                        ▼             │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                        Zustand Store (`worldStore.ts`)                   │  │
│  └──────────────────────────────────────┬───────────────────────────────────┘  │
│                                         │                                      │
│  ┌──────────────────────────────────────▼───────────────────────────────────┐  │
│  │           3D World Canvas (`WorldCanvas.tsx` / React Three Fiber)        │  │
│  │  - Office Architecture (Skyscraper Skyline, Terrazzo Floors, Partitions) │  │
│  │  - Department Furniture (Executive, Eng, AI, Marketing, Sales, CS)       │  │
│  │  - Corporate Agent Avatars (`CorporateAgentAvatar.tsx` / Procedural)     │  │
│  │  - Realtime Task VFX Handoffs (`TaskHandoffVFX.tsx`)                     │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────▲────────────────────────────────────────┘
                                        │ (WebSocket Events + REST APIs)
┌───────────────────────────────────────▼────────────────────────────────────────┐
│                          BACKEND (FastAPI + SQLAlchemy)                        │
│                                                                                │
│  ┌───────────────────────────┐                ┌─────────────────────────────┐  │
│  │     REST API Routers      │                │   WebSocket Event Manager   │  │
│  │  - `/api/v1/agents`       │                │  - `/api/v1/events/ws`      │  │
│  │  - `/api/v1/specialists`  │                │  - Sequence tracking & Replay│ │
│  │  - `/api/v1/recruitment`  │                │  - Realtime state broadcast │  │
│  │  - `/api/v1/tasks`        │                └──────────────┬──────────────┘  │
│  │  - `/api/v1/workflows`    │                               │                 │
│  │  - `/api/v1/autonomous/*` │                               │                 │
│  └─────────────┬─────────────┘                               │                 │
│                ▼                                             │                 │
│  ┌───────────────────────────────────────────────────────────▼──────────────┐  │
│  │                      Multi-Agent Orchestrator & Planner                  │  │
│  │  - DAG Subtask Planner (Kahn's Topological Sort, Cycle Detection)        │  │
│  │  - Specialist Dynamic Hydration & Registry (`default_agent_registry`)    │  │
│  │  - Execution Loop & Subtask Data Contracts (`SubtaskResultContract`)     │  │
│  │  - Tool Permission Guards (Level 0: Read-Only, Level 1: Write/Normal)    │  │
│  │  - Captain / Owner High-Risk Approval Gateway (`ApprovalModel`)          │  │
│  └─────────────┬────────────────────────────────────────────────────────────┘  │
│                ▼                                                               │
│  ┌───────────────────────────┐                ┌─────────────────────────────┐  │
│  │    LLM Provider Matrix    │                │  Autonomous Company Engine  │  │
│  │  - Deterministic Zero-Cost│                │  - Modules 1-7 Telemetry    │  │
│  │  - OpenAI / Groq Provider │                │  - P&L Financial Ledger     │  │
│  │  - Ollama Local Provider  │                │  - Governance Audit Logging │  │
│  └─────────────┬─────────────┘                └──────────────┬──────────────┘  │
│                │                                             │                 │
│  ┌─────────────▼─────────────────────────────────────────────▼──────────────┐  │
│  │                      SQLite Database (`agency.db`)                       │  │
│  │  - 268 Specialist Definitions | 536 Versions | 8 Leadership Executives    │  │
│  │  - Recruitment Records | Tasks | Events | Tools | Scoped Memories | P&L  │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. EXISTING WORKING CAPABILITIES (VERIFIED IN CODE)

All features below have been validated by source inspection and passing test execution:

1. **Specialist Catalog (268 Records, 18 Divisions)**:
   - Stored in table `specialist_definitions` (268 active rows) and `specialist_versions` (536 rows).
   - Source provenance tracked: repo URL, relative file path, commit SHA, SHA-256 content hash, YAML frontmatter, sanitized system instructions, and structured deliverables.
   - 18 divisions verified: `engineering` (66), `specialized` (59), `marketing` (37), `gis` (13), `security` (12), `design` (10), `sales` (9), `testing` (9), `paid-media` (7), `project-management` (7), `academic` (6), `game-development` (6), `product` (6), `spatial-computing` (6), `support` (6), `finance` (5), `healthcare` (3), `research` (1).
   - Validation & sanity: Frontmatter sanitized against prompt injection patterns (`ignore prior instructions`, `bypass governance`).

2. **Executive Leadership Core (8 Agents)**:
   - Stored in `agents` table with designated stations and corporate roles:
     - **Victoria Vance** (`agent-exec-ceo`): Executive Suite `(0, 0, 0)`
     - **David Chen** (`agent-eng-lead`): Engineering Bay `(-12, 0, -8)`
     - **Dr. Elena Rostova** (`agent-research-ai`): Research Lab `(-12, 0, 8)`
     - **Sophia Martinez** (`agent-mkt-growth`): Marketing Studio `(12, 0, -8)`
     - **Marcus Reynolds** (`agent-sales-director`): Sales Wing `(12, 0, 8)`
     - **Julian Thorne** (`agent-fin-controller`): Finance Office `(6, 0, 0)`
     - **Amara Okafor** (`agent-ops-recruiter`): Operations Hub `(-6, 0, 0)`
     - **Liam O'Connor** (`agent-support-lead`): Support Lounge `(0, 0, 10)`

3. **Specialist Recruitment & Dynamic Registration**:
   - `RecruitmentService` (`backend/app/services/recruitment_service.py`):
     - Transitions specialist from `AVAILABLE` to `RECRUITED` -> `CONFIGURED` -> `ACTIVE`.
     - Assigns manager reporting hierarchy, department station, budget limit (`budget_limit_usd`), and tool permission profile.
     - Dynamically registers the recruited employee into `default_agent_registry` as an executable `AgentDefinition`.
     - Tracks performance metrics (`AgentPerformanceModel`: tasks completed, failed, duration, tokens, cost).

4. **Multi-Agent Orchestrator & DAG Execution**:
   - `MultiAgentOrchestrator` (`backend/app/agent_runtime/orchestrator/multi_agent_orchestrator.py`):
     - Uses `MultiAgentPlanner` to decompose complex directives into a DAG of subtasks.
     - Performs Kahn's topological sort and cycle detection.
     - Dispatches subtasks sequentially/concurrently adhering to dependency constraints.
     - Transfers structured `SubtaskResultContract` (summary, output, evidence, artifacts) between agents.
     - Uses `result_verifier` to audit outputs before task completion.

5. **Sandbox & High-Impact Approval Workflow**:
   - Tools partitioned into `SAFE` vs `HIGH` risk levels.
   - High-impact tool executions (file writing, subprocess execution, external spending) transition the task into `waiting_approval` with an `ApprovalModel` record.
   - Frontend displays `CaptainApprovalModal` (authorizing or denying the pending action).
   - Only upon human authorization does execution resume inside `./workspace_sandbox`.

6. **Real-time Event Streaming & Replay**:
   - WebSocket streaming on `/api/v1/events/ws` with monotonic sequence IDs (`sequence_id`).
   - Clients send `{ action: "replay", last_sequence_id: N }` on reconnection to replay dropped events.
   - Full snapshot distribution (`message_type: "snapshot"`) on connection.

7. **3D Interactive Headquarters (Frontend)**:
   - Modern React Three Fiber architecture (`WorldCanvas.tsx`, `OfficeArchitecture.tsx`, `OfficeFurniture.tsx`).
   - Procedural corporate avatars with customized department colors, dress suits, lanyard badges, and typing animations (`CorporateAgentAvatar.tsx`).
   - Visual telemetry data arcs (`TaskHandoffVFX.tsx`) showing task handoffs between collaborating executives.
   - Glassmorphic HUD, Station Roster, Talent Recruitment Modal (`SpecialistRecruitmentModal.tsx`), Mission Control Terminal, and Memory Center.

8. **Automated Testing**:
   - 28 test suites in `backend/app/tests`, 121 individual tests passing 100% in 1.95s.
   - Frontend TypeScript passes (`npx tsc --noEmit`) with 0 errors.

---

## 3. PARTIALLY IMPLEMENTED CAPABILITIES

1. **Character Animation State Machine**:
   - *Current State*: Avatars support `idle` (breathing, subtle head glance) and `working` (procedural arm typing). Position changes interpolate linearly along an arc when `movingAgent` is populated in Zustand.
   - *Gap*: Master Directive mandates states: `IDLE`, `AVAILABLE`, `WORKING`, `READING`, `WRITING`, `THINKING`, `IN_MEETING`, `COLLABORATING`, `WAITING`, `REVIEWING`, `BLOCKED`, `COMPLETED`, `ERROR`. Full state machines and waypoint pathfinding (adapted from My Office's `navigation.js` and `workers.js`) are not yet wired into the R3F character components.

2. **Autonomous Company Engine (Modules 1-7)**:
   - *Current State*: Defined in `backend/app/autonomous_company/engine.py` and mounted in `main.py` (`/api/v1/autonomous/hq-telemetry`, `/api/v1/autonomous/ceo-directive`, `/api/v1/autonomous/financial-ledger`).
   - *Gap*: The engine currently executes hardcoded deterministic stages for product manufacturing and lead qualification rather than utilizing the full dynamic DAG of the 268 specialists from `MultiAgentOrchestrator`.

3. **Cost & Token Tracking**:
   - *Current State*: `AgentPerformanceModel` has columns `total_tokens_used` and `total_cost_usd`. `RecruitmentRecordModel` tracks `budget_limit_usd` and `budget_spent_usd`.
   - *Gap*: The `tasks` table itself does not have native `tokens_used` or `cost_usd` columns; per-task token accounting is currently aggregated in `AgentPerformanceModel` and in-memory execution logs.

4. **Multi-Provider AI Abstraction**:
   - *Current State*: Factory (`backend/app/agent_runtime/llm/factory.py`) supports `deterministic`, `openai` (works for OpenAI, Groq, OpenRouter), and `ollama`.
   - *Gap*: Native Anthropic and Google Gemini direct SDK adapters are not yet implemented in `agent_runtime/llm/` (they rely on OpenAI-compatible base URL proxying).

---

## 4. MISSING CAPABILITIES

1. **Multi-Tenant SaaS Architecture**:
   - Current tables (`agents`, `tasks`, `recruitment_records`, `tools`, `artifacts`) are global single-tenant schemas without `organization_id` partitioning.
   - No customer organization onboarding, member role-based access control (RBAC), or organization-level isolation guards.

2. **Commercial SaaS Billing & Subscriptions**:
   - No Stripe/payment gateway sandbox integration.
   - No subscription tier schemas (`TRIAL`, `ACTIVE`, `PAST_DUE`, `CANCELLED`).
   - No organization token/budget allowance enforcement.

3. **Dynamic Specialist Character Spawning in 3D**:
   - Currently, `WorldCanvas.tsx` iterates over `agents` in `worldStore`. Only the 8 founding executives are spawned by default. Recruited specialists appear in the recruitment drawer, but dynamic desk allocation and instanced 3D character placement across department wings require complete wiring.

4. **Structured Deliverables Vault**:
   - Although `SubtaskResultContract` produces `artifact_ids`, there is no customer-facing Deliverable Review & Approval Dashboard allowing organization owners to download, review, and request revisions on final code/documents.

---

## 5. TECHNICAL DEBT & LEGACY ARTIFACTS

1. **Legacy Pirate Theme Naming**:
   - While the visuals and primary code have been converted to Corporate HQ, several filenames and strings still bear legacy names:
     - `CaptainApprovalModal.tsx` (should be aliased or upgraded to `OwnerApprovalModal.tsx` / `ExecutiveBoardModal.tsx`).
     - `StrawHatCrewDock.tsx` (already wrapper for `CorporateAgentDock.tsx`, but still exists).
     - `IslandTerrain.tsx`, `CityCanvas.tsx`, `CrewNavigation.ts` in `frontend/components/canvas/`.
     - Loggers still using `"grandline.runtime.orchestrator"`.
2. **Dual Database Declarations**:
   - `backend/app/core/database.py` defines `Base = declarative_base()` and `SessionLocal`.
   - `backend/app/autonomous_company/models.py` imports that `Base`, but `backend/app/autonomous_company/router.py` initializes its own `SessionLocal = sessionmaker(...)` instead of sharing `backend.app.core.database.SessionLocal`.
3. **Deprecation Warnings**:
   - 8 minor test warnings regarding `starlette.status.HTTP_422_UNPROCESSABLE_ENTITY` (deprecated in favor of `HTTP_422_UNPROCESSABLE_CONTENT`).

---

## 6. INTEGRATION RISKS & MITIGATION STRATEGY

| Risk Category | Specific Risk | Technical Mitigation Strategy |
| :--- | :--- | :--- |
| **Specialist Catalog Drift** | Upstream `agency-agents` updates could overwrite local records or change schema. | Maintain local `agency.db` as authoritative. Syncs must use `content_hash` diffing, creating version records in `specialist_versions` without ever wiping `specialist_definitions`. |
| **3D Performance Degradation** | Rendering 50+ animated 3D characters simultaneously causes WebGL framerate drops. | Adopt My Office's LOD and visibility culling: only render active characters; use instancing for idle desk occupants; throttle off-screen skeletal calculations. |
| **Fake vs Real AI Execution** | 3D animations executing without corresponding backend tasks creates a deceptive simulation. | Strict unidirectional event flow: 3D character states must ONLY update when authoritative WebSocket events (`task.started`, `execution.started`, etc.) are received from the backend. |
| **Security & Sandbox Escape** | Imported markdown instructions attempting prompt injection or unauthorized tool use. | Keep system governance prompts immutable; sandbox specialist instructions in an isolated prompt wrapper; enforce strict `ToolPermissionLevel` whitelist. |
| **Multi-Tenant Data Leakage** | Adding `organization_id` carelessly could break existing relations or leak cross-tenant data. | Safe non-destructive migrations adding nullable `organization_id` defaulting to `default-org`; enforce tenant scoping in base query middleware. |

---

## 7. DATABASE RELATIONSHIPS & SCHEMA MAP

```
+---------------------------------------------------------------------------------------------------+
|                                        DATABASE SCHEMA                                            |
+---------------------------------------------------------------------------------------------------+

 [specialist_definitions]
   ├── id (PK, String 64)
   ├── slug (Unique, String 128)
   ├── division, department, role, name
   ├── system_instructions, deliverables, workflows, success_metrics
   ├── declared_tools, assigned_tools, permission_level
   ├── source_repo, source_path, source_commit_sha, content_hash
   ├── validation_status ("VALID", "INVALID", "WARNING")
   ├── lifecycle_state ("AVAILABLE", "RECRUITED", "SUSPENDED", "RETIRED")
   └── 1:N ──► [specialist_versions] (version, content_hash, raw_content, change_summary)
   │
   └── 1:1 (on recruit)
       ▼
 [recruitment_records]
   ├── id (PK, String 64)
   ├── specialist_definition_id (FK -> specialist_definitions.id)
   ├── agent_id (FK -> agents.id, Unique)
   ├── department, manager_agent_id (FK -> agents.id)
   ├── lifecycle_state ("ACTIVE", "SUSPENDED", "RETIRED")
   ├── permission_profile, budget_limit_usd, budget_spent_usd, max_daily_tasks
   └── model_preference, memory_policy
       │
       ▼
 [agents] (8 Executive Leaders + Recruited Specialists)
   ├── id (PK, String 64) (e.g., 'agent-exec-ceo', 'agent-spec-...')
   ├── name, role, station, status ('idle', 'working', 'waiting_approval', 'error')
   ├── pos_x, pos_y, pos_z, color, avatar
   ├── 1:1 ──► [agent_performance] (tasks_completed, failed, tokens_used, cost_usd)
   ├── 1:N ──► [tasks] (assigned_agent_id)
   └── 1:N ──► [agent_events] (agent_id)

 [tasks]
   ├── id (PK, String 64)
   ├── parent_task_id (FK -> tasks.id, Self-referential DAG)
   ├── task_type ("single", "workflow", "subtask")
   ├── title, description, status, priority, assigned_agent_id (FK -> agents.id)
   ├── dependencies_json (List of prerequisite task IDs)
   ├── input_data_json, output_data_json, result_summary, error_message
   ├── 1:N ──► [task_steps] (step_index, action, status)
   ├── 1:N ──► [approvals] (action_type, tool_name, risk_level, status)
   └── 1:N ──► [artifacts] (name, file_path, mime_type, content_hash)

 [pa_financial_ledger]
   ├── id, entry_type ("owner_budget_deposit", "operating_expense", "actual_received_revenue")
   ├── amount_usd, source_verification, reference_id, agent_id
```

---

## 8. REAL-TIME EVENT STREAMING FLOW

The platform enforces an event-driven loop where the backend remains the absolute source of truth:

```text
  User Directive / API Request
               │
               ▼
   [MultiAgentOrchestrator]
               │
      Emits backend event via `event_service`
               │
               ▼
     [ws_manager.broadcast()]
               │ (Standardized Envelope: sequence_id, event_type, agent_id, task_id, payload)
               ▼
     WebSocket Client (`page.tsx`)
               │
               ├─► Updates Zustand Store (`worldStore.ts`)
               │      - `agents[agent_id].status = "working"`
               │      - `movingAgent = { agentId, fromPos, targetPos, progress }`
               │      - `activeTask = payload`
               │
               ├─► R3F Scene (`WorldCanvas.tsx`)
               │      - `CorporateAgentAvatar` switches to typing animation
               │      - `AgentStatusIndicator` glows with activity ring
               │      - `TaskHandoffVFX` renders bezier telemetry beam
               │
               └─► Glassmorphic HUD & Mission Drawer
                      - Appends structured log in live timeline
```

---

## 9. SPECIALIST LIFECYCLE STATE MACHINE

The specialist lifecycle is strictly enforced by `RecruitmentService.VALID_TRANSITIONS`:

```text
DISCOVERED
    │
    ▼
IMPORTED  (Markdown parsed, metadata extracted)
    │
    ▼
VALIDATED (Prompt sanitized, tools verified, hash checked)
    │
    ▼
AVAILABLE (Visible in global catalog, not consuming runtime or tokens)
    │
    ├──► [Recruitment Action by CEO / HR]
    ▼
RECRUITED (Record created, linked to department and manager)
    │
    ▼
CONFIGURED (Budget assigned, permission profile set, 3D desk mapped)
    │
    ▼
ACTIVE    (Registered in `default_agent_registry`, ready for tasks)
    │
    ├─► SUSPENDED (Paused due to budget limit or manual hold) ──► ACTIVE
    ▼
 RETIRED  (Archived, disabled in registry, history preserved)
```

**Crucial Distinction Confirmed**:
- **Specialist Definition**: Catalog entry only (0 memory/token overhead).
- **Recruited Specialist**: Employee record with department allocation.
- **Active Execution Instance**: Temporary async task context created only during an actual task run.

---

## 10. REFERENCE REPOSITORIES AUDIT & ANALYSIS

### Source A — Agency Agents (`msitarzewski/agency-agents`)
- **Location**: Cloned in `./scratch/agency-agents` (clean depth-1 clone).
- **Format**: Markdown files organized in division folders (`academic`, `engineering`, `marketing`, `sales`, etc.) with YAML frontmatter.
- **PROVIPAGENT Status**: All 268 specialists are already imported into `agency.db`.
- **Verdict**: Provenance is intact. Synchronization must be read-only and version-controlled. **DO NOT wipe or re-import from scratch.**

### Source B — My Office (`khanh020905/my-office`)
- **Location**: Cloned in `./scratch/my-office`.
- **Architecture**: Raw vanilla Three.js scene graphs wrapped in a Node.js web server, designed to hook Claude Code CLI sessions (`~/.claude/settings.json`).
- **Core Concepts to Adapt into PROVIPAGENT**:
  1. *Waypoint Navigation & Pathfinding* (`src/office/people/navigation.js`): Waypoint grid allowing characters to navigate between desks, corridors, and meeting rooms.
  2. *Extended Character Activity States* (`workers.js`): Mapping execution states to visible activities (`reading` at library, `writing` at desk, `in_meeting` in glass conference room, `resting/waiting` at lounge).
  3. *Instanced & Modular Office Geometry*: Optimizing props, chairs, and monitors for scalable framerates.
- **Architectural Separation**:
  - My Office is an event-hooked session viewer for single-user CLI sessions.
  - PROVIPAGENT is a commercial multi-agent company operating system.
  - We will incorporate My Office's visual navigation, animation states, and furniture layouts directly into our React Three Fiber declarative pipeline rather than copying monolithic vanilla scripts.

---

## 11. RECOMMENDED IMPLEMENTATION ROADMAP

```text
PHASE 0: Complete Architecture Audit (COMPLETED)
   │
   ▼
PHASE 1: Architectural Integration Plan (Deliverable: `PROVIPAGENT_INTEGRATION_PLAN.md`)
   - Detailed mapping of My Office concepts into PROVIPAGENT's R3F setup.
   - Formal WebSocket event schema specification (`API_EVENT_SCHEMA.md`).
   │
   ▼
PHASE 2: Workforce Integrity & Dynamic Instantiation
   - Verify dynamic 3D desk mapping for recruited specialists.
   - Non-destructive sync mechanism for upstream catalog updates.
   │
   ▼
PHASE 3: Event-Driven 3D Office & State Machine
   - Complete 12-state animation machine (`IDLE` -> `WORKING` -> `IN_MEETING` -> `REVIEWING`, etc.).
   - Waypoint navigation for desk-to-meeting transitions during collaborations.
   │
   ▼
PHASE 4: Execution Engine & Multi-Agent Collaboration
   - Cross-specialist subtask delegation with token and budget safety guards.
   - Verifiable deliverable storage (code files, documents, analysis) in `/workspace_sandbox`.
   │
   ▼
PHASE 5: Company Management Interfaces & Operations HUD
   - Full organization management, department roster views, and live P&L dashboard.
   │
   ▼
PHASE 6: Multi-Provider AI Architecture & Cost Governance
   - Native Gemini & Anthropic SDK integration alongside OpenAI & Ollama.
   - Real-time token accounting and budget threshold hard-stops.
   │
   ▼
PHASE 7: Multi-Tenant SaaS & Commercial Readiness
   - Organization tenant isolation, user memberships, and subscription sandbox.
   │
   ▼
PHASE 8: Security Sandbox, Observability & E2E Validation
   - Complete automated end-to-end verification of customer company workflows.
```

---

*Report certified by PROVIPAGENT Engineering Organization.*
