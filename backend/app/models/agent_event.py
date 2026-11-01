import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, JSON, Index
from sqlalchemy.orm import relationship
from backend.app.core.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

class AgentEventModel(Base):
    __tablename__ = "agent_events"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    sequence_id = Column(Integer, nullable=True)
    event_type = Column(String(64), nullable=False, index=True)
    agent_id = Column(String(64), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True, index=True)
    task_id = Column(String(64), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    organization_id = Column(
        String(64),
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=True,
        index=True
    )
    payload_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    agent = relationship("AgentModel", back_populates="events")
    task = relationship("TaskModel", back_populates="events")

    __table_args__ = (
        Index("ix_agent_events_type_created", "event_type", "created_at"),
        Index("ix_agent_events_task_created", "task_id", "created_at"),
        Index("ix_agent_events_sequence_id", "sequence_id"),
        Index("ix_agent_events_org_seq", "organization_id", "sequence_id"),
    )

    def to_envelope(self) -> dict:
        """Converts to standardized Event Envelope conforming to Milestone 5 specifications."""
        iso_str = self.created_at.isoformat()
        if not iso_str.endswith("Z") and "+" not in iso_str:
            iso_str += "Z"

        payload_dict = self.payload_json or {}

        return {
            "schema_version": 1,
            "event_id": self.id,
            "event_type": self.event_type,
            "occurred_at": iso_str,
            "sequence_id": self.sequence_id,
            "agent_id": self.agent_id,
            "task_id": self.task_id,
            "organization_id": self.organization_id,
            "payload": payload_dict,
        }
