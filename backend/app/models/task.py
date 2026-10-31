import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Index, Integer, JSON
from sqlalchemy.orm import relationship
from backend.app.core.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

class TaskModel(Base):
    __tablename__ = "tasks"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    parent_task_id = Column(String(64), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, index=True)
    task_type = Column(String(32), nullable=False, default="single", index=True) # single, workflow, subtask
    agent_type = Column(String(32), nullable=True) # general, research, analyst, writer, reviewer
    
    title = Column(String(120), nullable=False, index=True)
    description = Column(Text, nullable=False)
    status = Column(String(32), nullable=False, default="queued", index=True) # queued, planning, running, waiting_approval, completed, failed, cancelled
    priority = Column(String(20), nullable=False, default="normal", index=True) # low, normal, high, urgent
    assigned_agent_id = Column(String(64), ForeignKey("agents.id", ondelete="RESTRICT"), nullable=False, index=True)
    organization_id = Column(
        String(64),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        default="org_default_company",
        index=True
    )
    
    dependencies_json = Column(JSON, nullable=True) # list of subtask IDs
    input_data_json = Column(JSON, nullable=True)
    output_data_json = Column(JSON, nullable=True)
    retry_count = Column(Integer, default=0, nullable=False)
    max_retries = Column(Integer, default=2, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    error_message = Column(Text, nullable=True)
    result_summary = Column(Text, nullable=True)

    # Relationships
    agent = relationship("AgentModel", back_populates="tasks")
    organization = relationship("backend.app.models.auth.OrganizationModel")
    steps = relationship("TaskStepModel", back_populates="task", cascade="all, delete-orphan", order_by="TaskStepModel.step_index")
    events = relationship("AgentEventModel", back_populates="task", cascade="all, delete-orphan")
    approvals = relationship("ApprovalModel", back_populates="task", cascade="all, delete-orphan")
    artifacts = relationship("ArtifactModel", back_populates="task", cascade="all, delete-orphan")

    # Self-referential subtasks hierarchy
    subtasks = relationship("TaskModel", back_populates="parent_task", cascade="all, delete-orphan", foreign_keys=[parent_task_id])
    parent_task = relationship("TaskModel", back_populates="subtasks", remote_side=[id], foreign_keys=[parent_task_id])

    __table_args__ = (
        Index("ix_tasks_agent_status", "assigned_agent_id", "status"),
        Index("ix_tasks_status_created", "status", "created_at"),
        Index("ix_tasks_parent_status", "parent_task_id", "status"),
        Index("ix_tasks_org_status", "organization_id", "status"),
    )

    def to_subtask_dict(self):
        return {
            "id": self.id,
            "parent_task_id": self.parent_task_id,
            "title": self.title,
            "description": self.description,
            "status": self.status,
            "assigned_agent_id": self.assigned_agent_id,
            "agent_type": self.agent_type,
            "dependencies": self.dependencies_json or [],
            "input_data": self.input_data_json or {},
            "output_data": self.output_data_json or {},
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error_message": self.error_message,
            "result_summary": self.result_summary,
        }

    def to_workflow_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "task_type": self.task_type,
            "status": self.status,
            "priority": self.priority,
            "assigned_agent_id": self.assigned_agent_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "result_summary": self.result_summary,
            "error_message": self.error_message,
            "output_data": self.output_data_json or {},
            "subtasks": [st.to_subtask_dict() for st in self.subtasks] if self.subtasks else [],
        }
