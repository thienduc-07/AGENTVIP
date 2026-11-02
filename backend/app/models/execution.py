import uuid
from datetime import datetime
from typing import Dict, Any, Optional
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
)
from sqlalchemy.orm import relationship
from backend.app.core.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

class ExecutionModel(Base):
    __tablename__ = "executions"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(64),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        default="org_default_company",
        index=True,
    )
    agent_id = Column(
        String(64),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    task_id = Column(
        String(64),
        ForeignKey("tasks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status = Column(String(32), nullable=False, default="running", index=True) # running, completed, failed, cancelled, paused, waiting_approval
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)

    # Token & Cost Telemetry
    prompt_tokens = Column(Integer, default=0, nullable=False)
    completion_tokens = Column(Integer, default=0, nullable=False)
    total_tokens = Column(Integer, default=0, nullable=False)
    estimated_cost_usd = Column(Float, default=0.0, nullable=False)

    # Counts
    tool_calls_count = Column(Integer, default=0, nullable=False)
    total_lines = Column(Integer, default=0, nullable=False)
    files_count = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    agent = relationship("AgentModel")
    task = relationship("TaskModel")
    terminal_lines = relationship("TerminalLineModel", back_populates="execution", cascade="all, delete-orphan", order_by="TerminalLineModel.line_number")

    __table_args__ = (
        Index("ix_executions_org_agent", "organization_id", "agent_id"),
        Index("ix_executions_agent_status", "agent_id", "status"),
        Index("ix_executions_task_status", "task_id", "status"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "organization_id": self.organization_id,
            "agent_id": self.agent_id,
            "task_id": self.task_id,
            "status": self.status,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "duration_seconds": (
                (self.completed_at - self.started_at).total_seconds()
                if self.completed_at and self.started_at
                else ((datetime.utcnow() - self.started_at).total_seconds() if self.started_at else 0.0)
            ),
            "error_message": self.error_message,
            "summary": self.summary,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "estimated_cost_usd": self.estimated_cost_usd,
            "tool_calls_count": self.tool_calls_count,
            "total_lines": self.total_lines,
            "files_count": self.files_count,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

class TerminalLineModel(Base):
    __tablename__ = "terminal_lines"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    execution_id = Column(
        String(64),
        ForeignKey("executions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(String(64), nullable=False, default="org_default_company", index=True)
    agent_id = Column(String(64), nullable=False, index=True)
    task_id = Column(String(64), nullable=True, index=True)
    line_number = Column(Integer, nullable=False)
    stream = Column(String(16), nullable=False, default="stdout", index=True) # stdout, stderr, system
    content = Column(Text, nullable=False)
    metadata_json = Column(JSON, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    execution = relationship("ExecutionModel", back_populates="terminal_lines")

    __table_args__ = (
        Index("ix_terminal_lines_exec_line", "execution_id", "line_number"),
        Index("ix_terminal_lines_agent_time", "agent_id", "timestamp"),
        Index("ix_terminal_lines_org_exec", "organization_id", "execution_id"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "execution_id": self.execution_id,
            "organization_id": self.organization_id,
            "agent_id": self.agent_id,
            "task_id": self.task_id,
            "line_number": self.line_number,
            "stream": self.stream,
            "content": self.content,
            "metadata": self.metadata_json or {},
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }
