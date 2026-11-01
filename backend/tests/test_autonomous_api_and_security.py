from __future__ import annotations
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)


def test_hq_telemetry_endpoint():
    res = client.get("/api/v1/autonomous/hq-telemetry")
    assert res.status_code == 200
    data = res.json()
    assert data["executives_count"] == 8
    assert "financial_snapshot" in data
    agent_ids = {a["agent_id"] for a in data["agents"]}
    assert "agent-exec-ceo" in agent_ids
    assert "agent-fin-controller" in agent_ids


def test_ceo_directive_and_verified_payment_flow():
    # 1. Trigger CEO Directive
    payload = {
        "instruction": "Identify high-demand developer tool opportunity, build MVP, and launch.",
        "authorized_budget_usd": 100.0,
        "owner_preapprove_launch": True,
    }
    res = client.post("/api/v1/autonomous/ceo-directive", json=payload)
    assert res.status_code == 200
    body = res.json()

    assert body["ceo_agent"] == "Victoria Vance (agent-exec-ceo)"
    assert body["product"]["automated_tests_passed"] is True
    assert body["product"]["release_status"] == "qa_verified"

    # 2. Verify Financial Ledger Endpoint
    fin_res = client.get("/api/v1/autonomous/financial-ledger")
    assert fin_res.status_code == 200
    fin = fin_res.json()
    assert fin["owner_budget_deposits_usd"] >= 100.0
    assert fin["estimated_revenue_usd"] >= 490.0

    # 3. Record a real verified customer payment via webhook endpoint
    pay_res = client.post(
        "/api/v1/autonomous/financial-ledger/verified-payment",
        json={
            "reference_id": "STRIPE-TX-998877",
            "amount_usd": 49.0,
            "customer_email": "buyer@startup.io",
            "payment_provider": "stripe_verified_webhook",
        },
    )
    assert pay_res.status_code == 200
    updated = pay_res.json()["updated_summary"]
    assert updated["actual_received_revenue_usd"] >= 49.0
    assert updated["realized_profit_usd"] > 0
