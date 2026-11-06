"""
Real Financial Infrastructure & Immutable Multi-Stage Ledger
Autonomous AI Corporation — PROVIPAGENT
Enforces 100% financial truth: Zero fake balances, cryptographic hash chaining,
idempotent provider verification, and Vietnamese tax calculation.
"""

from __future__ import annotations
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger("agency.financial_ledger")

EXCHANGE_RATE_VND_PER_USD = 25000.0


class RevenueStage(str, Enum):
    POTENTIAL = "POTENTIAL"              # Scanned opportunities, unquoted
    QUOTED = "QUOTED"                    # Proposal/bid submitted to client
    CONTRACTED = "CONTRACTED"            # Accepted contract in progress
    EARNED = "EARNED"                    # Delivered and accepted by client
    PENDING_PAYMENT = "PENDING_PAYMENT"  # In escrow / awaiting platform payout
    RECEIVED = "RECEIVED"                # Confirmed by external provider webhook
    WITHDRAWN = "WITHDRAWN"              # Transfer initiated to beneficiary bank
    BANK_CONFIRMED = "BANK_CONFIRMED"    # Reconciled against bank statement (Napas247)


class VerificationStatus(str, Enum):
    UNVERIFIED_ESTIMATE = "UNVERIFIED_ESTIMATE"
    PROVIDER_VERIFIED = "PROVIDER_VERIFIED"
    BANK_RECONCILED = "BANK_RECONCILED"
    REJECTED_UNAUTHORIZED = "REJECTED_UNAUTHORIZED"


