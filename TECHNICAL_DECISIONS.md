# PROVIPAGENT — TECHNICAL DECISIONS & ARCHITECTURAL LOG
**Document Status**: Approved Architecture Log (Phase 1)
**Target Project**: PROVIPAGENT Autonomous AI Company Operating System

---

## Decision 1: Declarative React Three Fiber (R3F) vs Imperative Vanilla Three.js

* **Context**: The reference repository `my-office` uses vanilla JavaScript imperative scene construction (`new THREE.Scene()`, custom animation loops in `workers.js`, direct DOM canvas binding). PROVIPAGENT currently has a Next.js 16 + React 19 + `@react-three/fiber` declarative frontend.
* **Decision**: **Retain and extend PROVIPAGENT's React Three Fiber architecture.** Do NOT rewrite the frontend to use vanilla JavaScript scripts.
* **Rationale**:
  1. *State Reactivity*: In R3F, the 3D scene directly binds to the Zustand store (`worldStore.ts`). When a WebSocket event arrives, React automatically re-renders only the changed avatar props.
  2. *Component Modularity*: Department furniture, lights, and avatars exist as isolated, reusable TSX components (`OfficeArchitecture.tsx`, `OfficeFurniture.tsx`, `CorporateAgentAvatar.tsx`).
  3. *Type Safety*: Full TypeScript compilation (`npx tsc --noEmit`) catches property errors at build time.
  4. *What we adapt from My Office*: We adapt the **mathematical models** from My Office (the waypoint walking graph, A* pathfinding, collision-free aisles, and seating geometry) and express them as custom hooks (`useWaypointNavigation`) inside our R3F components.

---

## Decision 2: Multi-Provider AI Abstraction Layer & Cost Attribution

* **Context**: A commercial AI company cannot rely on a single proprietary CLI or provider. It must orchestrate across OpenAI, Google Gemini, Anthropic, DeepSeek, Groq, and local Ollama while rigorously enforcing cost caps.
* **Decision**: Expand `backend/app/agent_runtime/llm/` into a standardized protocol-based provider abstraction:
  - `DeterministicProvider`: Fast, zero-cost offline validation engine.
  - `OpenAIProvider`: Direct adapter for OpenAI (`gpt-4o`, `gpt-4o-mini`), Groq (`llama-3.3-70b`), and OpenRouter.
  - `GeminiProvider`: Direct native adapter using Google GenAI SDK (`gemini-2.5-flash`, `gemini-2.5-pro`).
  - `AnthropicProvider`: Direct native adapter for Claude (`claude-3-7-sonnet`, `claude-3-5-haiku`).
  - `OllamaProvider`: Local inference for air-gapped or cost-free routine tasks.
* **Dynamic Pricing Engine**:
  - Provider pricing is stored in a versioned configuration table (`model_pricing`), never hardcoded in python functions.
  - Pricing records input token cost per 1M, output token cost per 1M, and effective date.
  - Every subtask execution writes exact token counts (`prompt_tokens`, `completion_tokens`) into `agent_performance` and `pa_financial_ledger`.
* **Budget Hard Stops**:
  - If a specialist reaches `budget_spent_usd >= budget_limit_usd`, the execution loop triggers `CancellationToken.cancel()`, emits `budget.exhausted`, and transitions the specialist to `BLOCKED`.

---

## Decision 3: Separation of Specialist Catalog, Recruited Workforce, and Execution Context

* **Context**: Storing 268+ specialists could tempt an architect to spawn 268 background AI loops or load 268 LLM context windows.
* **Decision**: Strict 3-tier lifecycle decoupling:
  1. **Specialist Definition**: Static row in `specialist_definitions` table. Represents potential skills. Consumes 0 tokens, 0 memory, 0 GPU draw calls.
  2. **Recruited Specialist**: Record in `recruitment_records` linking an organization to a specialist definition. Assigns department desk coordinates, manager, and budget ceiling. Consumes 0 tokens while idle at desk.
  3. **Active Execution Instance**: Ephemeral async Python coroutine spawned by `MultiAgentOrchestrator` when a task is dispatched. Only during this window are LLM calls made and tokens consumed.

---

## Decision 4: Non-Destructive Multi-Tenant Database Migration

* **Context**: Current `agency.db` holds 268 imported specialists and 8 executive leaders. Wiping the database to add `organization_id` would destroy catalog integrity.
* **Decision**:
  - Never execute destructive `DROP TABLE` or `db.reset()` operations.
  - Apply nullable `organization_id` column defaults pointing to a seed tenant (`'org_default_company'`).
  - All existing records remain valid and immediately functional.

---

## Decision 5: Architectural Boundaries & OPagent Isolation

* **Context**: An independent repository `/Users/thienduc/Desktop/Code/OPagent` exists on the local machine.
* **Decision**:
  - Complete architectural and physical isolation.
  - No shared imports, no symlinks, no cross-project file transfers. All development remains strictly within `/Users/thienduc/Desktop/Code/provipagent`.

---

## Decision 6: Verification Checklist Against Architectural Constraints

