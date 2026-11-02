import { apiClient } from "./client";

export interface ZoneConfig {
  department: string;
  zone: string;
  base_x: number;
  base_y: number;
  base_z: number;
  max_physical_desks: number;
  desk_spacing_x: number;
  desk_spacing_z: number;
  allocated_count: number;
  physical_occupied_count: number;
  reserved_unoccupied_count?: number;
  available_physical_count: number;
  virtual_count: number;
}

export interface WorkstationAllocation {
  id: string;
  organization_id: string;
  agent_id: string;
  department: string;
  logical_workstation_id: string;
  office_zone: string;
  desk_number: number | null;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  allocation_status: "ASSIGNED" | "VIRTUAL" | "UNASSIGNED" | string;
  is_virtual: boolean;
  agent_name?: string | null;
  agent_role?: string | null;
  agent_status?: string | null;
}

export interface WorkstationTelemetrySummary {
  total_desk_capacity: number;
  total_allocated: number;
  total_physical_occupied: number;
  total_reserved_unoccupied?: number;
  total_physical_available: number;
  total_virtual_workforce: number;
}


export interface WorkstationOverview {
  zones: ZoneConfig[];
  allocations: WorkstationAllocation[];
  telemetry: WorkstationTelemetrySummary;
}

export async function getWorkstationOverview(options?: {
  token?: string | null;
  organizationId?: string | null;
}): Promise<WorkstationOverview> {
  return apiClient<WorkstationOverview>("/api/v1/workstations/overview", {
    token: options?.token,
    organizationId: options?.organizationId,
  });
}

export async function getZones(options?: {
  token?: string | null;
  organizationId?: string | null;
}): Promise<ZoneConfig[]> {
  return apiClient<ZoneConfig[]>("/api/v1/workstations/zones", {
    token: options?.token,
    organizationId: options?.organizationId,
  });
}

export async function getAllocations(options?: {
  department?: string;
  token?: string | null;
  organizationId?: string | null;
}): Promise<WorkstationAllocation[]> {
  return apiClient<WorkstationAllocation[]>("/api/v1/workstations/allocations", {
    params: options?.department ? { department: options.department } : undefined,
    token: options?.token,
    organizationId: options?.organizationId,
  });
}

export async function getWorkstationInspection(
  workstationId: string,
  options?: {
    token?: string | null;
    organizationId?: string | null;
  }
): Promise<any> {
  return apiClient<any>(`/api/v1/workstations/${workstationId}/inspection`, {
    token: options?.token,
    organizationId: options?.organizationId,
  });
}
