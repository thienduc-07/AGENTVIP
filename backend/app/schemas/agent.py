from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, ConfigDict
from backend.app.schemas.workstation import WorkstationAllocationResponse
from backend.app.schemas.task import TaskResponse
from backend.app.schemas.approval import ApprovalResponse
from backend.app.schemas.event import AgentEventResponse

AgentStatusType = Literal["idle", "working", "waiting_approval", "error", "offline"]
AgentBehavioralStateType = Literal[
    "IDLE",
    "PLANNING",
    "THINKING",
    "WORKING",
    "COMMUNICATING",
    "MOVING",
    "WAITING",
    "COMPLETED",
    "ERROR",
]

class AgentBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Unique agent display name")
    role: str = Field(..., min_length=1, max_length=500, description="Agent specialist role")
    description: Optional[str] = Field(None, max_length=2000)
    station: str = Field("captain_hq", max_length=128)
    pos_x: float = 0.0
    pos_y: float = 1.0
    pos_z: float = 0.0
    color: str = "#f59e0b"
    avatar: str = "captain"

class AgentCreate(AgentBase):
    id: Optional[str] = Field(None, description="Optional custom stable ID like 'agent-captain-roger'")

class AgentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    role: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = Field(None, max_length=2000)
    station: Optional[str] = None
    color: Optional[str] = None
    avatar: Optional[str] = None

class AgentBehavioralStateTransitionRequest(BaseModel):
    behavioral_state: str = Field(..., description="Target behavioral state")
    task_id: Optional[str] = None
    reason: Optional[str] = None

class AgentResponse(AgentBase):
    id: str
    status: AgentStatusType
    behavioral_state: str = "IDLE"
    current_task_id: Optional[str] = None
    target_pos_x: Optional[float] = None
    target_pos_y: Optional[float] = None
    target_pos_z: Optional[float] = None
    target_destination: Optional[str] = None
    active_movement_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    last_seen_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AgentInspectionResponse(BaseModel):
    agent_id: str
    name: str
    role: str
    department: str
    description: Optional[str] = None
    station: str
    avatar: str
    color: str
    status: str  # IDLE, WORKING, THINKING, WAITING_APPROVAL, PAUSED, ERROR, OFFLINE
    behavioral_state: str
    is_available: bool
    pos_x: float
    pos_y: float
    pos_z: float
    last_seen_at: Optional[datetime] = None
    created_at: datetime
    workstation: Optional[WorkstationAllocationResponse] = None
    current_task: Optional[TaskResponse] = None
    current_task_steps_count: int = 0
    current_task_duration_seconds: Optional[float] = None
    pending_approvals: List[ApprovalResponse] = Field(default_factory=list)
    recent_events: List[AgentEventResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)