| Constraint Check | Status | Verification Detail |
| :--- | :--- | :--- |
| **No duplicate runtime** | **VERIFIED** | Reuses existing `ExecutionLoop`, `CancellationToken`, `default_tool_registry`. |
| **No duplicate specialist registry** | **VERIFIED** | Reuses `default_agent_registry`; recruited specialists registered via `recruitment_service`. |
| **No duplicate orchestrator** | **VERIFIED** | Reuses `MultiAgentOrchestrator` and `MultiAgentPlanner` (Kahn's DAG). |
| **No fake execution events** | **VERIFIED** | 3D office animations update only on genuine backend event receipt. |
| **No destructive migrations** | **VERIFIED** | Non-destructive nullable migrations with default tenant fallback. |
| **No Claude Code CLI dependency** | **VERIFIED** | Fully standalone multi-provider backend; zero dependency on `~/.claude/settings.json`. |
| **No forced rendering of all 268+** | **VERIFIED** | 48-desk physical capacity with dynamic instancing and LOD. |
| **No frontend-owned state** | **VERIFIED** | Backend SQLite + WebSocket remains single authoritative source of truth. |

---

## Decision 7: Dynamic Logical Workstation Allocation Decoupled from Physical Rendering (Phase 2)

* **Context**: The 3D corporate office visualization has physical layout constraints (e.g. 48 visible desk positions across department pods). However, enterprise customers need to recruit dozens or hundreds of specialists (supporting the 268+ specialist library).
* **Decision**: Decouple logical workforce allocations from physical rendered desks.
  1. `WorkstationAllocationModel` manages logical workstation IDs (`ws-<dept>-<num>`), zones, and 3D coordinates.
  2. If an organization recruits specialists beyond physical capacity, the allocator seamlessly assigns virtualized desk allocations (`vws-<dept>-<num>`, `allocation_status="VIRTUAL"`, `is_virtual=True`).
  3. No artificial workforce caps (such as 48 agents) are imposed on the company database.
  4. Retiring an employee transitions the allocation to `UNASSIGNED` and frees physical desk slots for other active specialists.

---

## Decision 8: Controlled Agency Agents Upstream Synchronization Engine (Phase 2)

* **Context**: The upstream `agency-agents` repository evolves independently. Pulling updates must never silently overwrite customer personas, delete local records, or disrupt running tasks.
* **Decision**:
  1. Pure SHA-256 content hashing engine (`AgencyAgentSynchronizer`) that operates without external LLM API dependency.
  2. Dry-run synchronization preview (`preview_sync`) classifying changes into `NEW`, `UNCHANGED`, `UPDATED`, `REMOVED_UPSTREAM`, `INVALID`, and `CONFLICT`.
  3. Actively recruited specialists modified upstream are flagged as `CONFLICT` requiring explicit administrative approval.
  4. Version history preservation: updating a specialist bumps its version number (e.g., v1 -> v2) and creates an immutable snapshot in `SpecialistVersionModel`.
  5. Zero silent deletes: upstream deletions flag records with warning status without deleting database rows.

---

## Decision 9: Server-Side Cryptographic Identity & Non-Leaking Tenant Scoping (Phase 2.2)

* **Context**: In Phase 2.1, APIs lacked authentication and trusted `organization_id` supplied in request bodies or query parameters.
* **Decision**:
  1. Pure Python standard-library HMAC-SHA256 JWT tokens and PBKDF2 password hashing.
  2. Identity and tenant organization are resolved strictly from verified server-side claims and database memberships (`get_current_tenant_org`).
  3. Request body `organization_id` fields are discarded and overridden by authenticated tenant context.
  4. Non-leaking negative authorization: queries and mutations targeting resources owned by other organizations return `404 Not Found` rather than `403 Forbidden` to prevent agent ID existence probing.

---

## Decision 10: Database Partial Unique Index with Savepoint Retry for Desks (Phase 2.2)

* **Context**: Application-level desk availability checks permitted concurrent allocation collisions.
* **Decision**:
  1. Database-enforced partial unique index `uq_assigned_physical_desk` on `(organization_id, department, desk_number)` constrained to `allocation_status = 'ASSIGNED' AND desk_number IS NOT NULL`.
  2. Savepoint (`db.begin_nested()`) retry loop in `WorkstationService` catching `IntegrityError` upon physical desk collisions, cleanly advancing to the next desk or falling back to virtual allocation.

---

## Decision 11: Immutable Specialist Version Pinning & Runtime Prompt Isolation (Phase 2.2)

* **Context**: Recruited agents dynamically referenced mutable catalog rows, causing silent persona mutation on upstream sync.
* **Decision**:
  1. Add immutable `specialist_version_id` foreign key referencing `specialist_versions.id` and `specialist_version_num` on `recruitment_records`.
  2. Prompt assembly in `_register_in_runtime` extracts system instructions from the pinned version snapshot, explicitly declaring `Pinned Specialist Version: v{num}`.
  3. Catalog updates create new version snapshots without mutating existing recruited employees.

---

## Decision 12: Unified Transaction Boundary Policy (Phase 2.2)

* **Context**: Lower-level services executed premature internal commits, breaking outer rollback boundaries.
* **Decision**:
  1. "One business operation = One transaction boundary".
  2. Sub-services (`WorkstationService`, `EventService`) execute `db.flush()`, never `db.commit()`.
  3. Orchestrating service (`RecruitmentService`) owns the single transaction boundary with automatic `db.rollback()` on exception.

---

## Decision 13: Authoritative 3-Tier Recruitment Lifecycle Execution Defense (Phase 2.2)

* **Context**: Disconnected lifecycle statuses allowed suspended and retired agents to execute tasks.
* **Decision**:
  1. Centralized lifecycle policy: `ACTIVE` allowed; `CONFIGURED`, `SUSPENDED`, `RETIRED` strictly rejected.
  2. 3-tier defense: (1) task creation in `TaskService`, (2) task dispatch in `_claim_next_task`, (3) pre-execution in `_process_task`.
  3. Auto-cancellation of queued tasks upon employee suspension or retirement.

---

## Decision 14: Platform Superadmin Catalog Protection & Audit Logging (Phase 2.2)

* **Context**: Catalog sync endpoints lacked administrative role requirements and audit records.
* **Decision**:
  1. `POST /api/v1/specialists/sync/preview` requires `PERM_PREVIEW_CATALOG_SYNC`.
  2. `POST /api/v1/specialists/sync/apply` and `/import` strictly restricted to `PLATFORM_SUPERADMIN`.
  3. Every synchronization execution logs a structured audit event to the database and system logger with user email, ID, approved slugs, and change counts.

---

## Decision 15: Fail-Secure Signing Secret & Server-Side Privilege Authority (Phase 2.2.2 — SEC-01)

* **Context**: Application previously defaulted to development signing secrets and trusted client-provided JWT claims (`is_superadmin=True`).
* **Decision**:
  1. Validate `SECRET_KEY` during application startup (`validate_signing_secret`): abort boot with `RuntimeError` if missing, empty, known development default, or <32 bytes.
  2. Treat all role/privilege claims in incoming JWTs as untrusted hints. Authoritative platform superadmin and organization roles are resolved strictly from database records (`UserModel.is_superadmin`, `OrganizationMemberModel`).
  3. Prevent algorithm confusion by requiring `"alg": "HS256"` and `"typ": "JWT"`.

---

## Decision 16: Dynamic User Authorization & Instant Session Revocation (Phase 2.2.2 — SEC-02)

* **Context**: Static JWT token validation allowed deactivated users or downgraded members to continue accessing resources until token expiry.
* **Decision**:
  1. Dynamic database lookup on every authenticated request in `get_current_user`: confirm user exists and `is_active == True`; reject deactivated/deleted accounts with HTTP 401.
  2. Implement `token_version` on `UserModel`: issue tokens containing `"ver"`; compare against current `user.token_version`. `revoke_user_tokens(db, user_id)` increments version to instantly invalidate all issued sessions.
  3. Dynamically resolve organization memberships and permissions from authoritative database records on each request.

---

## Decision 17: Non-Leaking Execution API Tenant Scoping (Phase 2.2.2 — SEC-03)

* **Context**: Core execution APIs (`/tasks`, `/agents`, `/workflows`, `/approvals`, `/memories`, `/events`, `/artifacts`, `/ws`) previously lacked tenant isolation.
* **Decision**:
  1. Bind `TaskModel` to `organizations.id` via foreign key and `ix_tasks_org_status` index.
  2. Derive tenant identity exclusively on the server (`get_current_tenant_org`). Discard client-supplied `organization_id` in bodies, query parameters, and headers.
  3. Implement non-leaking negative authorization: cross-tenant access and mutation attempts return HTTP 404 rather than HTTP 403 to prevent resource UUID enumeration.
  4. Enforce tenant isolation in WebSockets by validating token upon connection and partitioning broadcast envelopes by tenant organization.

---

## Decision 18: Pinned Prompt Delivery to Model Invocation & Snapshot Immutability (Phase 2.2.2 — VER-01, VER-02, VER-03)

* **Context**: The AI runtime dispatcher previously fell back to generic prompts and omitted the recruited employee's pinned specialist prompt when calling the execution loop. Furthermore, specialist configurations were partly mutable.
* **Decision**:
  1. `TaskDispatcher` resolves the employee's pinned specialist version and passes `system_instruction` directly to `executor.run(...)`.
  2. `ExecutionLoop` prepends `system_instruction` to provider messages, ensuring the exact pinned prompt reaches the AI model.
  3. Capture immutable runtime configuration snapshots (`tools`, `permissions`, `rules`, `system_instructions`) in `parsed_metadata` on `SpecialistVersionModel`.
  4. Flag unpinned historical records with `is_legacy_unpinned` and block task execution pending administrative review via `GET /api/v1/recruitment/legacy-audit`.
  5. Strictly separate specialist capability definitions from tenant permission grants; upstream markdown cannot elevate tenant or platform permissions.
