# PROVIPAGENT — MASTER ENGINEERING DIRECTIVE
**Autonomous AI Company Operating System**

> Document Source: Master Engineering Directive provided by Project Owner
> Target Project: `/Users/thienduc/Desktop/Code/provipagent`
> Strict Boundaries: Never touch, copy from, or modify `/Users/thienduc/Desktop/Code/OPagent`

---

## 1. Core Architecture Philosophy & Three Pillars

1. **Agency Agents** (`https://github.com/msitarzewski/agency-agents`):
   - Definition source for the specialist workforce (roles, personalities, workflows, skills, deliverables, success criteria).
   - NOT a full AI runtime or multi-tenant system.

2. **My Office** (`https://github.com/khanh020905/my-office`):
   - Architectural and visual reference for the interactive 3D office experience, character systems, animations, visual state mapping, and workspace layout.
   - NOT an AI company operating engine or multi-tenant SaaS.

3. **PROVIPAGENT**:
   - The central Autonomous AI Company Operating System.
   - Merges workforce definitions with the 3D office experience, backed by real agent runtime, multi-tenant SaaS architecture, task orchestration, cost management, and live event synchronization.
   - Preserves all 268 imported specialist definitions, existing backend services, database schema, leadership agents, and frontend dock/HUD integrations.

---

## 2. Immutable Project Preservation Rules

1. Existing database records (`agency.db` and active models) must be preserved.
2. Existing 268 specialist definitions, versions, and source metadata must NOT be overwritten, deleted, duplicated, or wiped.
3. Existing leadership agents (Victoria Vance, David Chen, Dr. Elena Rostova, Sophia Martinez, Marcus Reynolds, Julian Thorne, Amara Okafor, Liam O'Connor) must be preserved.
4. Existing recruitment functionality, agent registry, agent runtime, orchestrator, task management, WebSockets, and APIs must remain backward-compatible.
5. Absolute isolation: `/Users/thienduc/Desktop/Code/OPagent` is an independent project and must never be accessed or modified.
6. No destructive migrations, no DB resets, no hardcoded fabricated progress bars or fake AI completion events.

---

## 3. Implementation Phases

- **Phase 0 — Complete Project Audit**:
  - Inspect codebase, database, runtime, 3D setup, and existing documents.
  - Deliverable: `PROVIPAGENT_ARCHITECTURE_AUDIT.md`.
- **Phase 1 — Architectural Integration Plan**:
  - Map My Office concepts cleanly into PROVIPAGENT.
  - Deliverable: `PROVIPAGENT_INTEGRATION_PLAN.md`.
- **Phase 2 — Workforce Integrity**:
  - Verify specialist definitions, uniqueness, division mapping, and lifecycle states.
- **Phase 3 — Event-Driven 3D Office**:
  - Connect real backend execution events to character states and animations via WebSocket.
- **Phase 4 — Execution Engine & Orchestration**:
  - Real task decomposition, specialist selection, agent execution, deliverables, and error recovery.
- **Phase 5 — Company Operations & Management**:
  - Department hierarchy, projects, approvals, and operation dashboards.
- **Phase 6 — Multi-Provider AI Architecture & Cost Control**:
  - Provider abstraction, token tracking, budgets, alerts, and cost attribution.
- **Phase 7 — Multi-Tenant Commercial SaaS**:
  - Tenant isolation, subscription tiers, usage limits, and payment sandboxes.
- **Phase 8 — Security & Production Readiness**:
  - Tool execution sandboxing, prompt injection defense, audit logs, and E2E verification.

---

## 4. Crucial Guidelines (Owner Directives)

1. **Do not attempt everything at once**: Execute step-by-step, phase-by-phase.
2. **Never delete the 268 specialists to re-import**: Upstream synchronization must use strict versioning, source hashes, and non-destructive upserts.
3. **Never confuse 3D animation with AI execution**: Characters in the 3D office must only reflect real backend states (`IDLE`, `WORKING`, `COLLABORATING`, etc.). Never generate fake visual movements detached from real execution.
