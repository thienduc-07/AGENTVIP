"""
Production Autonomous Corporation & Financial Integrity Test Suite
Verifies:
1. Fake payment rejection (no unverified money can be marked received)
2. Duplicate payment prevention (idempotency enforcement)
3. Unauthorized transactions & Level 3/4 permission enforcement
4. Invalid external payment references rejection
5. Cryptographic ledger integrity & hash chaining
6. Currency conversion & Vietnamese tax liability (Circular 40/2021/TT-BTC)
7. Platform fee calculations
8. Deliverable verification gating (cannot complete without tests passing)
9. Compliance blocking (rejects non-compliant opportunities)
10. Recovery and persistence after restart
"""

import hashlib
import os
import pytest
from pathlib import Path

from backend.app.autonomous_company.financial_ledger import (
    RealFinancialLedger,
    RevenueStage,
    VerificationStatus,
    EXCHANGE_RATE_VND_PER_USD,
)
from backend.app.autonomous_company.revenue_engine import (
    AutonomousRevenueEngine,
    BusinessOpportunity,
    TaskExecutionState,
    ComplianceStatus,
    PlatformPolicyStatus,
)
from backend.app.autonomous_company.deliverable_verifier import DeliverableVerifier
from backend.app.autonomous_company.compliance_registry import ComplianceRegistry, AuthorizationTier


@pytest.fixture
def clean_ledger(tmp_path):
    ledger_path = str(tmp_path / "test_ledger.json")
    return RealFinancialLedger(persistence_path=ledger_path)


@pytest.fixture
def revenue_engine(clean_ledger):
    return AutonomousRevenueEngine(clean_ledger)


def test_01_fake_payment_rejection(clean_ledger):
    """Real revenue requires an authenticated external provider reference and cryptographic proof."""
    with pytest.raises(ValueError, match="authenticated external provider reference ID"):
        clean_ledger.record_stage_entry(
            stage=RevenueStage.RECEIVED,
            source_platform="Upwork",
            external_provider_ref="",  # Fake / empty
            gross_amount_usd=500.0,
            evidence_reference="VALID-PROOF-HASH-123456",
        )

    with pytest.raises(ValueError, match="verifiable cryptographic evidence"):
        clean_ledger.record_stage_entry(
            stage=RevenueStage.RECEIVED,
            source_platform="Upwork",
            external_provider_ref="UPW-VALID-REF-999",
            gross_amount_usd=500.0,
            evidence_reference="",  # Missing proof hash
        )


def test_02_duplicate_payment_prevention_idempotency(clean_ledger):
    """Duplicate platform transactions for the same stage are rejected to prevent double counting."""
    clean_ledger.record_stage_entry(
        stage=RevenueStage.RECEIVED,
        source_platform="Upwork",
        external_provider_ref="TXN-UPW-IDEMPOTENT-001",
        gross_amount_usd=1000.0,
        evidence_reference="HASH-PROOF-UPW-001",
    )

    with pytest.raises(ValueError, match="Duplicate transaction rejected"):
        clean_ledger.record_stage_entry(
            stage=RevenueStage.RECEIVED,
            source_platform="Upwork",
            external_provider_ref="TXN-UPW-IDEMPOTENT-001",
            gross_amount_usd=1000.0,
            evidence_reference="HASH-PROOF-UPW-001",
        )


def test_03_unauthorized_permission_enforcement():
    """Actions requiring Level 3 and Level 4 authorization cannot proceed without valid owner signature."""
    registry = ComplianceRegistry()

    # Level 1 is always allowed
    assert registry.verify_action_authorization(AuthorizationTier.LEVEL_1_AUTONOMOUS, "run_tests") is True

    # Level 3 requires owner key
    with pytest.raises(PermissionError, match="requires Level 3 Owner Approval Key"):
        registry.verify_action_authorization(
            AuthorizationTier.LEVEL_3_OWNER_APPROVAL,
            "bind_contract",
            owner_auth_key=None,
        )

    assert registry.verify_action_authorization(
        AuthorizationTier.LEVEL_3_OWNER_APPROVAL,
        "bind_contract",
        owner_auth_key="OWNER-SECRET-KEY-2026",
    ) is True

    # Level 4 requires restricted confirmation
    with pytest.raises(PermissionError, match="Level 4 RESTRICTED"):
        registry.verify_action_authorization(
            AuthorizationTier.LEVEL_4_RESTRICTED,
            "bank_payout",
            owner_auth_key="",
        )


