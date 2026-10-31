# PHASE 2.2.2 EXECUTION PROMPT INTEGRITY SPECIFICATION

**Document Identifier**: `PHASE_2_2_2_EXECUTION_PROMPT_INTEGRITY.md`
**Related Finding**: **VER-01 (P0 Critical)**
**Verification Suite**: [test_phase2_2_2_verification.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/tests/test_phase2_2_2_verification.py)
**Status**: VERIFIED & CLOSED

---

## 1. Executive Summary

Finding **VER-01** revealed a critical AI runtime defect: while the recruitment service recorded pinned specialist version IDs in the database, `TaskDispatcher._process_task` bypassed these configurations during execution. The dispatcher instead instantiated generic agent policies (`GENERAL_AGENT.to_policy()`) and omitted the specialist's system instructions when calling `self.executor.run(...)`.

This report documents the end-to-end investigation, architecture redesign, and verification proving that the recruited employee's immutable pinned specialist prompt reaches the underlying AI model invocation without modification or fallback.

---

## 2. Execution Path Investigation & Root Cause

### 2.1 The Broken Historical Path
Prior to Phase 2.2.2, tracing task execution revealed the following disconnect:
1. `RecruitmentRecordModel` stored `specialist_version_id = "ver_abc123"`.
2. When a task was queued and picked up by `TaskDispatcher._process_task`:
   - The dispatcher called `default_agent_registry.get(task.assigned_agent_id)`.
   - If missing from registry, or during single-task execution, the code fell back to:
     ```python
     agent_def = default_agent_registry.get("general")
     policy = agent_def.to_policy()
     ```
   - When calling `self.executor.run(...)`, the dispatcher invoked:
     ```python
     result = await self.executor.run(
         task_id=task.id,
         agent_id=task.assigned_agent_id,
         user_prompt=prompt,
         llm_provider=provider,
         agent_policy=policy,
         cancellation_token=token,
         memory_context=memory_context,
         # SYSTEM_INSTRUCTION WAS NOT PASSED!
     )
     ```
   - In `ExecutionLoop.run`, messages were constructed solely from `user_prompt` and `memory_context`. The specialist's unique skills, behavioral guidelines, constraints, and instructions never reached the provider adapter.

---

## 3. Remediated Architecture & Implementation

### 3.1 Authoritative Pinned Prompt Resolution
In [dispatcher.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/agent_runtime/dispatcher/dispatcher.py):
1. **Dynamic Registration Recovery**:
   When processing a task assigned to employee `agent_id`:
   ```python
   agent_def = default_agent_registry.get(task.assigned_agent_id)
   if not agent_def and rec:
       spec = db.query(SpecialistDefinitionModel).filter(SpecialistDefinitionModel.id == rec.specialist_definition_id).first()
       ver = db.query(SpecialistVersionModel).filter(SpecialistVersionModel.id == rec.specialist_version_id).first() if rec.specialist_version_id else None
       if spec and agent and ver:
           from backend.app.services.recruitment_service import recruitment_service
           agent_def = recruitment_service._register_in_runtime(
               agent=agent,
               specialist=spec,
               version_num=rec.specialist_version_num or 1,
               version_id=ver.id,
               db=db,
               permission_profile=rec.permission_profile or "LEVEL_1_WORKSPACE_WRITE",
           )
   ```
2. **Pinned Version Prompt Extraction**:
   The dispatcher resolves the pinned `SpecialistVersionModel` and assembles:
   ```python
   effective_system_instruction = (
       ver.system_instructions or spec.system_instructions or getattr(agent_def, "system_instruction", "")
   )
   ```
3. **Explicit Forwarding to Executor**:
   ```python
   result = await self.executor.run(
       task_id=task.id,
       agent_id=task.assigned_agent_id,
       user_prompt=prompt,
       llm_provider=provider,
       agent_policy=policy,
       cancellation_token=token,
       memory_context=memory_context,
       system_instruction=effective_system_instruction, # EXPLICIT IMMUTABLE PROMPT
   )
   ```

### 3.2 Provider Forwarding in Execution Loop
In [executor.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/agent_runtime/executor.py):
`ExecutionLoop.run` accepts `system_instruction: Optional[str] = None`. When initializing messages for the LLM provider, it sets:
```python
if system_instruction:
    messages.append({
        "role": "system",
        "content": system_instruction.strip()
    })
```
This ensures that whether using `OpenAIProvider`, `GeminiProvider`, `AnthropicProvider`, or offline adapters, the specialist's pinned instructions form the authoritative system prompt.

### 3.3 Diagnostic Blocking of Missing / Unpinned Versions
If an employee has `specialist_version_id IS NULL` or is flagged with `is_legacy_unpinned == True`:
- The dispatcher **does not execute generic fallbacks**.
- The execution is immediately halted, and the task status transitions to `cancelled`.
- `task.error_message` records: `"Task execution rejected: employee '{id}' has an unpinned legacy version."`.

---

## 4. End-to-End Verification Evidence

### 4.1 Test Implementation: `test_pinned_specialist_prompt_reaches_provider_e2e`
In [test_phase2_2_2_verification.py](file:///Users/thienduc/Desktop/Code/provipagent/backend/app/tests/test_phase2_2_2_verification.py):
1. **Specialist Definition v1 Created**: `system_instructions = "PINNED VERSION 1 SYSTEM INSTRUCTIONS - SPECIALIST ALPHA"`.
2. **Employee Recruited**: Employee is recruited, explicitly pinning version 1 (`specialist_version_id = ver1.id`).
3. **Upstream Evolution to v2**: A new version 2 is introduced with `system_instructions = "UPSTREAM VERSION 2 MODIFIED SYSTEM INSTRUCTIONS"`.
4. **Task Execution**: A task is dispatched to the recruited employee.
5. **Capturing Provider Adapter**: A mock LLM provider captures the exact messages passed to `generate(...)`.
6. **Assertions**:
   - `captured_system_prompt == "PINNED VERSION 1 SYSTEM INSTRUCTIONS - SPECIALIST ALPHA"`.
   - Version 2's modified prompt is **not** present.
   - Generic fallback prompt is **not** present.

### 4.2 Test Results
- `test_pinned_specialist_prompt_reaches_provider_e2e` **PASSED**.
- `test_cross_tenant_task_execution_blocked_in_dispatcher` **PASSED**.

Prompt immutability and execution integrity are fully verified from recruitment through model invocation.
