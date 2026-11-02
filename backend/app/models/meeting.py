import uuid
from datetime import datetime
from typing import Dict, Any, Optional, List
from sqlalchemy import (
    Column,
    String,
    Integer,
    Float,
    DateTime,
    ForeignKey,
    Index,
    Boolean,
    Text,
    JSON,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from backend.app.core.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class MeetingModel(Base):
    __tablename__ = "meetings"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(64),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    meeting_type = Column(String(64), nullable=False, default="GENERAL", index=True)
    status = Column(String(32), nullable=False, default="DRAFT", index=True)
    objective = Column(Text, nullable=True)
    created_by = Column(String(64), nullable=True)
    moderator_agent_id = Column(
        String(64),
        ForeignKey("agents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    metadata_json = Column(JSON, nullable=True)

    # Relationships
    moderator = relationship("AgentModel", foreign_keys=[moderator_agent_id])
    participants = relationship(
        "MeetingParticipantModel",
        back_populates="meeting",
        cascade="all, delete-orphan",
        order_by="MeetingParticipantModel.speaking_order",
    )
    messages = relationship(
        "MeetingMessageModel",
        back_populates="meeting",
        cascade="all, delete-orphan",
        order_by="MeetingMessageModel.sequence_number",
    )
    decisions = relationship(
        "MeetingDecisionModel",
        back_populates="meeting",
        cascade="all, delete-orphan",
        order_by="MeetingDecisionModel.created_at",
    )
    action_items = relationship(
        "MeetingActionItemModel",
        back_populates="meeting",
        cascade="all, delete-orphan",
        order_by="MeetingActionItemModel.created_at",
    )
    transcripts = relationship(
        "MeetingTranscriptModel",
        back_populates="meeting",
        cascade="all, delete-orphan",
        order_by="MeetingTranscriptModel.transcript_version.desc()",
    )

    __table_args__ = (
        Index("ix_meetings_org_status", "organization_id", "status"),
        Index("ix_meetings_org_created", "organization_id", "created_at"),
    )

    @property
    def decisions_count(self) -> int:
        return len(self.decisions) if self.decisions is not None else 0

    @property
    def action_items_count(self) -> int:
        return len(self.action_items) if self.action_items is not None else 0

    @property
    def messages_count(self) -> int:
        return len(self.messages) if self.messages is not None else 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "organization_id": self.organization_id,
            "title": self.title,
            "description": self.description,
            "meeting_type": self.meeting_type,
            "status": self.status,
            "objective": self.objective,
            "created_by": self.created_by,
            "moderator_agent_id": self.moderator_agent_id,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "metadata_json": self.metadata_json or {},
        }


class MeetingParticipantModel(Base):
    __tablename__ = "meeting_participants"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    meeting_id = Column(
        String(64),
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id = Column(
        String(64),
        ForeignKey("agents.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    role = Column(String(32), nullable=False, default="SPECIALIST")
    participation_status = Column(String(32), nullable=False, default="INVITED", index=True)
    joined_at = Column(DateTime, nullable=True)
    left_at = Column(DateTime, nullable=True)
    speaking_order = Column(Integer, nullable=False, default=0)
    contribution_count = Column(Integer, nullable=False, default=0)
    metadata_json = Column(JSON, nullable=True)

    # Relationships
    meeting = relationship("MeetingModel", back_populates="participants")
    agent = relationship("AgentModel", foreign_keys=[agent_id])
    messages = relationship(
        "MeetingMessageModel",
        back_populates="participant",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("meeting_id", "agent_id", name="uq_meeting_participant"),
        Index("ix_meeting_participants_status", "meeting_id", "participation_status"),
    )

    @property
    def agent_name(self) -> Optional[str]:
        return self.agent.name if self.agent else None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "meeting_id": self.meeting_id,
            "agent_id": self.agent_id,
            "agent_name": self.agent.name if self.agent else None,
            "role": self.role,
            "participation_status": self.participation_status,
            "joined_at": self.joined_at.isoformat() if self.joined_at else None,
            "left_at": self.left_at.isoformat() if self.left_at else None,
            "speaking_order": self.speaking_order,
            "contribution_count": self.contribution_count,
            "metadata_json": self.metadata_json or {},
        }


class MeetingMessageModel(Base):
    __tablename__ = "meeting_messages"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    meeting_id = Column(
        String(64),
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    participant_id = Column(
        String(64),
        ForeignKey("meeting_participants.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    agent_id = Column(
        String(64),
        ForeignKey("agents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    message_type = Column(String(32), nullable=False, default="STATEMENT", index=True)
    content = Column(Text, nullable=False)
    sequence_number = Column(Integer, nullable=False, index=True)
    reply_to_message_id = Column(
        String(64),
        ForeignKey("meeting_messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    metadata_json = Column(JSON, nullable=True)

    # Relationships
    meeting = relationship("MeetingModel", back_populates="messages")
    participant = relationship("MeetingParticipantModel", back_populates="messages")
    agent = relationship("AgentModel", foreign_keys=[agent_id])
    reply_to = relationship("MeetingMessageModel", remote_side=[id])

    __table_args__ = (
        UniqueConstraint("meeting_id", "sequence_number", name="uq_meeting_seq_num"),
        Index("ix_meeting_messages_created", "meeting_id", "created_at"),
    )

    @property
    def agent_name(self) -> Optional[str]:
        return self.agent.name if self.agent else None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "meeting_id": self.meeting_id,
            "participant_id": self.participant_id,
            "agent_id": self.agent_id,
            "agent_name": self.agent.name if self.agent else None,
            "message_type": self.message_type,
            "content": self.content,
            "sequence_number": self.sequence_number,
            "reply_to_message_id": self.reply_to_message_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "metadata_json": self.metadata_json or {},
        }


class MeetingDecisionModel(Base):
    __tablename__ = "meeting_decisions"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    meeting_id = Column(
        String(64),
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    decision_type = Column(String(64), nullable=False, default="STRATEGIC", index=True)
    status = Column(String(32), nullable=False, default="PROPOSED", index=True)
    proposed_by = Column(
        String(64),
        ForeignKey("agents.id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_by = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    resolved_at = Column(DateTime, nullable=True)
    metadata_json = Column(JSON, nullable=True)

    # Relationships
    meeting = relationship("MeetingModel", back_populates="decisions")
    proposer = relationship("AgentModel", foreign_keys=[proposed_by])
    votes = relationship(
        "MeetingVoteModel",
        back_populates="decision",
        cascade="all, delete-orphan",
    )
    action_items = relationship(
        "MeetingActionItemModel",
        back_populates="decision",
    )

    __table_args__ = (
        Index("ix_meeting_decisions_meeting_status", "meeting_id", "status"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "meeting_id": self.meeting_id,
            "title": self.title,
            "description": self.description,
            "decision_type": self.decision_type,
            "status": self.status,
            "proposed_by": self.proposed_by,
            "approved_by": self.approved_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "metadata_json": self.metadata_json or {},
            "votes_count": len(self.votes) if self.votes else 0,
        }


class MeetingVoteModel(Base):
    __tablename__ = "meeting_votes"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    decision_id = Column(
        String(64),
        ForeignKey("meeting_decisions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id = Column(
        String(64),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    vote = Column(String(32), nullable=False) # YES, NO, ABSTAIN
    reasoning = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    decision = relationship("MeetingDecisionModel", back_populates="votes")
    agent = relationship("AgentModel", foreign_keys=[agent_id])

    __table_args__ = (
        UniqueConstraint("decision_id", "agent_id", name="uq_decision_agent_vote"),
    )

    @property
    def agent_name(self) -> Optional[str]:
        return self.agent.name if self.agent else None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "decision_id": self.decision_id,
            "agent_id": self.agent_id,
            "agent_name": self.agent.name if self.agent else None,
            "vote": self.vote,
            "reasoning": self.reasoning,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class MeetingActionItemModel(Base):
    __tablename__ = "meeting_action_items"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    meeting_id = Column(
        String(64),
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    decision_id = Column(
        String(64),
        ForeignKey("meeting_decisions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    assigned_agent_id = Column(
        String(64),
        ForeignKey("agents.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    assigned_by = Column(String(64), nullable=True)
    linked_task_id = Column(
        String(64),
        ForeignKey("tasks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    priority = Column(String(20), nullable=False, default="normal")
    status = Column(String(32), nullable=False, default="PENDING", index=True)
    due_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    completed_at = Column(DateTime, nullable=True)

    # Relationships
    meeting = relationship("MeetingModel", back_populates="action_items")
    decision = relationship("MeetingDecisionModel", back_populates="action_items")
    assigned_agent = relationship("AgentModel", foreign_keys=[assigned_agent_id])
    task = relationship("TaskModel", foreign_keys=[linked_task_id])

    __table_args__ = (
        Index("ix_meeting_actions_agent", "assigned_agent_id", "status"),
        Index("ix_meeting_actions_meeting", "meeting_id", "status"),
    )

    @property
    def assigned_agent_name(self) -> Optional[str]:
        return self.assigned_agent.name if self.assigned_agent else None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "meeting_id": self.meeting_id,
            "decision_id": self.decision_id,
            "title": self.title,
            "description": self.description,
            "assigned_agent_id": self.assigned_agent_id,
            "assigned_agent_name": self.assigned_agent.name if self.assigned_agent else None,
            "assigned_by": self.assigned_by,
            "linked_task_id": self.linked_task_id,
            "priority": self.priority,
            "status": self.status,
            "due_at": self.due_at.isoformat() if self.due_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class MeetingTranscriptModel(Base):
    __tablename__ = "meeting_transcripts"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    meeting_id = Column(
        String(64),
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    transcript_version = Column(Integer, nullable=False, default=1)
    content = Column(Text, nullable=False)
    summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    meeting = relationship("MeetingModel", back_populates="transcripts")

    __table_args__ = (
        UniqueConstraint("meeting_id", "transcript_version", name="uq_meeting_transcript_ver"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "meeting_id": self.meeting_id,
            "transcript_version": self.transcript_version,
            "content": self.content,
            "summary": self.summary,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
