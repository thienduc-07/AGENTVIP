from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, ConfigDict
from backend.app.core.config import settings

TaskStatusType = Literal[
    "created",
    "planning",
    "ready",
    "assigned",
    "queued",
    "running",
    "in_progress",
    "waiting",
    "waiting_approval",
    "review",
    "paused",
    "completed",
    "failed",
    "cancelled",
]
TaskPriorityType = Literal["low", "normal", "high", "urgent"]
TaskStepStatusType = Literal["pending", "running", "completed", "failed", "skipped"]

class TaskCreate(BaseModel):
    id: Optional[str] = Field(None, max_length=64, description="Optional client-generated task UUID for idempotent submission")
    idempotency_key: Optional[str] = Field(None, max_length=64, description="Optional idempotency key")
    title: str = Field(..., min_length=1, max_length=settings.MAX_TASK_TITLE_LENGTH, description="Short descriptive task title")
    description: str = Field(..., min_length=1, max_length=settings.MAX_TASK_DESC_LENGTH, description="Full mission instructions")
    assigned_agent_id: str = Field(..., min_length=1, description="ID of the assigned agent")
    priority: TaskPriorityType = Field("normal", description="Task priority: low, normal, high, urgent")
    organization_id: Optional[str] = Field(None, description="Optional organization ID (server enforces tenant identity)")


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=settings.MAX_TASK_TITLE_LENGTH)
    description: Optional[str] = Field(None, min_length=1, max_length=settings.MAX_TASK_DESC_LENGTH)
    priority: Optional[TaskPriorityType] = None

class TaskStepResponse(BaseModel):
    id: str
    task_id: str
    step_index: int
    title: str
    description: Optional[str] = None
    status: TaskStepStatusType
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class DeliverableResponse(BaseModel):
    deliverable_id: str
    task_id: str
    parent_task_id: Optional[str] = None
    agent_id: str
    organization_id: str
    execution_id: str
    objective: str
    actions_performed: List[str] = []
    tools_invoked: List[dict] = []
    evidence_references: List[str] = []
    result_summary: str
    artifact_paths: List[str] = []
    verification_status: str
    verification_notes: Optional[str] = None
    completion_timestamp: str

    model_config = ConfigDict(extra="ignore")

class TaskResponse(BaseModel):
    id: str
    idempotency_key: Optional[str] = None
    lease_token: Optional[str] = None
    organization_id: str = "org_default_company"
    parent_task_id: Optional[str] = None
    title: str
    description: str
    status: TaskStatusType
    priority: TaskPriorityType
    assigned_agent_id: str
    agent_type: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 2
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    updated_at: datetime
    error_message: Optional[str] = None
    result_summary: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class TaskDetailResponse(TaskResponse):
    steps: List[TaskStepResponse] = []

    model_config = ConfigDict(from_attributes=True)

class TaskCancelResponse(BaseModel):
    id: str
    status: str
    message: str

class TaskPauseRequest(BaseModel):
    reason: Optional[str] = Field("Human operator paused execution", description="Reason for pausing the task")

class TaskPauseResponse(BaseModel):
    id: str
    status: str = "paused"
    is_paused: bool = True
    paused_at: datetime
    message: str = "Task successfully paused"

class TaskResumeRequest(BaseModel):
    guidance: Optional[str] = Field(None, description="Optional guidance or updated instructions from operator")
    idempotency_key: Optional[str] = Field(None, description="Optional idempotency key for resume action")

class TaskResumeResponse(BaseModel):
    id: str
    status: str = "queued"
    is_paused: bool = False
    resumed_at: datetime
    message: str = "Task successfully resumed"
