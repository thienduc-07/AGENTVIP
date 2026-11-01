from typing import List, Optional
from pydantic import BaseModel, ConfigDict

class ZoneConfigResponse(BaseModel):
    department: str
    zone: str
    base_x: float
    base_y: float
    base_z: float
    max_physical_desks: int
    desk_spacing_x: float
    desk_spacing_z: float
    allocated_count: int = 0
    physical_occupied_count: int = 0
    reserved_unoccupied_count: int = 0
    available_physical_count: int = 0
    virtual_count: int = 0

class WorkstationAllocationResponse(BaseModel):
    id: str
    organization_id: str
    agent_id: str
    department: str
    logical_workstation_id: str
    office_zone: str
    desk_number: Optional[int] = None
    pos_x: float
    pos_y: float
    pos_z: float
    allocation_status: str
    is_virtual: bool
    agent_name: Optional[str] = None
    agent_role: Optional[str] = None
    agent_status: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class WorkstationTelemetrySummary(BaseModel):
    total_desk_capacity: int = 60
    total_allocated: int = 0
    total_physical_occupied: int = 0
    total_reserved_unoccupied: int = 0
    total_physical_available: int = 60
    total_virtual_workforce: int = 0

class WorkstationOverviewResponse(BaseModel):
    zones: List[ZoneConfigResponse]
    allocations: List[WorkstationAllocationResponse]
    telemetry: WorkstationTelemetrySummary
