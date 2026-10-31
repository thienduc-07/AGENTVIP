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
  const query = new URLSearchParams();
  if (params?.division && params.division !== 'all') query.set('division', params.division);
  if (params?.department && params.department !== 'all') query.set('department', params.department);
  if (params?.search) query.set('search', params.search);
  if (params?.lifecycle_state) query.set('lifecycle_state', params.lifecycle_state);
  if (params?.skip !== undefined) query.set('skip', params.skip.toString());
  if (params?.limit !== undefined) query.set('limit', params.limit.toString());

  const res = await fetch(`${API_BASE}/api/v1/specialists?${query.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch specialist catalog');
  return res.json();
}

export async function fetchSpecialistDetail(id: string): Promise<SpecialistDetail> {
  const res = await fetch(`${API_BASE}/api/v1/specialists/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch specialist ${id}`);
  return res.json();
}

export async function fetchDivisions(): Promise<DivisionSummary[]> {
  const res = await fetch(`${API_BASE}/api/v1/specialists/divisions`);
  if (!res.ok) throw new Error('Failed to fetch divisions');
  return res.json();
}

export async function recruitSpecialist(payload: RecruitPayload): Promise<any> {
  const res = await fetch(`${API_BASE}/api/v1/recruitment/recruit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Recruitment failed');
  }
  return res.json();
}

export async function fetchCorporateHierarchy(): Promise<CorporateHierarchy> {
  const res = await fetch(`${API_BASE}/api/v1/recruitment/hierarchy`);
  if (!res.ok) throw new Error('Failed to fetch corporate hierarchy');
  return res.json();
}

export async function compareCandidates(specialistIds: string[]): Promise<any[]> {
  const res = await fetch(`${API_BASE}/api/v1/recruitment/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ specialist_ids: specialistIds }),
  });
  if (!res.ok) throw new Error('Failed to compare candidates');
  return res.json();
}

export async function transitionAgentLifecycle(
  agentId: string,
  action: 'activate' | 'suspend' | 'retire',
  reason?: string
): Promise<any> {
  const res = await fetch(`${API_BASE}/api/v1/recruitment/${encodeURIComponent(agentId)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Action ${action} failed`);
  }
  return res.json();
}
