import { ToolDefinition, ToolExecutionRecord, ToolTestResult } from '../../types/tool';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function fetchTools(category?: string, is_enabled?: boolean): Promise<ToolDefinition[]> {
  const params = new URLSearchParams();
  if (category) params.append('category', category);
  if (is_enabled !== undefined) params.append('is_enabled', String(is_enabled));

  const url = `${API_BASE}/api/v1/tools${params.toString() ? '?' + params.toString() : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch tools: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchTool(name: string): Promise<ToolDefinition> {
  const res = await fetch(`${API_BASE}/api/v1/tools/${encodeURIComponent(name)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch tool '${name}': ${res.statusText}`);
  }
  return res.json();
}

export async function toggleTool(name: string, enable?: boolean): Promise<ToolDefinition> {
  const res = await fetch(`${API_BASE}/api/v1/tools/${encodeURIComponent(name)}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enable }),
  });
  if (!res.ok) {
    throw new Error(`Failed to toggle tool '${name}': ${res.statusText}`);
  }
  return res.json();
}

export async function fetchToolExecutions(params?: {
  tool_name?: string;
  task_id?: string;
  agent_id?: string;
  status?: string;
  limit?: number;
}): Promise<ToolExecutionRecord[]> {
  const query = new URLSearchParams();
  if (params?.tool_name) query.append('tool_name', params.tool_name);
  if (params?.task_id) query.append('task_id', params.task_id);
  if (params?.agent_id) query.append('agent_id', params.agent_id);
  if (params?.status) query.append('status', params.status);
  if (params?.limit) query.append('limit', String(params.limit));

  const url = `${API_BASE}/api/v1/tools/executions/history${query.toString() ? '?' + query.toString() : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch tool executions: ${res.statusText}`);
  }
  return res.json();
}

export async function testExecuteTool(
  name: string,
  args: Record<string, any>,
  agentId?: string
): Promise<ToolTestResult> {
  const res = await fetch(`${API_BASE}/api/v1/tools/${encodeURIComponent(name)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arguments: args, agent_id: agentId || 'agent-exec-ceo' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Tool test execution failed: ${res.statusText}`);
  }
  return res.json();
}
