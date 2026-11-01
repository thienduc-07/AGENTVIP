from typing import List, Optional, Dict, Any
from pydantic import BaseModel, ConfigDict, Field

class ActiveTaskSummary(BaseModel):
    task_id: str
    title: str
    status: str
    priority: str

class SpatialCoordinates(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0

class AgentSnapshotItem(BaseModel):
    employee_id: str
    name: str
    role: str
    department: str
    lifecycle_state: str  # ACTIVE, SUSPENDED, OFFBOARDED, PROBATION
    operational_status: str  # idle, working, waiting_approval, error, offline
    behavioral_state: str = "IDLE"  # IDLE, PLANNING, THINKING, WORKING, COMMUNICATING, MOVING, WAITING, COMPLETED, ERROR
    assigned_workstation: Optional[str] = None
    position: SpatialCoordinates = Field(default_factory=SpatialCoordinates)
    target_position: Optional[SpatialCoordinates] = None
    target_destination: Optional[str] = None
    active_movement_id: Optional[str] = None
    current_active_task: Optional[ActiveTaskSummary] = None

    model_config = ConfigDict(from_attributes=True)

class ActivitySnapshotItem(BaseModel):
    agent_id: str
    activity_type: str  # idle_standby, thinking, tool_execution, writing_artifact, waiting_approval, communicating, moving, suspended, offline
    behavioral_state: str = "IDLE"
    task_id: Optional[str] = None
    subtask_id: Optional[str] = None
    current_execution_step: Optional[str] = None
    current_tool: Optional[str] = None
    activity_started_at: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class WorkstationSnapshotItem(BaseModel):
    workstation_id: str
    zone: str
    label: str
    assigned_employee: Optional[str] = None
    occupancy_status: str  # vacant, reserved, occupied, maintenance
    spatial_coordinates: SpatialCoordinates
    orientation: float = 0.0  # degrees rotation
    capabilities: List[str] = Field(default_factory=list)
    is_virtual: bool = False

    model_config = ConfigDict(from_attributes=True)

class OrganizationSummary(BaseModel):
    total_employees: int
    active_employees: int
    busy_employees: int
    available_workstations: int
    active_tasks: int

class WorldSnapshotResponse(BaseModel):
    snapshot_id: str
    schema_version: str = "3.3.1"
    generated_at: str
    organization_id: str
    sequence_id: int
    summary: OrganizationSummary
    agents: List[AgentSnapshotItem]
    activities: List[ActivitySnapshotItem]
    workstations: List[WorkstationSnapshotItem]

    model_config = ConfigDict(from_attributes=True)
