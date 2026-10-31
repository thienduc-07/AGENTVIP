from __future__ import annotations
import os
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .models import Base
from .engine import AutonomousCompanyEngine

DB_URL = os.getenv("DATABASE_URL", "sqlite:///./agency.db")
connect_args = {"check_same_thread": False} if DB_URL.startswith("sqlite") else {}
engine_db = create_engine(DB_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_db)

# Ensure all Module 1-7 tables exist without resetting existing tables
Base.metadata.create_all(bind=engine_db)

router = APIRouter(prefix="/api/v1/autonomous", tags=["Autonomous AI Company (Modules 1-7)"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class CEODirectiveRequest(BaseModel):
    instruction: str = Field(
        default="Find a market with real demand, identify an opportunity, develop a digital product, launch it, acquire customers, and generate revenue with an initial budget of $100."
    )
    authorized_budget_usd: float = Field(default=100.0, gt=0)
    owner_preapprove_launch: bool = Field(default=True)

class PaymentWebhookRequest(BaseModel):
    reference_id: str
    amount_usd: float = Field(gt=0)
    customer_email: str
    payment_provider: str = "stripe_verified_webhook"

@router.get("/hq-telemetry")
def get_3d_hq_telemetry(db: Session = Depends(get_db)):
    """Module 1 & 2: Returns real-time 3D Corporate Headquarters telemetry and active workforce."""
    company = AutonomousCompanyEngine(db)
    return company.get_3d_headquarters_state()

@router.post("/ceo-directive")
def run_ceo_autonomous_directive(req: CEODirectiveRequest, db: Session = Depends(get_db)):
    """Part X: Executes the end-to-end autonomous business workflow from an Owner Instruction."""
    company = AutonomousCompanyEngine(db)
    return company.execute_ceo_directive(
        owner_instruction=req.instruction,
        authorized_budget_usd=req.authorized_budget_usd,
        owner_preapprove_launch=req.owner_preapprove_launch,
    )

@router.get("/financial-ledger")
def get_financial_report(db: Session = Depends(get_db)):
    """Module 6: Returns strict separation between Estimated, Pending, and Actual Received Revenue."""
    company = AutonomousCompanyEngine(db)
    return company.get_financial_summary()

@router.post("/financial-ledger/verified-payment")
def record_verified_customer_payment(req: PaymentWebhookRequest, db: Session = Depends(get_db)):
    """Module 6: Records real verified customer revenue into actual_received_revenue."""
    company = AutonomousCompanyEngine(db)
    entry = company.record_financial_entry(
        entry_type="actual_received_revenue",
        amount_usd=req.amount_usd,
        source_verification=req.payment_provider,
        reference_id=req.reference_id,
        description=f"Verified payment from {req.customer_email}",
        agent_id="agent-fin-controller",
    )
    return {"recorded_entry_id": entry.id, "updated_summary": company.get_financial_summary()}
