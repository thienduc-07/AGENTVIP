"""
DEPRECATED: Legacy Prototype Agent Router (/api/agents)
This module was part of the initial prototype and is NOT mounted in the corporate runtime.
The authoritative corporate agent endpoints are mounted at:
    backend/app/api/v1/endpoints/agents.py (/api/v1/agents)
Preserved strictly for backward-compatibility references. Do not register in production app routers.
"""
import warnings
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.models import AgentModel
from backend.app.schemas import AgentResponse
from backend.app.scripts.seed import CORPORATE_AGENTS

warnings.warn(
    "backend.app.routers.agents is deprecated. Use backend.app.api.v1.endpoints.agents instead.",
    DeprecationWarning,
    stacklevel=2,
)

router = APIRouter(prefix="/api/agents", tags=["Agents (Deprecated)"])

# Backward-compatibility alias pointing to corporate agents
INITIAL_AGENTS = CORPORATE_AGENTS

def seed_default_agents(db: Session):
    """
    Deprecated seeding hook. If invoked, safely ensures corporate employees exist
    without inserting obsolete One Piece identities.
    """
    from backend.app.scripts.seed import seed_database
    seed_database()


@router.get("", response_model=List[AgentResponse])
def get_all_agents(db: Session = Depends(get_db)):
    agents = db.query(AgentModel).all()
    if not agents:
        seed_default_agents(db)
        agents = db.query(AgentModel).all()
    return agents

@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(agent_id: str, db: Session = Depends(get_db)):
    agent = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent
