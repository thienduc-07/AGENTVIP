"""
Autonomous Revenue Engine & 12-State Task Execution State Machine
Autonomous AI Corporation — PROVIPAGENT
Implements opportunity scoring, profitability ranking, specialist dispatching,
and the strict 12-state task lifecycle.
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

from .financial_ledger import RealFinancialLedger, RevenueStage

logger = logging.getLogger("agency.revenue_engine")


class TaskExecutionState(str, Enum):
    DISCOVERED = "DISCOVERED"
    QUALIFIED = "QUALIFIED"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    ACCEPTED = "ACCEPTED"
    IN_PROGRESS = "IN_PROGRESS"
    QUALITY_REVIEW = "QUALITY_REVIEW"
    DELIVERED = "DELIVERED"
    AWAITING_PAYMENT = "AWAITING_PAYMENT"
    PAYMENT_RECEIVED = "PAYMENT_RECEIVED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    DISPUTED = "DISPUTED"


class ComplianceStatus(str, Enum):
    COMPLIANT = "COMPLIANT"
    PENDING_REVIEW = "PENDING_REVIEW"
    NON_COMPLIANT = "NON_COMPLIANT"


class PlatformPolicyStatus(str, Enum):
    ALLOWED = "ALLOWED"
    RESTRICTED = "RESTRICTED"
    FORBIDDEN = "FORBIDDEN"


class BusinessOpportunity(BaseModel):
    opportunity_id: str = Field(default_factory=lambda: f"OPP-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}")
    source_platform: str  # Upwork, Fiverr, Direct_B2B, PartnerStack, Gumroad, GitHub_Bounties
    customer_or_business: str
    title: str
    description: str
    required_skills: List[str]
    estimated_revenue_usd: float
    platform_fee_rate: float = 0.10  # 10% standard freelance fee
    estimated_costs_usd: float = 5.0  # LLM tokens & compute cost
    estimated_execution_time_hours: float = 24.0
    risk_score: float = 0.15  # 0.0 (safe) to 1.0 (hazardous)
    legal_compliance_status: ComplianceStatus = ComplianceStatus.COMPLIANT
    platform_policy_status: PlatformPolicyStatus = PlatformPolicyStatus.ALLOWED
    execution_status: TaskExecutionState = TaskExecutionState.DISCOVERED
    assigned_specialist_id: Optional[str] = None
    assigned_specialist_name: Optional[str] = None
    department: str = "freelance_operations"
    expected_net_profit_usd: float = 0.0
    ranking_score: float = 0.0
    deliverable_hash: Optional[str] = None
    deliverable_artifacts: List[str] = []
    quality_review_notes: Optional[str] = None
    contract_reference: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def calculate_profitability_and_rank(self) -> float:
        """
        Net Profit = Revenue - Platform Fees - Execution Costs - Tax (7%)
        Ranking Score = (Expected Net Profit * (1 - Risk Score) * Success Prob) / (Execution Time + 1)
        """
        fees = self.estimated_revenue_usd * self.platform_fee_rate
        tax = (self.estimated_revenue_usd * 25000.0 * 0.07) / 25000.0  # Circular 40/2021/TT-BTC
        self.expected_net_profit_usd = round(self.estimated_revenue_usd - fees - self.estimated_costs_usd - tax, 2)
        if self.expected_net_profit_usd < 0:
            self.expected_net_profit_usd = 0.0

        # Success probability drops as risk score increases
        success_prob = max(0.1, 1.0 - self.risk_score)
        self.ranking_score = round(
            (self.expected_net_profit_usd * (1.0 - self.risk_score) * success_prob) / (self.estimated_execution_time_hours / 10.0 + 1.0),
            2,
        )
        return self.ranking_score


# Valid State Transitions in the 12-State FSM
VALID_TRANSITIONS: Dict[TaskExecutionState, List[TaskExecutionState]] = {
    TaskExecutionState.DISCOVERED: [TaskExecutionState.QUALIFIED, TaskExecutionState.FAILED],
    TaskExecutionState.QUALIFIED: [TaskExecutionState.AWAITING_APPROVAL, TaskExecutionState.ACCEPTED, TaskExecutionState.FAILED],
    TaskExecutionState.AWAITING_APPROVAL: [TaskExecutionState.ACCEPTED, TaskExecutionState.FAILED],
    TaskExecutionState.ACCEPTED: [TaskExecutionState.IN_PROGRESS, TaskExecutionState.FAILED],
    TaskExecutionState.IN_PROGRESS: [TaskExecutionState.QUALITY_REVIEW, TaskExecutionState.FAILED],
    TaskExecutionState.QUALITY_REVIEW: [TaskExecutionState.DELIVERED, TaskExecutionState.IN_PROGRESS, TaskExecutionState.FAILED],
    TaskExecutionState.DELIVERED: [TaskExecutionState.AWAITING_PAYMENT, TaskExecutionState.DISPUTED, TaskExecutionState.FAILED],
    TaskExecutionState.AWAITING_PAYMENT: [TaskExecutionState.PAYMENT_RECEIVED, TaskExecutionState.DISPUTED, TaskExecutionState.FAILED],
    TaskExecutionState.PAYMENT_RECEIVED: [TaskExecutionState.COMPLETED, TaskExecutionState.DISPUTED],
    TaskExecutionState.DISPUTED: [TaskExecutionState.COMPLETED, TaskExecutionState.FAILED],
    TaskExecutionState.COMPLETED: [],
    TaskExecutionState.FAILED: [],
}


class AutonomousRevenueEngine:
    """
    Centralized Revenue Engine.
    Discovers, evaluates, ranks, orchestrates execution, and records ledger entries.
    """

    def __init__(self, ledger: RealFinancialLedger):
        self.ledger = ledger
        self.opportunities: Dict[str, BusinessOpportunity] = {}
        self._init_specialist_skills()

    def _init_specialist_skills(self):
        # Key specialist mappings from the 268 specialist catalog
        self.specialist_directory = {
            "agent-eng-lead": {"name": "David Chen", "role": "Principal Systems Architect", "dept": "freelance_operations", "skills": ["python", "fastapi", "docker", "microservices", "redis", "backend"]},
            "agent-sec-lead": {"name": "Sophia Martinez", "role": "Lead Security Engineer", "dept": "freelance_operations", "skills": ["security", "audit", "rbac", "zero-trust", "jwt", "penetration"]},
            "agent-ai-researcher": {"name": "Liam Nguyen", "role": "Principal AI Researcher", "dept": "digital_products", "skills": ["ai", "llm", "rag", "langchain", "embeddings", "nlp"]},
            "agent-cloud-lead": {"name": "Marcus Vance", "role": "DevSecOps & Cloud Architect", "dept": "freelance_operations", "skills": ["aws", "kubernetes", "terraform", "ci/cd", "devops", "cloud"]},
            "agent-design-lead": {"name": "Elena Rostova", "role": "Lead UI/UX Designer", "dept": "digital_products", "skills": ["ui/ux", "figma", "tailwind", "design", "wireframes", "frontend"]},
            "agent-marketing-lead": {"name": "Chloe Bennett", "role": "Growth Marketing Lead", "dept": "affiliate_operations", "skills": ["seo", "affiliate", "content", "copywriting", "growth", "marketing"]},
            "agent-bizdev-lead": {"name": "Alexander Hayes", "role": "VP Business Development", "dept": "business_development", "skills": ["sales", "outreach", "client", "negotiation", "b2b", "proposals"]},
            "agent-fin-controller": {"name": "Victoria Sterling", "role": "Financial Controller", "dept": "finance", "skills": ["accounting", "tax", "ledger", "audit", "treasury", "reconciliation"]},
            "agent-legal-counsel": {"name": "Rachel Vance", "role": "Chief Legal Counsel", "dept": "legal_compliance", "skills": ["contracts", "tos", "vietnam_law", "compliance", "copyright", "ip"]},
        }

    def register_opportunity(self, opp: BusinessOpportunity) -> BusinessOpportunity:
        """Evaluates compliance, calculates profit, assigns specialist, and ranks opportunity."""
        # 1. Compliance filter
        if opp.legal_compliance_status == ComplianceStatus.NON_COMPLIANT or opp.platform_policy_status == PlatformPolicyStatus.FORBIDDEN:
            opp.execution_status = TaskExecutionState.FAILED
            logger.warning(f"Rejected non-compliant opportunity: {opp.title}")
            self.opportunities[opp.opportunity_id] = opp
            return opp

        # 2. Profitability and Ranking calculation
        opp.calculate_profitability_and_rank()

        # 3. Match specialist
        matched_id, matched_name, matched_dept = self._match_best_specialist(opp.required_skills)
        opp.assigned_specialist_id = matched_id
        opp.assigned_specialist_name = matched_name
        opp.department = matched_dept

        # 4. Record Potential Stage in Financial Ledger (if not already recorded)
        idempotency_key = f"{opp.source_platform}:{opp.opportunity_id}:{RevenueStage.POTENTIAL.value}"
        if idempotency_key not in self.ledger.processed_provider_refs:
            self.ledger.record_stage_entry(
                stage=RevenueStage.POTENTIAL,
                source_platform=opp.source_platform,
                external_provider_ref=opp.opportunity_id,
                gross_amount_usd=opp.estimated_revenue_usd,
                platform_fee_usd=opp.estimated_revenue_usd * opp.platform_fee_rate,
                operating_expense_usd=opp.estimated_costs_usd,
                assigned_specialist_id=matched_id,
                assigned_specialist_name=matched_name,
                department=matched_dept,
                description=f"Identified Opportunity: {opp.title} ({opp.customer_or_business})",
            )

        self.opportunities[opp.opportunity_id] = opp
        return opp

    def _match_best_specialist(self, required_skills: List[str]) -> tuple[str, str, str]:
        best_agent_id = "agent-eng-lead"
        best_score = -1
        normalized_reqs = [s.lower() for s in required_skills]

        for agent_id, data in self.specialist_directory.items():
            agent_skills = [s.lower() for s in data["skills"]]
            overlap = sum(1 for req in normalized_reqs if any(req in s or s in req for s in agent_skills))
            if overlap > best_score:
                best_score = overlap
                best_agent_id = agent_id

        info = self.specialist_directory[best_agent_id]
        return best_agent_id, info["name"], info["dept"]

    def transition_state(
        self,
        opportunity_id: str,
        target_state: TaskExecutionState,
        operator_notes: str = "",
        owner_authorization_key: Optional[str] = None,
        deliverable_artifacts: Optional[List[str]] = None,
        contract_reference: Optional[str] = None,
        provider_transaction_ref: Optional[str] = None,
        provider_evidence_hash: Optional[str] = None,
    ) -> BusinessOpportunity:
        """
        Executes a valid state transition in the 12-state FSM.
        Enforces gates:
        - AWAITING_APPROVAL -> ACCEPTED requires Level 3 Owner Authorization if revenue > $100.
        - IN_PROGRESS -> QUALITY_REVIEW -> DELIVERED requires deliverable artifacts and hash.
        - DELIVERED -> PAYMENT_RECEIVED requires real external provider verification.
        """
        opp = self.opportunities.get(opportunity_id)
        if not opp:
            raise KeyError(f"Opportunity {opportunity_id} not found.")

        current = opp.execution_status
        allowed_targets = VALID_TRANSITIONS.get(current, [])
        if target_state not in allowed_targets:
            raise ValueError(f"Illegal state transition from {current.value} to {target_state.value}. Allowed: {[s.value for s in allowed_targets]}")

        # Gate 1: Owner Authorization for High-Value Commitments (Level 3)
        if target_state == TaskExecutionState.ACCEPTED and opp.estimated_revenue_usd > 100.0:
            if not owner_authorization_key or len(owner_authorization_key) < 6:
                opp.execution_status = TaskExecutionState.AWAITING_APPROVAL
                raise PermissionError("Level 3 Owner Approval required to bind contracts over $100.00 USD.")

        # Gate 2: Deliverable Verifier check
        if target_state == TaskExecutionState.DELIVERED:
            if not deliverable_artifacts or len(deliverable_artifacts) == 0:
                raise ValueError("Cannot mark DELIVERED: Verifiable deliverable files/artifacts are mandatory.")
            # Calculate SHA-256 deliverable bundle hash
            bundle_str = ":".join(sorted(deliverable_artifacts))
            opp.deliverable_hash = hashlib.sha256(bundle_str.encode("utf-8")).hexdigest()
            opp.deliverable_artifacts = deliverable_artifacts

        # Gate 3: Payment Received requires External Provider Proof
        if target_state == TaskExecutionState.PAYMENT_RECEIVED:
            if not provider_transaction_ref or not provider_evidence_hash:
                raise ValueError("PAYMENT_RECEIVED requires external provider transaction reference and cryptographic proof hash.")

        # Record ledger updates on state transitions
        if target_state == TaskExecutionState.ACCEPTED:
            opp.contract_reference = contract_reference or f"CTR-{uuid.uuid4().hex[:8].upper()}"
            self.ledger.record_stage_entry(
                stage=RevenueStage.CONTRACTED,
                source_platform=opp.source_platform,
                external_provider_ref=opp.contract_reference,
                gross_amount_usd=opp.estimated_revenue_usd,
                platform_fee_usd=opp.estimated_revenue_usd * opp.platform_fee_rate,
                operating_expense_usd=opp.estimated_costs_usd,
                assigned_specialist_id=opp.assigned_specialist_id,
                assigned_specialist_name=opp.assigned_specialist_name,
                department=opp.department,
                description=f"Contract Signed: {opp.title}",
                owner_authorized=True,
                authorization_tier=3,
            )

        elif target_state == TaskExecutionState.DELIVERED:
            self.ledger.record_stage_entry(
                stage=RevenueStage.EARNED,
                source_platform=opp.source_platform,
                external_provider_ref=opp.contract_reference or opp.opportunity_id,
                gross_amount_usd=opp.estimated_revenue_usd,
                platform_fee_usd=opp.estimated_revenue_usd * opp.platform_fee_rate,
                operating_expense_usd=opp.estimated_costs_usd,
                evidence_reference=opp.deliverable_hash or "",
                assigned_specialist_id=opp.assigned_specialist_id,
                assigned_specialist_name=opp.assigned_specialist_name,
                department=opp.department,
                description=f"Deliverable Handed Over: {opp.title} (SHA: {opp.deliverable_hash[:12]}...)",
            )

        elif target_state == TaskExecutionState.PAYMENT_RECEIVED:
            self.ledger.record_stage_entry(
                stage=RevenueStage.RECEIVED,
                source_platform=opp.source_platform,
                external_provider_ref=provider_transaction_ref,
                gross_amount_usd=opp.estimated_revenue_usd,
                platform_fee_usd=opp.estimated_revenue_usd * opp.platform_fee_rate,
                operating_expense_usd=opp.estimated_costs_usd,
                evidence_reference=provider_evidence_hash,
                assigned_specialist_id=opp.assigned_specialist_id,
                assigned_specialist_name=opp.assigned_specialist_name,
                department=opp.department,
                description=f"Verified Customer Payment Settled: {opp.title}",
                owner_authorized=True,
                authorization_tier=3,
            )

        opp.execution_status = target_state
        opp.updated_at = datetime.now(timezone.utc).isoformat()
        return opp

    def get_ranked_opportunities(self) -> List[BusinessOpportunity]:
        """Returns opportunities sorted by ranking score descending."""
        active = [o for o in self.opportunities.values() if o.execution_status != TaskExecutionState.FAILED]
        return sorted(active, key=lambda x: x.ranking_score, reverse=True)
