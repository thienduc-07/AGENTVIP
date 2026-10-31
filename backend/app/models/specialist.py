import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional
from sqlalchemy import (
    Column,
    String,
    Text,
    Integer,
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

class SpecialistDefinitionModel(Base):
    __tablename__ = "specialist_definitions"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    slug = Column(String(128), unique=True, nullable=False, index=True)
    name = Column(String(128), nullable=False, index=True)
    division = Column(String(64), nullable=False, index=True)
    department = Column(String(64), nullable=False, index=True)
    role = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    # UI presentation metadata
    color = Column(String(32), default="blue")
    emoji = Column(String(16), default="🤖")
    vibe = Column(Text, nullable=True)

    # Normalized prompt and instructions
    system_instructions = Column(Text, nullable=False)
    identity_and_memory = Column(Text, nullable=True)
    core_mission = Column(Text, nullable=True)
    critical_rules = Column(Text, nullable=True)
    workflows = Column(Text, nullable=True)
    deliverables = Column(Text, nullable=True)
    success_metrics = Column(Text, nullable=True)

    # Structured capabilities, skills, and tools
    capabilities = Column(JSON, default=list)
    skills = Column(JSON, default=list)
    declared_tools = Column(JSON, default=list)
    assigned_tools = Column(JSON, default=list)
    permission_level = Column(Integer, default=0, nullable=False) # 0: READ_ONLY, 1: WORKSPACE_WRITE

    # Source provenance
    source_repo = Column(String(255), default="https://github.com/msitarzewski/agency-agents", nullable=False)
    source_path = Column(String(255), nullable=False)
    source_commit_sha = Column(String(64), nullable=True)
    content_hash = Column(String(64), nullable=False, index=True)
    raw_content = Column(Text, nullable=False)
    raw_frontmatter = Column(JSON, nullable=True)

    # Validation and lifecycle
    validation_status = Column(String(32), default="VALID", nullable=False, index=True) # VALID, INVALID, WARNING
    validation_errors = Column(JSON, default=list)
    lifecycle_state = Column(String(32), default="AVAILABLE", nullable=False, index=True)
    # DISCOVERED, IMPORTED, VALIDATED, AVAILABLE, RECRUITED, CONFIGURED, ACTIVE, SUSPENDED, RETIRED, INVALID, FAILED

    version = Column(Integer, default=1, nullable=False)
    imported_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Version history
    versions = relationship("SpecialistVersionModel", back_populates="specialist", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_specialist_dept_div", "department", "division"),
        Index("ix_specialist_lifecycle_valid", "lifecycle_state", "validation_status"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "slug": self.slug,
            "name": self.name,
            "division": self.division,
            "department": self.department,
            "role": self.role,
            "description": self.description,
            "color": self.color,
            "emoji": self.emoji,
            "vibe": self.vibe,
            "capabilities": self.capabilities or [],
            "skills": self.skills or [],
            "declared_tools": self.declared_tools or [],
            "assigned_tools": self.assigned_tools or [],
            "permission_level": self.permission_level,
            "source_repo": self.source_repo,
            "source_path": self.source_path,
            "source_commit_sha": self.source_commit_sha,
            "validation_status": self.validation_status,
            "validation_errors": self.validation_errors or [],
            "lifecycle_state": self.lifecycle_state,
            "version": self.version,
            "imported_at": self.imported_at.isoformat() if self.imported_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

class SpecialistVersionModel(Base):
    __tablename__ = "specialist_versions"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    specialist_id = Column(String(64), ForeignKey("specialist_definitions.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    source_commit_sha = Column(String(64), nullable=True)
    content_hash = Column(String(64), nullable=False)
    raw_content = Column(Text, nullable=False)
    change_summary = Column(Text, nullable=True)
    parsed_metadata = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    specialist = relationship("SpecialistDefinitionModel", back_populates="versions")

    __table_args__ = (
        Index("ix_spec_version_lookup", "specialist_id", "version"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "specialist_id": self.specialist_id,
            "version": self.version,
            "source_commit_sha": self.source_commit_sha,
            "content_hash": self.content_hash,
            "change_summary": self.change_summary,
            "parsed_metadata": self.parsed_metadata,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
