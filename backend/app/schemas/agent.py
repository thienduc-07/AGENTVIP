from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, ConfigDict

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
    name: str = Field(..., min_length=1, max_length=100, description="Unique agent display name")
    role: str = Field(..., min_length=1, max_length=100, description="Agent specialist role")
    description: Optional[str] = Field(None, max_length=1000)
    station: str = Field("captain_hq", max_length=64)
    pos_x: float = 0.0
    pos_y: float = 1.0
    pos_z: float = 0.0
    color: str = "#f59e0b"
    avatar: str = "captain"

class AgentCreate(AgentBase):
    id: Optional[str] = Field(None, description="Optional custom stable ID like 'agent-captain-roger'")

class AgentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    role: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
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
