import uuid
from datetime import datetime
from typing import Dict, Any, Optional
from sqlalchemy import (
    Column,
    String,
    Integer,
    Float,
    DateTime,
    ForeignKey,
    Index,
    Boolean,
    text,
)
from sqlalchemy.orm import relationship
from backend.app.core.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

class WorkstationAllocationModel(Base):
    __tablename__ = "workstation_allocations"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    organization_id = Column(String(64), nullable=False, default="org_default_company", index=True)
    agent_id = Column(
        String(64),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True
    )
    department = Column(String(64), nullable=False, index=True)
    logical_workstation_id = Column(String(64), nullable=False, index=True)
    office_zone = Column(String(64), nullable=False)
    desk_number = Column(Integer, nullable=True)
    pos_x = Column(Float, default=0.0)
    pos_y = Column(Float, default=1.0)
    pos_z = Column(Float, default=0.0)
    allocation_status = Column(String(32), default="ASSIGNED", nullable=False, index=True) # ASSIGNED, VIRTUAL, UNASSIGNED
    is_virtual = Column(Boolean, default=False, nullable=False)
    notes = Column(String(255), nullable=True)
    allocated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    agent = relationship("AgentModel", foreign_keys=[agent_id], back_populates="workstation_allocation")

    __table_args__ = (
        Index("ix_workstation_org_dept", "organization_id", "department"),
        Index("ix_workstation_org_logical", "organization_id", "logical_workstation_id"),
        Index(
            "uq_assigned_physical_desk",
            "organization_id",
            "department",
            "desk_number",
            unique=True,
            sqlite_where=text("allocation_status = 'ASSIGNED' AND desk_number IS NOT NULL"),
            postgresql_where=text("allocation_status = 'ASSIGNED' AND desk_number IS NOT NULL"),
        ),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "organization_id": self.organization_id,
            "agent_id": self.agent_id,
            "department": self.department,
            "logical_workstation_id": self.logical_workstation_id,
            "office_zone": self.office_zone,
            "desk_number": self.desk_number,
            "pos_x": self.pos_x,
            "pos_y": self.pos_y,
            "pos_z": self.pos_z,
            "allocation_status": self.allocation_status,
            "is_virtual": self.is_virtual,
            "notes": self.notes,
            "allocated_at": self.allocated_at.isoformat() if self.allocated_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
