import { apiClient, RequestOptions } from "./client";
import { ApiAgent, ApiTask, ApiAgentInspection } from "@/types/api";

export async function getAgents(): Promise<ApiAgent[]> {
  return apiClient<ApiAgent[]>("/api/v1/agents");
}

export async function getAgentById(agentId: string): Promise<ApiAgent> {
  return apiClient<ApiAgent>(`/api/v1/agents/${agentId}`);
}

export async function getAgentTasks(agentId: string): Promise<ApiTask[]> {
  return apiClient<ApiTask[]>(`/api/v1/agents/${agentId}/tasks`);
}

export async function getAgentInspection(
  agentId: string,
  options: RequestOptions = {}
): Promise<ApiAgentInspection> {
  return apiClient<ApiAgentInspection>(`/api/v1/agents/${agentId}/inspection`, options);
}
