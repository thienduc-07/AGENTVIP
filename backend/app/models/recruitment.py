import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional
from sqlalchemy import (
    Column,
    String,
    Text,
    Integer,
    Float,
    DateTime,
    ForeignKey,
    Index,
    JSON,
    Boolean,
)
from sqlalchemy.orm import relationship
from backend.app.core.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

class RecruitmentRecordModel(Base):
    __tablename__ = "recruitment_records"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    specialist_definition_id = Column(
        String(64),
        ForeignKey("specialist_definitions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    specialist_version_id = Column(
        String(64),
        ForeignKey("specialist_versions.id", ondelete="RESTRICT"),
        nullable=True,
        index=True
    )
    specialist_version_num = Column(Integer, nullable=False, default=1)
    agent_id = Column(
        String(64),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True
    )

    # Department & Reporting Hierarchy
    department = Column(String(64), nullable=False, index=True)
    manager_agent_id = Column(String(64), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True, index=True)
    recruited_by = Column(String(64), nullable=False, default="agent-exec-ceo")

    # Lifecycle State
    # DISCOVERED, IMPORTED, VALIDATED, AVAILABLE, RECRUITED, CONFIGURED, ACTIVE, SUSPENDED, RETIRED, INVALID, FAILED
    lifecycle_state = Column(String(32), default="ACTIVE", nullable=False, index=True)

    # Governance, Security & Budgets
    permission_profile = Column(String(64), default="standard_specialist", nullable=False)
    budget_limit_usd = Column(Float, default=50.0, nullable=False)
    budget_spent_usd = Column(Float, default=0.0, nullable=False)
    max_daily_tasks = Column(Integer, default=100, nullable=False)
    model_preference = Column(String(64), default="auto", nullable=False)
    memory_policy = Column(JSON, default=lambda: {"retention_days": 30, "scope": "department"})

    # Multi-Tenant Organization Scope
    organization_id = Column(String(64), nullable=False, default="org_default_company", index=True)

    # Legacy Version Visibility & Integrity
    is_legacy_unpinned = Column(Boolean, default=False, nullable=False)

    notes = Column(Text, nullable=True)
    recruited_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    specialist_definition = relationship("SpecialistDefinitionModel")
    specialist_version = relationship("SpecialistVersionModel", foreign_keys=[specialist_version_id])
    agent = relationship("AgentModel", foreign_keys=[agent_id])
    manager = relationship("AgentModel", foreign_keys=[manager_agent_id])

    __table_args__ = (
        Index("ix_recruitment_dept_state", "department", "lifecycle_state"),
        Index("ix_recruitment_manager", "manager_agent_id"),
        Index("ix_recruitment_org_spec", "organization_id", "specialist_definition_id"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "organization_id": self.organization_id,
            "specialist_definition_id": self.specialist_definition_id,
            "specialist_version_id": self.specialist_version_id,
            "specialist_version_num": self.specialist_version_num,
            "agent_id": self.agent_id,
            "department": self.department,
            "manager_agent_id": self.manager_agent_id,
            "recruited_by": self.recruited_by,
            "lifecycle_state": self.lifecycle_state,
            "permission_profile": self.permission_profile,
            "budget_limit_usd": self.budget_limit_usd,
            "budget_spent_usd": self.budget_spent_usd,
            "max_daily_tasks": self.max_daily_tasks,
            "model_preference": self.model_preference,
            "memory_policy": self.memory_policy or {},
            "is_legacy_unpinned": self.is_legacy_unpinned,
            "notes": self.notes,
            "recruited_at": self.recruited_at.isoformat() if self.recruited_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

class AgentPerformanceModel(Base):
    __tablename__ = "agent_performance"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    agent_id = Column(
        String(64),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True
    )

    tasks_completed = Column(Integer, default=0, nullable=False)
    tasks_failed = Column(Integer, default=0, nullable=False)
    avg_duration_ms = Column(Float, default=0.0, nullable=False)
    avg_quality_score = Column(Float, default=100.0, nullable=False)
    total_tokens_used = Column(Integer, default=0, nullable=False)
    total_cost_usd = Column(Float, default=0.0, nullable=False)
    last_active_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    agent = relationship("AgentModel", foreign_keys=[agent_id])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "tasks_completed": self.tasks_completed,
            "tasks_failed": self.tasks_failed,
            "avg_duration_ms": self.avg_duration_ms,
            "avg_quality_score": self.avg_quality_score,
            "total_tokens_used": self.total_tokens_used,
            "total_cost_usd": self.total_cost_usd,
            "last_active_at": self.last_active_at.isoformat() if self.last_active_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
