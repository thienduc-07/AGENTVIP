import { apiClient, RequestOptions, ApiClientError } from "./client";
import { ApiTask, CreateTaskRequest, TaskCancelResponse, ApiTaskStep, ApiEvent } from "@/types/api";

export interface CreateTaskOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  token?: string | null;
  organizationId?: string | null;
}

export interface ListTasksParams {
  status?: string;
  agent_id?: string;
  limit?: number;
  offset?: number;
}

export function validateCreateTaskRequest(data: CreateTaskRequest): void {
  if (!data.title || !data.title.trim()) {
    throw new ApiClientError("Tiêu đề nhiệm vụ không được để trống", "VALIDATION_ERROR", 400);
  }
  if (data.title.trim().length > 200) {
    throw new ApiClientError("Tiêu đề nhiệm vụ không được vượt quá 200 ký tự", "VALIDATION_ERROR", 400);
  }
  if (!data.description || !data.description.trim()) {
    throw new ApiClientError("Mô tả nhiệm vụ không được để trống", "VALIDATION_ERROR", 400);
  }
  if (!data.assigned_agent_id || !data.assigned_agent_id.trim()) {
    throw new ApiClientError("Nhiệm vụ phải được chỉ định cho một Agent", "VALIDATION_ERROR", 400);
  }
}

export async function createTask(data: CreateTaskRequest, options: CreateTaskOptions = {}): Promise<ApiTask> {
  validateCreateTaskRequest(data);
  const payload: Record<string, any> = {
    title: data.title.trim(),
    description: data.description.trim(),
    assigned_agent_id: data.assigned_agent_id.trim(),
    priority: data.priority || "normal",
  };
  if (data.id) payload.id = data.id.trim();
  if (data.idempotency_key) payload.idempotency_key = data.idempotency_key.trim();

  return apiClient<ApiTask>("/api/v1/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    token: options.token,
    organizationId: options.organizationId,
  });
}


export async function getTasks(params?: ListTasksParams): Promise<ApiTask[]> {
  return apiClient<ApiTask[]>("/api/v1/tasks", {
    params: params as Record<string, string | number | undefined>,
  });
}

export async function getTaskById(taskId: string): Promise<ApiTask> {
  return apiClient<ApiTask>(`/api/v1/tasks/${taskId}`);
}

export async function getTaskSteps(taskId: string): Promise<ApiTaskStep[]> {
  return apiClient<ApiTaskStep[]>(`/api/v1/tasks/${taskId}/steps`);
}

export async function pauseTask(
  taskId: string,
  reason?: string,
  options: RequestOptions = {}
): Promise<{ id: string; status: string; is_paused: boolean; message?: string }> {
  return apiClient<{ id: string; status: string; is_paused: boolean; message?: string }>(
    `/api/v1/tasks/${taskId}/pause`,
    {
      method: "POST",
      body: JSON.stringify({ reason: reason || "Paused by operator" }),
      token: options.token,
      organizationId: options.organizationId,
    }
  );
}

export async function resumeTask(
  taskId: string,
  guidance?: string,
  options: RequestOptions = {}
): Promise<{ id: string; status: string; is_resumed: boolean; message?: string }> {
  return apiClient<{ id: string; status: string; is_resumed: boolean; message?: string }>(
    `/api/v1/tasks/${taskId}/resume`,
    {
      method: "POST",
      body: JSON.stringify({ guidance: guidance || "Resumed by operator" }),
      token: options.token,
      organizationId: options.organizationId,
    }
  );
}

export async function cancelTask(taskId: string): Promise<TaskCancelResponse> {
  return apiClient<TaskCancelResponse>(`/api/v1/tasks/${taskId}/cancel`, {
    method: "POST",
  });
}

export async function getTaskEvents(taskId: string): Promise<ApiEvent[]> {
  return apiClient<ApiEvent[]>(`/api/v1/tasks/${taskId}/events`);
}
