import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from backend.app.core.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

class ConversationModel(Base):
    __tablename__ = "conversations"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    title = Column(String(255), nullable=False, default="Cuộc trò chuyện mới")
    organization_id = Column(String(64), nullable=False, default="org_default_company", index=True)
    agent_id = Column(String(64), nullable=True, index=True)
    mode = Column(String(32), nullable=False, default="conversation", index=True) # "conversation" or "task"
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    messages = relationship("ConversationMessageModel", back_populates="conversation", cascade="all, delete-orphan", order_by="ConversationMessageModel.created_at")

class ConversationMessageModel(Base):
    __tablename__ = "conversation_messages"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    conversation_id = Column(String(64), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_type = Column(String(32), nullable=False, default="user") # "user", "agent", "system"
    sender_id = Column(String(64), nullable=True) # user_id or agent_id
    sender_name = Column(String(100), nullable=True)
    role = Column(String(32), nullable=False, default="user") # "user", "assistant", "system"
    content = Column(Text, nullable=False)
    thought = Column(Text, nullable=True)
    task_id = Column(String(64), nullable=True, index=True)
    routing_metadata = Column(Text, nullable=True) # JSON string with routing details
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    conversation = relationship("ConversationModel", back_populates="messages")

    __table_args__ = (
        Index("ix_conv_msg_created", "conversation_id", "created_at"),
    )

