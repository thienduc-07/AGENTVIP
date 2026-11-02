from typing import List, Optional, Dict, Any
from pydantic import BaseModel, ConfigDict

class ExecutionResponse(BaseModel):
    id: str
    organization_id: str
    agent_id: str
    task_id: Optional[str] = None
    status: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_seconds: float = 0.0
    error_message: Optional[str] = None
    summary: Optional[str] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
    tool_calls_count: int = 0
    total_lines: int = 0
    files_count: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    model_config = ConfigDict(from_attributes=True, extra="ignore")

class ExecutionListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: List[ExecutionResponse]

class TerminalLineResponse(BaseModel):
    id: str
    execution_id: str
    organization_id: str
    agent_id: str
    task_id: Optional[str] = None
    line_number: int
    stream: str
    content: str
    metadata: Dict[str, Any] = {}
    timestamp: Optional[str] = None

    model_config = ConfigDict(from_attributes=True, extra="ignore")

class TerminalHistoryResponse(BaseModel):
    execution_id: Optional[str] = None
    total: int
    limit: int
    offset: int
    lines: List[TerminalLineResponse]

class WorkstationLiveDetailResponse(BaseModel):
    agent_id: str
    agent_name: str
    agent_role: str
    agent_status: str
    behavioral_state: str
    organization_id: str
    workstation: Optional[Dict[str, Any]] = None
    current_task: Optional[Dict[str, Any]] = None
    active_execution: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(extra="ignore")

class ExecutionEventListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: List[Dict[str, Any]]
