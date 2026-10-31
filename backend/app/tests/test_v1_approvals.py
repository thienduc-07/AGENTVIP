import pytest
from datetime import datetime
from backend.app.models.approval import ApprovalModel
from backend.app.models.task import TaskModel

def test_approval_flow_and_duplicate_decision_conflict(auth_client, db_session, seed_test_agent):
    # Setup task and approval in test db
    task = TaskModel(
        id="task-approval-test",
        title="High Risk Action Task",
        description="Task requiring authorization",
        status="waiting_approval",
        priority="high",
        assigned_agent_id=seed_test_agent.id
    )
    approval = ApprovalModel(
        id="appr-101",
        task_id=task.id,
        action_type="execute_sandbox_script",
        description="Execute python script modifying island firewall",
        status="pending",
        requested_at=datetime.utcnow()
    )
    db_session.add(task)
    db_session.add(approval)
    db_session.commit()

    # 1. Fetch approvals list
    list_res = auth_client.get("/api/v1/approvals?status=pending")
    assert list_res.status_code == 200
    approvals = list_res.json()
    assert any(a["id"] == "appr-101" for a in approvals)

    # 2. Make approval decision: approve
    decision_payload = {
        "decision": "approved",
        "reason": "Captain verified firewall script safety"
    }
    decide_res = auth_client.post("/api/v1/approvals/appr-101/decision", json=decision_payload)
    assert decide_res.status_code == 200
    data = decide_res.json()
    assert data["status"] == "approved"
    assert data["decision_reason"] == decision_payload["reason"]
    assert data["resolved_at"] is not None

    # 3. Second decision on same approval must be rejected with 409 Conflict
    duplicate_res = auth_client.post("/api/v1/approvals/appr-101/decision", json=decision_payload)
    assert duplicate_res.status_code == 409
    error = duplicate_res.json()["error"]
    assert error["code"] == "APPROVAL_ALREADY_RESOLVED"
