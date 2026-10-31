# PHASE 2.2.1 — SPECIALIST VERSION PINNING & RUNTIME PROMPT TRACE AUDIT
**Authoritative Version Pinning & Runtime Prompt Assembly Report**
**Role:** Independent Senior AI Runtime Security Engineer & Principal Software Architect
**Date:** 2026-10-31
**Project:** PROVIPAGENT Autonomous AI Company Operating System
**Audit Scope:** End-to-End Runtime Trace from Database Model to LLM Provider, Version Immutability, Catalog Synchronization Drift, Legacy Record Handling.

---

## 1. Executive Summary

Phase 2.2 introduced immutable specialist versioning by storing foreign keys `specialist_version_id` and integer `specialist_version_num` on [RecruitmentRecordModel](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/recruitment.py#L32-L38), populating [AgentRegistry](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/agent_runtime/registry/agent_registry.py) with version-pinned instructions upon recruitment and restoring them on application reboot via [restore_active_workforce](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/recruitment_service.py#L439-L461).

Our independent adversarial trace from the database record through prompt assembly, the agent registry, dispatcher claim, and model request invocation has revealed a **High-Severity Architectural Execution Break**:
While [RecruitmentService](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/recruitment_service.py#L237) accurately generates and registers the pinned system prompt inside `AgentRegistry`, the background [TaskDispatcher](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/agent_runtime/dispatcher/dispatcher.py#L195-L292) fails to query `AgentRegistry` and **never passes `system_instruction`** to the execution loop for single tasks. As a result, standard tasks execute using a generic fallback prompt, completely bypassing the specialist's pinned instructions at the model invocation layer.

---

## 2. Complete Runtime Path Trace

```mermaid
flowchart TD
    DB[(RecruitmentRecordModel)] -->|specialist_version_id| RecService[RecruitmentService.recruit_specialist]
    RecService -->|Fetch raw_content| VerModel[(SpecialistVersionModel)]
    VerModel -->|Extract Markdown Body| Assembly[Prompt Assembly: Pinned v{N}]
    Assembly -->|AgentDefinition| Reg[AgentRegistry.default_agent_registry]

    subgraph Execution Path Single Tasks
        TaskQ[(TaskModel: queued)] -->|Claim| Disp[TaskDispatcher._claim_next_task]
        Disp -->|Process| Proc[TaskDispatcher._process_task]
        Proc -.->|BUG: Does NOT lookup registry| Reg
        Proc -->|Hardcodes GENERAL_AGENT| Exec[ExecutionLoop.run]
        Exec -->|system_instruction=None| FallbackPrompt[Fallback Default Prompt: You are autonomous agent]
        FallbackPrompt --> LLM[LLM Provider Request]
    end

    subgraph Execution Path MultiAgent Workflows
        WFProc[multi_agent_orchestrator._execute_subtask] -->|Lookup registry| Reg
        Reg -->|agent_def.system_prompt| ExecWF[ExecutionLoop.run]
        ExecWF -->|system_instruction=Pinned Prompt| LLMWF[LLM Provider Request]
    end
```

### Detailed Trace Steps:
1. **Database Layer:** [RecruitmentRecordModel](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/recruitment.py#L32-L38) stores `specialist_version_id` (FK to `specialist_versions.id`) and `specialist_version_num`.
2. **Recruitment Layer:** In [RecruitmentService.recruit_specialist](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/recruitment_service.py#L121-L136), the version is resolved:
   - If `requested_version` is specified, it strictly queries `SpecialistVersionModel.version == requested_version`.
   - If omitted, it queries the version matching `specialist.version` or the highest version descending.
3. **Prompt Assembly:** In [RecruitmentService._register_in_runtime](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/recruitment_service.py#L283-L336):
   - Extracts `mission` from `version_record.raw_content`.
   - Assembles `system_prompt` containing:
     ```
     You are {agent.name}, a specialized {specialist.role}...
     Pinned Specialist Version: v{pinned_ver_num}
     Core Mission & Expertise:
     {mission}
     ```
   - Instantiates `AgentDefinition` and registers it in `default_agent_registry.register(agent_def)`.
4. **Startup Restoration:** In [runtime.py:on_startup](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/agent_runtime/runtime.py#L29-L35), `recruitment_service.restore_active_workforce(db)` iterates through all `ACTIVE` recruitment records and re-registers each agent with their pinned version in `default_agent_registry`.
5. **Multi-Agent Orchestrator Execution:** In [multi_agent_orchestrator.py:L485](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/agent_runtime/orchestrator/multi_agent_orchestrator.py#L485), subtasks query `self.registry.get(subtask.agent_type)` and pass `system_instruction=agent_def.system_prompt` to `executor.run()`. **VERIFIED FOR WORKFLOW SUBTASKS**.
6. **Single-Task Execution Breakdown:** In [dispatcher.py:_process_task](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/agent_runtime/dispatcher/dispatcher.py#L201-L292):
   - `default_agent_registry` is never queried for `task.assigned_agent_id`.
   - `agent_policy` is hardcoded to `GENERAL_AGENT.to_policy()`.
   - `self.executor.run(...)` is invoked without passing `system_instruction`.
   - In [executor.py:L91-L99](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/agent_runtime/executor.py#L91-L99), `system_instruction` falls back to:
     ```python
     system_instruction = system_instruction or (
         f"You are the autonomous AI Agent ({agent_id}) in AI Agent City.\n"
         "Execute the task systematically using the available tools.\n..."
     )
     ```
   - **RESULT:** The specialist's pinned instructions, mission, and rules are completely lost during standard single-task execution!

---

## 3. Adversarial Version Pinning Integration Test

An isolated test simulated an upstream catalog bump from Version 1 to Version 2:
1. Recruited Employee 1 using specialist `academic-psychologist` pinned to **Version 1**.
2. Synchronized an upstream update that bumped the catalog definition to **Version 2** with a new mission: `"UPSTREAM VERSION 2 MISSION: Advanced Behavioral Neuropsychology Directives."`.
3. Verified Employee 1 database record: `pinned_version_num` remained `1` and `pinned_version_id` remained `a71d3017-4884-4bd2-a124-613a0623fbf3`.
4. Verified Employee 1 prompt in `AgentRegistry`: prompt explicitly contained `Pinned Specialist Version: v1`.
5. Recruited Employee 2 without requesting a specific version:
   - Employee 2 was assigned `pinned_version_num=2`.
   - Employee 2 prompt in `AgentRegistry` explicitly contained `Pinned Specialist Version: v2`.
6. Simulated application restart (`default_agent_registry._registry.clear()` followed by `restore_active_workforce`):
   - Restored Employee 1 registered with `(Operations Specialist - Pinned v1)`.
   - Restored Employee 2 registered with `(Operations Specialist - Pinned v2)`.

---

## 4. Adversarial Findings & Deficiencies

### FINDING-2.2.1-VER-01: Pinned Specialist Version Instructions Omitted During Single-Task Dispatch Execution
* **Severity:** **HIGH** (CVSS: 7.5 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N`)
* **Affected File & Line:** [backend/app/agent_runtime/dispatcher/dispatcher.py:L201-L292](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/agent_runtime/dispatcher/dispatcher.py#L201-L292), [backend/app/agent_runtime/executor.py:L91-L99](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/agent_runtime/executor.py#L91-L99)
* **Evidence:**
  `default_agent_registry` is not imported or queried in `dispatcher.py`. Line 281 calls `executor.run()` without `system_instruction`:
  ```python
  # dispatcher.py line 281
  exec_result: ExecutionResult = await self.executor.run(
      task_id=task.id,
      agent_id=task.assigned_agent_id,
      user_prompt=f"{task.title}\n{task.description}",
      llm_provider=llm_provider,
      agent_policy=agent_policy,
      cancellation_token=token,
      plan_steps=plan_step_dicts,
      db=db,
      memory_context=memory_context,
      # system_instruction is missing!
  )
  ```
* **Impact:** Any single task dispatched to a recruited employee runs with generic agent instructions. The specialist's domain expertise, pinned version instructions, and behavioral guidelines are not sent to the LLM.
* **Exploitable:** Integrity & Functionality Failure.
* **Recommended Remediation:**
  In `dispatcher.py`:
  ```python
  from backend.app.agent_runtime.registry.agent_registry import default_agent_registry

  agent_def = default_agent_registry.get(task.assigned_agent_id)
  system_instruction = agent_def.system_prompt if agent_def else None
  agent_policy = agent_def.to_policy() if agent_def else GENERAL_AGENT.to_policy()

  exec_result = await self.executor.run(
      ...,
      agent_policy=agent_policy,
      system_instruction=system_instruction,
  )
  ```

---

### FINDING-2.2.1-VER-02: Legacy Unlinked Recruitment Records Silently Fall Back to Arbitrary Catalog Version
* **Severity:** **MEDIUM** (CVSS: 5.3 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`)
* **Affected File & Line:** [backend/app/services/recruitment_service.py:L135, L298, L454-L457](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/recruitment_service.py#L135)
* **Evidence:**
  When `recruitment_records.specialist_version_id` is NULL (as in pre-migration legacy records), `restore_active_workforce` sets `ver = None`. In `_register_in_runtime`:
  ```python
  pinned_ver_num = version_record.version if version_record else (specialist.version or 1)
  mission = specialist.core_mission or specialist.description
  ```
  The system silently binds the legacy employee to the current mutable `specialist.version` and current `specialist.core_mission` without raising a review warning or recording an unpinned audit event.
* **Impact:** If upstream synchronization updates `specialist.version`, legacy employees will silently drift to newer versions upon reboot instead of remaining safely pinned or flagged for review.
* **Exploitable:** Data integrity drift.
* **Recommended Remediation:** Flag records with `specialist_version_id IS NULL` by setting `notes = "[UNPINNED_LEGACY] Requires Version Confirmation"` and emitting an administrative warning event during startup.

---

### FINDING-2.2.1-VER-03: Shared SpecialistDefinitionModel Mutates While Historical Versions Only Preserve Raw Content
* **Severity:** **MEDIUM** (CVSS: 5.0 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`)
* **Affected File & Line:** [backend/app/services/agency_agent_synchronizer.py:L311-L332](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/services/agency_agent_synchronizer.py#L311-L332), [backend/app/models/specialist.py:SpecialistVersionModel](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/models/specialist.py)
* **Evidence:**
  `SpecialistVersionModel` only contains `id`, `specialist_id`, `version`, `source_commit_sha`, `content_hash`, `raw_content`, and `change_summary`. It does NOT store `role`, `critical_rules`, `assigned_tools`, or `permission_level`.
  When `apply_sync` processes an update, it mutates `SpecialistDefinitionModel.assigned_tools`, `critical_rules`, and `permission_level` directly on the shared table.
  When `_register_in_runtime` runs on reboot:
  ```python
  critical_rules = specialist.critical_rules or "..."
  assigned_tools = specialist.assigned_tools or ["workspace_list", "file_read"]
  permission_level = specialist.permission_level
  ```
  An employee pinned to v1 retrieves `mission` from v1 raw content, but inherits the **v2** tools and permission level from the mutated definition.
* **Impact:** Incomplete version immutability across tool permissions and security clearance.
* **Exploitable:** Subtle security/permission drift.
* **Recommended Remediation:** Add a JSON column `parsed_metadata` to `SpecialistVersionModel` storing `assigned_tools`, `permission_level`, `role`, and `critical_rules` so historical versions can be restored with 100% fidelity.

---

## 5. Verification Verdict

**VERSION PINNING AUDIT RESULT:** **FAIL**
Although the database foreign keys and `AgentRegistry` prompt assembly maintain strict version pinning, the failure of `TaskDispatcher` to pass the pinned prompt to `executor.run()` represents an execution runtime failure.
