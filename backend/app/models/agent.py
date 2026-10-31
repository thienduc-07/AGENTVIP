import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, Float, Index
from sqlalchemy.orm import relationship
from backend.app.core.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

class AgentModel(Base):
    __tablename__ = "agents"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    name = Column(String(100), nullable=False)
    role = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(32), nullable=False, default="idle", index=True) # idle, working, waiting_approval, error, offline
    current_task_id = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    last_seen_at = Column(DateTime, nullable=True)

    # 3D Environment Placement & Appearance
    station = Column(String(64), nullable=False, default="captain_hq")
    pos_x = Column(Float, default=0.0)
    pos_y = Column(Float, default=1.0)
    pos_z = Column(Float, default=0.0)
    color = Column(String(32), default="#f59e0b")
    avatar = Column(String(32), default="captain")

    # Multi-Tenant Organization Scope
    organization_id = Column(String(64), nullable=False, default="org_default_company", index=True)

    # Relationships
    tasks = relationship("TaskModel", back_populates="agent", cascade="all, delete-orphan")
    events = relationship("AgentEventModel", back_populates="agent")
    workstation_allocation = relationship("WorkstationAllocationModel", uselist=False, back_populates="agent", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_agents_status_created", "status", "created_at"),
        Index("ix_agents_org_status", "organization_id", "status"),
    )