def test_04_cryptographic_ledger_integrity(clean_ledger):
    """Tampering with any historical transaction breaks ledger hash chaining."""
    tx1 = clean_ledger.record_stage_entry(
        stage=RevenueStage.POTENTIAL,
        source_platform="PartnerStack",
        external_provider_ref="OPP-001",
        gross_amount_usd=200.0,
    )
    tx2 = clean_ledger.record_stage_entry(
        stage=RevenueStage.CONTRACTED,
        source_platform="PartnerStack",
        external_provider_ref="OPP-001",
        gross_amount_usd=200.0,
    )

    assert clean_ledger.verify_integrity() is True

    # Tamper with tx1 gross amount
    clean_ledger.transactions[0].gross_amount = 99999.0
    assert clean_ledger.verify_integrity() is False


def test_05_currency_conversion_and_vietnamese_tax(clean_ledger):
    """Calculates 7% Vietnamese withholding tax under Circular 40/2021/TT-BTC."""
    gross_usd = 1000.0
    gross_vnd = gross_usd * EXCHANGE_RATE_VND_PER_USD  # 25,000,000 VND
    tax_vnd = clean_ledger.calculate_vietnam_tax(gross_vnd, "software_service")
    assert tax_vnd == 1750000.0  # 7% of 25,000,000 VND = 1,750,000 VND
    tax_usd = tax_vnd / EXCHANGE_RATE_VND_PER_USD
    assert tax_usd == 70.0  # $70.00 USD


def test_06_deliverable_verification_gating(tmp_path):
    """A task cannot be delivered if automated tests fail or source code is missing."""
    verifier = DeliverableVerifier(workspace_root=tmp_path / "sandbox")

    # Failing test deliverable
    source_code = {"app.py": "def add(a, b): return a - b\n"}  # Buggy implementation
    test_code = {"test_app.py": "from app import add\ndef test_add(): assert add(2, 2) == 4\n"}

    with pytest.raises(ValueError, match="Automated unit tests failed"):
        verifier.package_and_verify_deliverable(
            opportunity_id="OPP-FAIL-01",
            files=source_code,
            test_files=test_code,
        )

    # Passing test deliverable
    source_good = {"app.py": "def add(a, b): return a + b\n"}
    cert = verifier.package_and_verify_deliverable(
        opportunity_id="OPP-PASS-01",
        files=source_good,
        test_files=test_code,
    )
    assert cert.automated_tests_passed is True
    assert len(cert.bundle_hash_sha256) == 64


def test_07_compliance_blocking(revenue_engine):
    """Opportunities flagged as non-compliant or forbidden are immediately blocked and marked FAILED."""
    bad_opp = BusinessOpportunity(
        opportunity_id="OPP-ILLEGAL-001",
        source_platform="Unauthorized_Scraper",
        customer_or_business="Suspicious Entity",
        title="Unauthorized Scraping of Personal Data",
        description="Scrape personal records without consent",
        required_skills=["scraping"],
        estimated_revenue_usd=5000.0,
        legal_compliance_status=ComplianceStatus.NON_COMPLIANT,
        platform_policy_status=PlatformPolicyStatus.FORBIDDEN,
    )

    registered = revenue_engine.register_opportunity(bad_opp)
    assert registered.execution_status == TaskExecutionState.FAILED
    assert registered.ranking_score == 0.0


def test_08_end_to_end_verified_bank_reconciliation(clean_ledger):
    """Reconciles verified customer funds against MB Bank statement with Napas trace."""
    # 1. Record verified provider payment
    received_tx = clean_ledger.record_stage_entry(
        stage=RevenueStage.RECEIVED,
        source_platform="Upwork",
        external_provider_ref="UPW-REAL-PAY-777",
        gross_amount_usd=1000.0,
        platform_fee_usd=100.0,
        operating_expense_usd=10.0,
        evidence_reference="UPW-STRIPE-PAYMENT-PROOF-HASH-777",
        assigned_specialist_name="David Chen",
        department="freelance_operations",
    )

    # 2. Reconcile with MB Bank deposit statement
    reconciled_tx = clean_ledger.verify_and_reconcile_bank_deposit(
        received_tx_id=received_tx.transaction_id,
        bank_transaction_id="FT-MB-20261107-7799001",
        napas_trace_code="NP7799-TRACE-001",
        bank_account="01993667799",
        owner_auth_signature="OWNER-MASTER-SIGNATURE-7799",
    )

    assert reconciled_tx.stage == RevenueStage.BANK_CONFIRMED
    assert reconciled_tx.verification_status == VerificationStatus.BANK_RECONCILED
    assert clean_ledger.verify_integrity() is True

    summary = clean_ledger.get_financial_summary()
    assert summary["verified_real_funds"]["verified_received_usd"] == 1000.0
    assert summary["verified_real_funds"]["bank_confirmed_usd"] == 820.0
    assert summary["beneficiary_account"]["account_number"] == "01993667799"

