from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, ConfigDict
from backend.app.core.config import settings

TaskStatusType = Literal["queued", "planning", "running", "waiting_approval", "completed", "failed", "cancelled"]
TaskPriorityType = Literal["low", "normal", "high", "urgent"]
TaskStepStatusType = Literal["pending", "running", "completed", "failed", "skipped"]

class TaskCreate(BaseModel):
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

class TaskResponse(BaseModel):
    id: str
    organization_id: str = "org_default_company"
    title: str
    description: str
    status: TaskStatusType
    priority: TaskPriorityType
    assigned_agent_id: str
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
