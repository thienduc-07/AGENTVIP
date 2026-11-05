import { apiClient, ApiClientError } from '@/lib/api/client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

export interface SpecialistSummary {
  id: string;
  slug: string;
  name: string;
  division: string;
  department: string;
  role: string;
  description?: string;
  color: string;
  emoji: string;
  vibe?: string;
  capabilities: string[];
  skills: string[];
  declared_tools: string[];
  assigned_tools: string[];
  permission_level: number;
  validation_status: string;
  lifecycle_state: string;
  version: number;
}

export interface SpecialistDetail extends SpecialistSummary {
  system_instructions: string;
  identity_and_memory?: string;
  core_mission?: string;
  critical_rules?: string;
  workflows?: string;
  deliverables?: string;
  success_metrics?: string;
  source_repo: string;
  source_path: string;
  source_commit_sha?: string;
  validation_errors: string[];
  imported_at?: string;
  updated_at?: string;
}

export interface DivisionSummary {
  division: string;
  department: string;
  color: string;
  agent_count: number;
}

export interface RecruitPayload {
  specialist_id: string;
  recruited_by?: string;
  manager_agent_id?: string;
  department?: string;
  custom_name?: string;
  budget_limit_usd?: number;
  permission_profile?: string;
  notes?: string;
}

export interface HierarchyNode {
  department: string;
  manager: {
    id: string;
    name: string;
    role: string;
    status: string;
    station: string;
  };
  headcount: number;
  specialists: Array<{
    agent_id: string;
    name: string;
    role: string;
    status: string;
    lifecycle_state: string;
    budget_limit_usd: number;
    budget_spent_usd: number;
    specialist_slug: string;
    emoji: string;
    color: string;
  }>;
}

export interface CorporateHierarchy {
  owner: string;
  ceo: {
    id: string;
    name: string;
    role: string;
    status: string;
  };
  departments: Record<string, HierarchyNode>;
  total_recruited: number;
}

export async function fetchSpecialists(params?: {
  division?: string;
  department?: string;
  search?: string;
  lifecycle_state?: string;
  skip?: number;
  limit?: number;
}): Promise<{ total: number; items: SpecialistSummary[] }> {
  const queryParams: Record<string, string | number | undefined> = {};
  if (params?.division && params.division !== 'all') queryParams.division = params.division;
  if (params?.department && params.department !== 'all') queryParams.department = params.department;
  if (params?.search) queryParams.search = params.search;
  if (params?.lifecycle_state) queryParams.lifecycle_state = params.lifecycle_state;
  if (params?.skip !== undefined) queryParams.skip = params.skip;
  if (params?.limit !== undefined) queryParams.limit = params.limit;

  return apiClient<{ total: number; items: SpecialistSummary[] }>('/api/v1/specialists', {
    params: queryParams,
  });
}

export async function fetchSpecialistDetail(id: string): Promise<SpecialistDetail> {
  return apiClient<SpecialistDetail>(`/api/v1/specialists/${encodeURIComponent(id)}`);
}

export async function fetchDivisions(): Promise<DivisionSummary[]> {
  return apiClient<DivisionSummary[]>('/api/v1/specialists/divisions');
}

export async function recruitSpecialist(payload: RecruitPayload): Promise<any> {
  return apiClient<any>('/api/v1/recruitment/recruit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchCorporateHierarchy(): Promise<CorporateHierarchy> {
  return apiClient<CorporateHierarchy>('/api/v1/recruitment/hierarchy');
}

export async function compareCandidates(specialistIds: string[]): Promise<any[]> {
  return apiClient<any[]>('/api/v1/recruitment/compare', {
    method: 'POST',
    body: JSON.stringify({ specialist_ids: specialistIds }),
  });
}

export async function transitionAgentLifecycle(
  agentId: string,
  action: 'activate' | 'suspend' | 'retire',
  reason?: string
): Promise<any> {
  return apiClient<any>(`/api/v1/recruitment/${encodeURIComponent(agentId)}/${action}`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function provisionWorkforceApi(organizationId: string = 'org_default_company'): Promise<any> {
  return apiClient<any>('/api/v1/recruitment/provision-workforce', {
    method: 'POST',
    params: { organization_id: organizationId },
  });
}
