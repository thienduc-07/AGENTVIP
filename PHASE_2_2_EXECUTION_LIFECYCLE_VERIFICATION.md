# PHASE 2.2 — RECRUITMENT LIFECYCLE & EXECUTION INTEGRITY VERIFICATION

**Authoritative AI Runtime Deliverable**
**Date:** October 31, 2026
**Status:** **VERIFIED (EXECUTION GUARDS ACTIVE)**
**Target Codebase:** `provipagent/`

---

## 1. Scope and Objective

This report documents the verification of **REMED-05** (Recruitment Lifecycle Execution Guards).

In Phase 2.1 Audit (Finding EXEC-01), the application had disconnected lifecycle state representations:
- `RecruitmentRecordModel.lifecycle_state` (`ACTIVE`, `CONFIGURED`, `SUSPENDED`, `RETIRED`).
- `AgentModel.status` (`idle`, `working`, `offline`).
- `AgentDefinition.enabled` (Boolean flag in memory registry).

Because `TaskService.create_task` and `TaskDispatcher` only checked whether an agent record existed in the database, tasks could be assigned to and executed by employees who had been suspended or permanently retired.

---

## 2. Authoritative Lifecycle Policy

PROVIPAGENT now enforces one authoritative lifecycle policy across all task assignment and runtime execution entry points:

```
+---------------------------------------------------------------------------------------------------------+
| Lifecycle State | New Task Creation | Dispatcher Claim | Immediate Pre-Execution | Queued Tasks Action   |
+---------------------------------------------------------------------------------------------------------+
| ACTIVE          | ALLOWED           | ALLOWED          | ALLOWED                 | Normal Execution      |
| CONFIGURED      | REJECTED (422)    | REJECTED         | REJECTED                | Paused / Blocked      |
| SUSPENDED       | REJECTED (422)    | REJECTED         | REJECTED                | AUTO-CANCELLED        |
| RETIRED         | REJECTED (422)    | REJECTED         | REJECTED                | AUTO-CANCELLED        |
+---------------------------------------------------------------------------------------------------------+
```

---

## 3. Defense-in-Depth Implementation

Three distinct layers of defense protect the runtime from executing unauthorized work:

### 3.1 Layer 1: Task Assignment Guard (`TaskService.create_task`)
Before creating any task record in the database:
```python
from backend.app.models.recruitment import RecruitmentRecordModel
rec = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == agent.id).first()
if rec:
    if rec.lifecycle_state in ["SUSPENDED", "RETIRED", "CONFIGURED"]:
        raise ValidationError(
            message=f"Agent '{agent.id}' is in lifecycle state '{rec.lifecycle_state}' and cannot accept tasks.",
            code="AGENT_LIFECYCLE_INACTIVE"
        )
elif agent.status == "offline":
    raise ValidationError(
        message=f"Agent '{agent.id}' is offline and cannot accept tasks.",
        code="AGENT_OFFLINE"
    )
```

### 3.2 Layer 2: Dispatcher Claim Guard (`TaskDispatcher._claim_next_task`)
When polling for queued tasks to dispatch:
```python
rec = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == task.assigned_agent_id).first()
agent = db.query(AgentModel).filter(AgentModel.id == task.assigned_agent_id).first()

if (rec and rec.lifecycle_state != "ACTIVE") or (agent and agent.status == "offline"):
    task.status = "cancelled"
    state_desc = rec.lifecycle_state if rec else "offline"
    task.error_message = f"Task cancelled: assigned employee '{task.assigned_agent_id}' is in lifecycle state '{state_desc}'."
    task.completed_at = datetime.utcnow()
    task.updated_at = datetime.utcnow()
    db.commit()
    logger.warning(f"Task '{task.id}' auto-cancelled at dispatch: agent '{task.assigned_agent_id}' is {state_desc}.")
    return None
```

### 3.3 Layer 3: Immediate Pre-Execution Guard (`TaskDispatcher._process_task`)
Immediately before launching the LLM planner or executing tools:
```python
rec = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == task.assigned_agent_id).first()
agent = db.query(AgentModel).filter(AgentModel.id == task.assigned_agent_id).first()
if (rec and rec.lifecycle_state != "ACTIVE") or (agent and agent.status == "offline"):
    task.status = "cancelled"
    state_desc = rec.lifecycle_state if rec else "offline"
    task.error_message = f"Task execution rejected: employee '{task.assigned_agent_id}' is in lifecycle state '{state_desc}'."
    task.completed_at = datetime.utcnow()
    task.updated_at = datetime.utcnow()
    db.commit()
    logger.warning(f"Task '{task_id}' rejected immediately before execution: agent is {state_desc}.")
    return
```

### 3.4 Queued Task Handling on Suspension or Retirement
When an administrator suspends or retires an employee in `RecruitmentService.transition_lifecycle()`:
1. `RecruitmentRecordModel.lifecycle_state` updates to target state.
2. `AgentModel.status` updates to `"offline"`.
3. In-memory `AgentDefinition.enabled` is set to `False`.
4. Any tasks in `queued`, `planning`, or `waiting_approval` status assigned to that employee are automatically transitioned to:
   - `status = "cancelled"`
   - `error_message = f"Task cancelled: assigned employee was {target_state.lower()}."`
   - `completed_at = datetime.utcnow()`
5. If actively executing in the runtime, `agent_runtime.cancel_task()` signals cooperative cancellation.
6. If retiring, the physical workstation desk reservation is released (`UNASSIGNED`).

---

## 4. Verification Test Results

Tests in `backend/app/tests/test_phase2_2_remediations.py` prove:

### Test 1: Task Assignment Guard (`test_task_creation_rejected_for_suspended_and_retired_employees`)
- While `ACTIVE`: `TaskService.create_task` succeeds with status `queued`.
- Transition to `SUSPENDED`: `TaskService.create_task` raises `ValidationError` with message `Agent '...' is in lifecycle state 'SUSPENDED' and cannot accept tasks.`
- Transition to `RETIRED`: `TaskService.create_task` raises `ValidationError` with message `Agent '...' is in lifecycle state 'RETIRED' and cannot accept tasks.`
- **Verdict:** PASSED.

### Test 2: Auto-Cancellation of Queued Tasks (`test_queued_tasks_auto_cancelled_upon_suspension_or_retirement`)
- Two tasks queued for active employee (`t1`, `t2` in `status = "queued"`).
- Employee transitioned to `SUSPENDED`.
- Database re-queried:
  - `t1.status == "cancelled"`
  - `t1.error_message == "Task cancelled: assigned employee was suspended."`
  - `t2.status == "cancelled"`
  - `t2.error_message == "Task cancelled: assigned employee was suspended."`
- **Verdict:** PASSED. Zero orphan task executions.
