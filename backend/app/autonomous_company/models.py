from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Float, Integer, JSON, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()

def utcnow():
    return datetime.now(timezone.utc)

# --- MODULE 2: LAYERED SCOPED MEMORY & GOVERNANCE AUDIT ---
class ScopedMemoryRecord(Base):
    __tablename__ = "pa_scoped_memory_records"
    id = Column(Integer, primary_key=True, autoincrement=True)
    organization_id = Column(String(64), default="provipagent-hq", index=True)
    project_id = Column(String(64), nullable=True, index=True)
    task_id = Column(String(64), nullable=True, index=True)
    agent_id = Column(String(64), nullable=False, index=True)
    memory_tier = Column(String(32), nullable=False, index=True)  # working, episodic, semantic, long_term
    scope_level = Column(String(32), nullable=False, index=True)  # agent, task, project, organization
    namespace = Column(String(128), nullable=False)
    key = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    source_type = Column(String(64), nullable=False, default="agent_inference")  # verified_fact vs agent_inference
    source_reference = Column(String(512), nullable=True)
    importance_score = Column(Float, default=0.5)
    created_at = Column(DateTime, default=utcnow)

class GovernanceAuditLog(Base):
    __tablename__ = "pa_governance_audit_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_id = Column(String(64), nullable=False, index=True)
    action_type = Column(String(128), nullable=False)
    permission_scope = Column(String(64), nullable=False)
    estimated_cost_usd = Column(Float, default=0.0)
    approval_status = Column(String(64), nullable=False)  # auto_approved, pending_owner_approval, denied
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=utcnow)

# --- MODULE 3: AUTONOMOUS BUSINESS INTELLIGENCE ---
class BusinessOpportunity(Base):
    __tablename__ = "pa_business_opportunities"
    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    target_market = Column(String(255), nullable=False)
    target_customer = Column(String(255), nullable=False)
    problem_statement = Column(Text, nullable=False)
    verified_demand_evidence = Column(JSON, nullable=False)  # Strictly verified sources
    ai_assumptions = Column(JSON, nullable=False)            # Explicitly separated AI assumptions
    competitor_analysis = Column(JSON, nullable=False)
    revenue_model = Column(String(128), nullable=False)
    estimated_startup_cost_usd = Column(Float, nullable=False)
    estimated_monthly_opex_usd = Column(Float, nullable=False)
    risks = Column(JSON, nullable=False)
    opportunity_score = Column(Float, nullable=False)        # 0-100
    confidence_level = Column(Float, nullable=False)         # 0.0-1.0
    recommended_action = Column(String(64), nullable=False)  # approve_build, research_more, reject
    owner_approved = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)

# --- MODULE 4: AUTONOMOUS PRODUCT FACTORY ---
class ManufacturedProduct(Base):
    __tablename__ = "pa_manufactured_products"
    id = Column(Integer, primary_key=True, autoincrement=True)
    opportunity_id = Column(Integer, nullable=False, index=True)
    product_name = Column(String(255), nullable=False)
    product_type = Column(String(64), nullable=False)        # saas_app, digital_template, cli_tool, educational_pack
    requirements_spec = Column(JSON, nullable=False)
    architecture_spec = Column(JSON, nullable=False)
    artifact_path = Column(String(512), nullable=False)
    automated_tests_passed = Column(Boolean, default=False)
    security_review_passed = Column(Boolean, default=False)
    usability_score = Column(Float, default=0.0)
    release_status = Column(String(64), default="draft")     # draft, qa_verified, approved_for_launch, published
    created_at = Column(DateTime, default=utcnow)

# --- MODULE 5: MARKETING, SALES & CUSTOMER SUPPORT ---
class MarketingCampaign(Base):
    __tablename__ = "pa_marketing_campaigns"
    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(Integer, nullable=False, index=True)
    campaign_name = Column(String(255), nullable=False)
    channel = Column(String(64), nullable=False)             # seo_content, opt_in_email, organic_social
    seo_keywords = Column(JSON, nullable=False)
    content_plan = Column(JSON, nullable=False)
    budget_allocated_usd = Column(Float, default=0.0)
    owner_launch_approved = Column(Boolean, default=False)
    status = Column(String(64), default="staged")
    created_at = Column(DateTime, default=utcnow)

class SalesLeadCRM(Base):
    __tablename__ = "pa_sales_leads_crm"
    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(Integer, nullable=False, index=True)
    lead_name = Column(String(255), nullable=False)
    company_or_segment = Column(String(255), nullable=False)
    qualification_score = Column(Float, default=0.0)
    pipeline_stage = Column(String(64), default="prospect")  # prospect, qualified, proposal_sent, closed_won, closed_lost
    consent_verified = Column(Boolean, default=True)
    opt_out = Column(Boolean, default=False)
    deal_value_usd = Column(Float, default=0.0)
    created_at = Column(DateTime, default=utcnow)

class SupportTicket(Base):
    __tablename__ = "pa_support_tickets"
    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(Integer, nullable=False, index=True)
    customer_identifier = Column(String(255), nullable=False)
    issue_category = Column(String(64), nullable=False)      # billing, bug, onboarding, feature_request
    severity = Column(String(32), default="medium")
    description = Column(Text, nullable=False)
    resolution_notes = Column(Text, nullable=True)
    status = Column(String(64), default="open")              # open, triaged, resolved, escalated_to_human
    csat_score = Column(Float, nullable=True)
    created_at = Column(DateTime, default=utcnow)

# --- MODULE 6: FINANCIAL SYSTEM & VERIFIABLE LEDGER ---
class FinancialLedgerEntry(Base):
    __tablename__ = "pa_financial_ledger"
    id = Column(Integer, primary_key=True, autoincrement=True)
    entry_type = Column(String(64), nullable=False, index=True)
    # entry_type values: estimated_revenue, pending_revenue, actual_received_revenue, operating_expense, agent_token_cost, refund, fee
    amount_usd = Column(Float, nullable=False)
    project_id = Column(String(64), nullable=True, index=True)
    agent_id = Column(String(64), nullable=True, index=True)
    source_verification = Column(String(128), nullable=False)  # payment_webhook, owner_budget_deposit, llm_meter, projection
    reference_id = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    owner_authorized = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)

# --- MODULE 7: SELF-EXPANDING AUTONOMOUS ORGANIZATION ---
class OrganizationalRecommendation(Base):
    __tablename__ = "pa_org_recommendations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    proposed_by_agent_id = Column(String(64), default="agent-exec-ceo")
    category = Column(String(64), nullable=False)            # skill_gap_recruitment, dept_restructure, budget_reallocation, market_expansion
    title = Column(String(255), nullable=False)
    rationale = Column(Text, nullable=False)
    recommended_specialist_slug = Column(String(128), nullable=True)
    estimated_budget_impact_usd = Column(Float, default=0.0)
    approval_status = Column(String(64), default="pending_owner_approval")
    created_at = Column(DateTime, default=utcnow)
