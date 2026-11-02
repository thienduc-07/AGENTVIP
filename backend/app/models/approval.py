import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from backend.app.core.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

class ApprovalModel(Base):
    __tablename__ = "approvals"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    task_id = Column(String(64), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    action_type = Column(String(64), nullable=False)
    description = Column(Text, nullable=False)
    status = Column(String(32), nullable=False, default="pending", index=True) # pending, approved, rejected, expired
    requested_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by_user_id = Column(String(64), nullable=True)
    decision_reason = Column(Text, nullable=True)

    task = relationship("TaskModel", back_populates="approvals")

    __table_args__ = (
        Index("ix_approvals_task_status", "task_id", "status"),
    )
