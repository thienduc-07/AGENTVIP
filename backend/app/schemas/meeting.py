from datetime import datetime
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field, ConfigDict

MeetingStatusType = Literal[
    "DRAFT",
    "SCHEDULED",
    "INITIALIZING",
    "IN_PROGRESS",
    "PAUSED",
    "WAITING_APPROVAL",
    "COMPLETED",
    "CANCELLED",
    "FAILED",
]

ParticipantRoleType = Literal[
    "MODERATOR",
    "PRESENTER",
    "RESEARCHER",
    "ANALYST",
    "CRITIC",
    "SPECIALIST",
    "OBSERVER",
    "DECISION_MAKER",
]

ParticipantStatusType = Literal[
    "INVITED",
    "JOINED",
    "SPEAKING",
    "LISTENING",
    "THINKING",
    "FINISHED",
    "REMOVED",
    "FAILED",
]

MessageType = Literal[
    "OPENING",
    "STATEMENT",
    "QUESTION",
    "ANSWER",
    "PROPOSAL",
    "CRITICISM",
    "REBUTTAL",
    "VOTE",
    "DECISION",
    "SUMMARY",
    "SYSTEM_EVENT",
]

DecisionStatusType = Literal[
    "PROPOSED",
    "VOTING",
    "APPROVED",
    "REJECTED",
    "REQUIRES_HUMAN_APPROVAL",
    "EXECUTED",
    "CANCELLED",
]

VoteType = Literal["YES", "NO", "ABSTAIN"]


class MeetingParticipantCreate(BaseModel):
    agent_id: str = Field(..., description="ID of real AgentModel")
    role: ParticipantRoleType = Field("SPECIALIST", description="Meeting role")
    speaking_order: Optional[int] = Field(None, description="Order of speaking turn")
    metadata_json: Optional[Dict[str, Any]] = Field(default_factory=dict)


class MeetingParticipantResponse(BaseModel):
    id: str
    meeting_id: str
    agent_id: str
    agent_name: Optional[str] = None
    role: str
    participation_status: str
    joined_at: Optional[datetime] = None
    left_at: Optional[datetime] = None
    speaking_order: int
    contribution_count: int
    metadata_json: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(from_attributes=True)


class MeetingMessageCreate(BaseModel):
    agent_id: Optional[str] = None
    message_type: MessageType = "STATEMENT"
    content: str = Field(..., min_length=1, description="Statement or contribution text")
    reply_to_message_id: Optional[str] = None
    metadata_json: Optional[Dict[str, Any]] = Field(default_factory=dict)


class MeetingMessageResponse(BaseModel):
    id: str
    meeting_id: str
    participant_id: Optional[str] = None
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    message_type: str
    content: str
    sequence_number: int
    reply_to_message_id: Optional[str] = None
    created_at: datetime
    metadata_json: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(from_attributes=True)


class MeetingVoteCreate(BaseModel):
    agent_id: str = Field(..., description="ID of participant casting vote")
    vote: VoteType = Field(..., description="YES, NO, or ABSTAIN")
    reasoning: Optional[str] = Field(None, description="Logical justification for vote")


class MeetingVoteResponse(BaseModel):
    id: str
    decision_id: str
    agent_id: str
    agent_name: Optional[str] = None
    vote: str
    reasoning: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MeetingDecisionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1)
    decision_type: str = Field("STRATEGIC", description="STRATEGIC, OPERATIONAL, TECHNICAL, etc.")
    proposed_by: Optional[str] = None
    voting_policy: Optional[str] = Field("SIMPLE_MAJORITY", description="SIMPLE_MAJORITY, UNANIMOUS, CONSENSUS, etc.")
    metadata_json: Optional[Dict[str, Any]] = Field(default_factory=dict)


class MeetingDecisionResponse(BaseModel):
    id: str
    meeting_id: str
    title: str
    description: str
    decision_type: str
    status: str
    proposed_by: Optional[str] = None
    approved_by: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None
    metadata_json: Optional[Dict[str, Any]] = None
    votes: List[MeetingVoteResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class MeetingActionItemCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1)
    assigned_agent_id: str = Field(..., description="ID of assigned agent")
    decision_id: Optional[str] = None
    priority: str = Field("normal", description="low, normal, high, urgent")
    due_at: Optional[datetime] = None
    create_linked_task: bool = Field(True, description="Whether to automatically generate TaskModel")


class MeetingActionItemResponse(BaseModel):
    id: str
    meeting_id: str
    decision_id: Optional[str] = None
    title: str
    description: str
    assigned_agent_id: str
    assigned_agent_name: Optional[str] = None
    assigned_by: Optional[str] = None
    linked_task_id: Optional[str] = None
    priority: str
    status: str
    due_at: Optional[datetime] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class MeetingTranscriptResponse(BaseModel):
    id: str
    meeting_id: str
    transcript_version: int
    content: str
    summary: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MeetingCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    meeting_type: str = Field("GENERAL", description="STRATEGY_SESSION, STANDUP, DEBATE, etc.")
    objective: Optional[str] = Field(None, max_length=2000)
    moderator_agent_id: Optional[str] = None
    participant_agent_ids: List[str] = Field(default_factory=list)
    metadata_json: Optional[Dict[str, Any]] = Field(default_factory=dict)


class MeetingUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    objective: Optional[str] = None
    moderator_agent_id: Optional[str] = None
    status: Optional[MeetingStatusType] = None
    metadata_json: Optional[Dict[str, Any]] = None


class MeetingResponse(BaseModel):
    id: str
    organization_id: str
    title: str
    description: Optional[str] = None
    meeting_type: str
    status: str
    objective: Optional[str] = None
    created_by: Optional[str] = None
    moderator_agent_id: Optional[str] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    metadata_json: Optional[Dict[str, Any]] = None
    participants: List[MeetingParticipantResponse] = Field(default_factory=list)
    decisions_count: int = 0
    action_items_count: int = 0
    messages_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class MeetingSummaryResponse(BaseModel):
    meeting_id: str
    title: str
    status: str
    objective: Optional[str] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    participants_count: int
    messages_count: int
    decisions: List[MeetingDecisionResponse] = Field(default_factory=list)
    action_items: List[MeetingActionItemResponse] = Field(default_factory=list)
    summary_text: Optional[str] = None
