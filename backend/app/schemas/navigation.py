from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class TopologyNodeSchema(BaseModel):
    node_id: str
    label: str
    node_type: str = Field(..., description="'zone' | 'corridor' | 'workstation'")
    department: Optional[str] = None
    x: float
    y: float
    z: float
    neighbors: List[str] = Field(default_factory=list)


class OfficeTopologyResponse(BaseModel):
    nodes: List[TopologyNodeSchema]
    edges: List[Dict[str, Any]]
    workstation_destinations: List[Dict[str, Any]] = Field(default_factory=list)


class WaypointSchema(BaseModel):
    index: int
    node_id: str
    label: str
    x: float
    y: float
    z: float
    segment_distance: float = 0.0
    cumulative_distance: float = 0.0


class AgentNavigateRequest(BaseModel):
    destination: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description="Target destination: zone ID (e.g. 'engineering_bay'), department name, workstation ID / logical_workstation_id, or 'own_workstation'",
    )
    task_id: Optional[str] = None
    speed: float = Field(4.0, gt=0.1, le=20.0, description="Movement speed in world units per second")
    allow_interrupt: bool = Field(
        False,
        description="If True, cleanly interrupts any in-progress movement and reroutes to the new destination",
    )
    target_state_on_arrival: str = Field(
        "IDLE",
        description="Behavioral state to transition into when movement completes (e.g. IDLE, WORKING, THINKING)",
    )


class AgentMovementProgressRequest(BaseModel):
    movement_id: str = Field(..., min_length=1, max_length=64)
    pos_x: float
    pos_y: float = 1.0
    pos_z: float
    waypoint_index: Optional[int] = Field(None, ge=0)
    progress_ratio: Optional[float] = Field(None, ge=0.0, le=1.0)


class AgentMovementCompleteRequest(BaseModel):
    movement_id: Optional[str] = Field(None, max_length=64)
    target_state: str = Field("IDLE", description="Behavioral state upon arrival")
    task_id: Optional[str] = None


class AgentMovementInterruptRequest(BaseModel):
    reason: Optional[str] = Field("Movement interrupted", max_length=255)
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None
    pos_z: Optional[float] = None
    target_state: str = Field("IDLE", description="Behavioral state after interruption")


class AgentMovementPlanResponse(BaseModel):
    movement_id: str
    agent_id: str
    organization_id: str
    behavioral_state: str
    operational_status: str
    origin: Dict[str, float]
    destination: str
    destination_type: str
    target_position: Dict[str, float]
    waypoints: List[WaypointSchema]
    total_distance: float
    speed: float
    estimated_duration_seconds: float
    target_state_on_arrival: str

