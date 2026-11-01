from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class StalledTaskItem(BaseModel):
    task_id: str
    title: str
    status: str
    priority: str
    assigned_agent_id: Optional[str] = None
    elapsed_seconds: float
    last_activity_at: Optional[datetime] = None


class OverdueWorkItem(BaseModel):
    task_id: str
    title: str
    status: str
    priority: str
    assigned_agent_id: Optional[str] = None
    overdue_seconds: float
    created_at: Optional[datetime] = None


class DepartmentHealthItem(BaseModel):
    department: str
    total_agents: int
    active_agents: int
    working_agents: int
    idle_agents: int
    offline_or_suspended_agents: int
    error_agents: int
    active_tasks: int
    stalled_tasks: int
    overdue_tasks: int
    health_status: str = Field(..., description="'healthy' | 'degraded' | 'critical'")


class ReassignmentRecommendationItem(BaseModel):
    task_id: str
    task_title: str
    current_agent_id: Optional[str] = None
    recommended_agent_id: str
    department: str
    reason: str
    approval_required: bool = True
    approval_id: Optional[str] = None


class HeartbeatBudgetTelemetry(BaseModel):
    tokens_used_this_run: int = 0
    cost_usd_this_run: float = 0.0
    daily_tokens_used: int = 0
    daily_cost_usd_used: float = 0.0
    max_tokens_per_run: int
    max_cost_usd_per_run: float
    daily_token_budget: int
    daily_cost_budget_usd: float


class CEOOperationalReportResponse(BaseModel):
    report_id: str
    ceo_agent_id: str
    organization_id: str
    generated_at: datetime
    interval_seconds: float
    execution_duration_ms: float
    active_tasks_count: int
    completed_tasks_count: int
    failed_tasks_count: int
    waiting_approval_tasks_count: int
    stalled_tasks: List[StalledTaskItem] = Field(default_factory=list)
    overdue_work: List[OverdueWorkItem] = Field(default_factory=list)
    department_health: List[DepartmentHealthItem] = Field(default_factory=list)
    reassignment_recommendations: List[ReassignmentRecommendationItem] = Field(default_factory=list)
    budget_telemetry: HeartbeatBudgetTelemetry
    executive_summary: str


class CEOHeartbeatStatusResponse(BaseModel):
    enabled: bool
    is_running: bool
    ceo_agent_id: str
    interval_seconds: float
    timeout_seconds: float
    total_runs_completed: int
    daily_tokens_used: int
    daily_cost_usd_used: float
    last_run_at: Optional[datetime] = None
    last_error: Optional[str] = None