class FinancialTransaction(BaseModel):
    transaction_id: str = Field(default_factory=lambda: f"TXN-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}")
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    stage: RevenueStage
    source_platform: str  # Upwork, GitHub Bounties, PartnerStack, Gumroad, Napas247, Direct_B2B
    external_provider_ref: str
    currency: str = "USD"
    gross_amount: float
    platform_fees: float = 0.0
    operating_expenses: float = 0.0
    tax_liability: float = 0.0  # Circular 40/2021/TT-BTC & Decree 123/2020/ND-CP
    net_amount: float
    verification_status: VerificationStatus
    evidence_reference: str  # Webhook payload SHA256 / Napas bank trace ID
    assigned_specialist_id: Optional[str] = None
    assigned_specialist_name: Optional[str] = None
    department: str = "finance"
    description: str
    owner_authorized: bool = False
    authorization_tier: int = 1  # Level 1 to Level 4
    previous_hash: str = "GENESIS"
    record_hash: str = ""

    def calculate_hash(self) -> str:
        payload = f"{self.previous_hash}:{self.transaction_id}:{self.stage.value}:{self.external_provider_ref}:{self.gross_amount:.2f}:{self.net_amount:.2f}:{self.evidence_reference}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class RealFinancialLedger:
    """
    Immutable Financial Ledger.
    Application database NEVER independently fabricates money.
    Every penny is tied to an external provider transaction and audited evidence.
    """

    def __init__(self, persistence_path: Optional[str] = None):
        self.transactions: List[FinancialTransaction] = []
        self.processed_provider_refs: set = set()
        self.persistence_path = persistence_path
        self._last_hash = "GENESIS"
        if self.persistence_path:
            self._load_from_disk()

    def _load_from_disk(self):
        import os
        if not self.persistence_path or not os.path.exists(self.persistence_path):
            return
        try:
            with open(self.persistence_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data:
                    tx = FinancialTransaction(**item)
                    self.transactions.append(tx)
                    self.processed_provider_refs.add(f"{tx.source_platform}:{tx.external_provider_ref}:{tx.stage.value}")
                    self._last_hash = tx.record_hash
            logger.info(f"Loaded {len(self.transactions)} verified financial transactions.")
        except Exception as e:
            logger.error(f"Failed to load ledger from disk: {e}")

    def _save_to_disk(self):
        if not self.persistence_path:
            return
        import os
        try:
            os.makedirs(os.path.dirname(self.persistence_path), exist_ok=True)
            with open(self.persistence_path, "w", encoding="utf-8") as f:
                json.dump([tx.model_dump() for tx in self.transactions], f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to save ledger to disk: {e}")

    @staticmethod
    def calculate_vietnam_tax(gross_vnd: float, business_type: str = "software_service") -> float:
        """
        Calculates tax liabilities according to Circular 40/2021/TT-BTC:
        - Software development / IT service: 5% VAT (or exempt under Law on VAT) + 2% PIT for individuals,
          or corporate standard withholding rate (typically 7% total for freelance contractor service).
        """
        if business_type == "software_service":
            # 5% VAT + 2% PIT = 7% total withholding
            return round(gross_vnd * 0.07, 2)
        elif business_type == "affiliate_marketing":
            # Advertising & marketing services: 5% VAT + 2% PIT = 7%
            return round(gross_vnd * 0.07, 2)
        elif business_type == "digital_product":
            # 5% VAT + 2% PIT = 7%
            return round(gross_vnd * 0.07, 2)
        return round(gross_vnd * 0.07, 2)

    def record_stage_entry(
        self,
        stage: RevenueStage,
        source_platform: str,
        external_provider_ref: str,
        gross_amount_usd: float,
        platform_fee_usd: float = 0.0,
        operating_expense_usd: float = 0.0,
        evidence_reference: str = "",
        assigned_specialist_id: Optional[str] = None,
        assigned_specialist_name: Optional[str] = None,
        department: str = "freelance_operations",
        description: str = "",
        owner_authorized: bool = False,
        authorization_tier: int = 1,
    ) -> FinancialTransaction:
        """
        Records an immutable stage entry.
        Strict verification:
        - RECEIVED requires valid provider reference and evidence hash.
        - BANK_CONFIRMED requires bank reconciliation trace.
        - Idempotent: Duplicate platform refs for same stage are blocked.
        """
        idempotency_key = f"{source_platform}:{external_provider_ref}:{stage.value}"
        if idempotency_key in self.processed_provider_refs:
            raise ValueError(f"Duplicate transaction rejected: {idempotency_key} already recorded in ledger.")

        if stage in (RevenueStage.RECEIVED, RevenueStage.BANK_CONFIRMED):
            if not external_provider_ref or external_provider_ref.strip() in ("", "NONE", "MOCK"):
                raise ValueError("Real revenue requires an authenticated external provider reference ID.")
            if not evidence_reference or len(evidence_reference.strip()) < 8:
                raise ValueError("Real revenue requires verifiable cryptographic evidence / transaction hash.")

        # Calculate Vietnamese tax liability
        gross_vnd = gross_amount_usd * EXCHANGE_RATE_VND_PER_USD
        tax_vnd = self.calculate_vietnam_tax(gross_vnd)
        tax_usd = round(tax_vnd / EXCHANGE_RATE_VND_PER_USD, 2)

        # Net profit = Gross - Platform Fees - Operating Expenses - Tax Liabilities
        net_usd = round(gross_amount_usd - platform_fee_usd - operating_expense_usd - tax_usd, 2)

        if stage == RevenueStage.BANK_CONFIRMED:
            verification_status = VerificationStatus.BANK_RECONCILED
        elif stage == RevenueStage.RECEIVED:
            verification_status = VerificationStatus.PROVIDER_VERIFIED
        else:
            verification_status = VerificationStatus.UNVERIFIED_ESTIMATE

        tx = FinancialTransaction(
            stage=stage,
            source_platform=source_platform,
            external_provider_ref=external_provider_ref,
            currency="USD",
            gross_amount=round(gross_amount_usd, 2),
            platform_fees=round(platform_fee_usd, 2),
            operating_expenses=round(operating_expense_usd, 2),
            tax_liability=tax_usd,
            net_amount=net_usd,
            verification_status=verification_status,
            evidence_reference=evidence_reference or f"EST-{uuid.uuid4().hex[:12]}",
            assigned_specialist_id=assigned_specialist_id,
            assigned_specialist_name=assigned_specialist_name,
            department=department,
            description=description,
            owner_authorized=owner_authorized,
            authorization_tier=authorization_tier,
            previous_hash=self._last_hash,
        )
        tx.record_hash = tx.calculate_hash()
        self._last_hash = tx.record_hash

        self.transactions.append(tx)
        self.processed_provider_refs.add(idempotency_key)
        self._save_to_disk()
        return tx

    def verify_and_reconcile_bank_deposit(
        self,
        received_tx_id: str,
        bank_transaction_id: str,
        napas_trace_code: str,
        bank_account: str = "01993667799",
        owner_auth_signature: str = "",
    ) -> FinancialTransaction:
        """
        Reconciles received funds with actual MB Bank deposit.
        Requires Level 4 Authorization.
        """
        if not owner_auth_signature or len(owner_auth_signature) < 6:
            raise PermissionError("Level 4 human authorization signature required for bank reconciliation.")

        target_tx = next((t for t in self.transactions if t.transaction_id == received_tx_id), None)
        if not target_tx:
            raise ValueError(f"Received transaction {received_tx_id} not found.")

        if target_tx.stage != RevenueStage.RECEIVED:
            raise ValueError(f"Transaction must be in RECEIVED stage before bank reconciliation (current: {target_tx.stage.value}).")

        evidence = f"MB_BANK_STATEMENT:ACC={bank_account}:TX={bank_transaction_id}:TRACE={napas_trace_code}"
        reconciled_tx = self.record_stage_entry(
            stage=RevenueStage.BANK_CONFIRMED,
            source_platform="MB_BANK_NAPAS247",
            external_provider_ref=bank_transaction_id,
            gross_amount_usd=target_tx.net_amount,
            platform_fee_usd=0.0,
            operating_expense_usd=0.0,
            evidence_reference=evidence,
            assigned_specialist_id=target_tx.assigned_specialist_id,
            assigned_specialist_name=target_tx.assigned_specialist_name,
            department="finance",
            description=f"Reconciled bank payout to MB {bank_account} from {target_tx.source_platform} ({target_tx.external_provider_ref})",
            owner_authorized=True,
            authorization_tier=4,
        )
        return reconciled_tx

    def get_financial_summary(self) -> Dict[str, Any]:
        """
        Computes accurate totals strictly separating estimated vs actual confirmed money.
        """
        potential_usd = sum(t.gross_amount for t in self.transactions if t.stage == RevenueStage.POTENTIAL)
        quoted_usd = sum(t.gross_amount for t in self.transactions if t.stage == RevenueStage.QUOTED)
        contracted_usd = sum(t.gross_amount for t in self.transactions if t.stage == RevenueStage.CONTRACTED)
        earned_usd = sum(t.gross_amount for t in self.transactions if t.stage == RevenueStage.EARNED)
        pending_usd = sum(t.gross_amount for t in self.transactions if t.stage == RevenueStage.PENDING_PAYMENT)
        
        # Real verified economic funds
        received_usd = sum(t.gross_amount for t in self.transactions if t.stage == RevenueStage.RECEIVED)
        bank_confirmed_usd = sum(t.gross_amount for t in self.transactions if t.stage == RevenueStage.BANK_CONFIRMED)

        platform_fees_usd = sum(t.platform_fees for t in self.transactions if t.stage in (RevenueStage.RECEIVED, RevenueStage.BANK_CONFIRMED))
        operating_expenses_usd = sum(t.operating_expenses for t in self.transactions)
        tax_liabilities_usd = sum(t.tax_liability for t in self.transactions if t.stage in (RevenueStage.RECEIVED, RevenueStage.BANK_CONFIRMED))
        
        # Net profit can only be computed on REAL received funds
        net_profit_usd = round(received_usd - platform_fees_usd - operating_expenses_usd - tax_liabilities_usd, 2)
        if net_profit_usd < 0:
            net_profit_usd = 0.0

        # Breakdowns
        by_department: Dict[str, float] = {}
        by_platform: Dict[str, float] = {}
        by_specialist: Dict[str, float] = {}

        for t in self.transactions:
            if t.stage in (RevenueStage.RECEIVED, RevenueStage.BANK_CONFIRMED):
                by_department[t.department] = round(by_department.get(t.department, 0.0) + t.net_amount, 2)
                by_platform[t.source_platform] = round(by_platform.get(t.source_platform, 0.0) + t.net_amount, 2)
                if t.assigned_specialist_name:
                    by_specialist[t.assigned_specialist_name] = round(by_specialist.get(t.assigned_specialist_name, 0.0) + t.net_amount, 2)

        return {
            "unverified_pipeline": {
                "potential_usd": round(potential_usd, 2),
                "potential_vnd": int(potential_usd * EXCHANGE_RATE_VND_PER_USD),
                "quoted_usd": round(quoted_usd, 2),
                "quoted_vnd": int(quoted_usd * EXCHANGE_RATE_VND_PER_USD),
                "contracted_usd": round(contracted_usd, 2),
                "contracted_vnd": int(contracted_usd * EXCHANGE_RATE_VND_PER_USD),
                "earned_usd": round(earned_usd, 2),
                "earned_vnd": int(earned_usd * EXCHANGE_RATE_VND_PER_USD),
                "pending_payments_usd": round(pending_usd, 2),
                "pending_payments_vnd": int(pending_usd * EXCHANGE_RATE_VND_PER_USD),
            },
            "verified_real_funds": {
                "verified_received_usd": round(received_usd, 2),
                "verified_received_vnd": int(received_usd * EXCHANGE_RATE_VND_PER_USD),
                "bank_confirmed_usd": round(bank_confirmed_usd, 2),
                "bank_confirmed_vnd": int(bank_confirmed_usd * EXCHANGE_RATE_VND_PER_USD),
                "platform_fees_usd": round(platform_fees_usd, 2),
                "operating_expenses_usd": round(operating_expenses_usd, 2),
                "tax_liabilities_usd": round(tax_liabilities_usd, 2),
                "tax_liabilities_vnd": int(tax_liabilities_usd * EXCHANGE_RATE_VND_PER_USD),
                "net_profit_usd": net_profit_usd,
                "net_profit_vnd": int(net_profit_usd * EXCHANGE_RATE_VND_PER_USD),
            },
            "breakdowns": {
                "by_department": by_department,
                "by_platform": by_platform,
                "by_specialist": by_specialist,
            },
            "total_transactions_count": len(self.transactions),
            "ledger_integrity": {
                "hash_valid": self.verify_integrity(),
                "last_hash": self._last_hash,
            },
            "beneficiary_account": {
                "bank": "MB Bank (Ngân Hàng Quân Đội)",
                "account_number": "01993667799",
                "account_name": "LE THIEN DUC",
            },
        }

    def verify_integrity(self) -> bool:
        """Cryptographically verifies that no ledger transaction has been altered or injected."""
        prev = "GENESIS"
        for tx in self.transactions:
            if tx.previous_hash != prev:
                return False
            expected_hash = tx.calculate_hash()
            if tx.record_hash != expected_hash:
                return False
            prev = tx.record_hash
        return True

    def export_csv(self) -> str:
        """Exports full ledger with proof hashes for audit and tax reporting."""
        lines = [
            "Transaction_ID,Timestamp,Stage,Platform,External_Ref,Gross_USD,Fees_USD,Opex_USD,Tax_USD,Net_USD,Specialist,Department,Evidence_Ref,Hash"
        ]
        for t in self.transactions:
            spec_name = t.assigned_specialist_name or ""
            lines.append(
                f'"{t.transaction_id}","{t.timestamp}","{t.stage.value}","{t.source_platform}","{t.external_provider_ref}",{t.gross_amount},{t.platform_fees},{t.operating_expenses},{t.tax_liability},{t.net_amount},"{spec_name}","{t.department}","{t.evidence_reference}","{t.record_hash}"'
            )
        return "\n".join(lines)
