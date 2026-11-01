export interface ActiveTaskSummary {
  task_id: string;
  title: string;
  status: string;
  priority: string;
}

export interface AgentSnapshotItem {
  employee_id: string;
  name: string;
  role: string;
  department: string;
  lifecycle_state: "ACTIVE" | "SUSPENDED" | "OFFBOARDED" | "PROBATION" | string;
  operational_status: "idle" | "working" | "waiting_approval" | "error" | "offline" | string;
  behavioral_state?:
    | "IDLE"
    | "PLANNING"
    | "THINKING"
    | "WORKING"
    | "COMMUNICATING"
    | "MOVING"
    | "WAITING"
    | "COMPLETED"
    | "ERROR"
    | string;
  assigned_workstation: string | null;
  current_active_task: ActiveTaskSummary | null;
  spatial_coordinates?: SpatialCoordinates | null;
  target_coordinates?: SpatialCoordinates | null;
  target_destination?: string | null;
  active_movement_id?: string | null;
}

export interface ActivitySnapshotItem {
  agent_id: string;
  activity_type:
    | "idle_standby"
    | "thinking"
    | "tool_execution"
    | "writing_artifact"
    | "waiting_approval"
    | "communicating"
    | "suspended"
    | "offline"
    | string;
  task_id: string | null;
  subtask_id: string | null;
  current_execution_step: string | null;
  current_tool: string | null;
  activity_started_at: string | null;
}

export interface SpatialCoordinates {
  x: number;
  y: number;
  z: number;
}

export interface WorkstationSnapshotItem {
  workstation_id: string;
  zone: string;
  label: string;
  assigned_employee: string | null;
  occupancy_status: "vacant" | "reserved" | "occupied" | "maintenance" | string;
  spatial_coordinates: SpatialCoordinates;
  orientation: number;
  capabilities: string[];
  is_virtual: boolean;
}

export interface OrganizationSummary {
  total_employees: number;
  active_employees: number;
  busy_employees: number;
  available_workstations: number;
  active_tasks: number;
}

export interface WorldSnapshotResponse {
  snapshot_id: string;
  schema_version: string;
  generated_at: string;
  organization_id: string;
  sequence_id: number;
  summary: OrganizationSummary;
  agents: AgentSnapshotItem[];
  activities: ActivitySnapshotItem[];
  workstations: WorkstationSnapshotItem[];
}
