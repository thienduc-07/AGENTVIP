import { apiClient, RequestOptions } from "./client";
import { ApiApproval } from "@/types/api";

export interface ApprovalDecisionPayload {
  decision: "approved" | "rejected" | "expired" | "cancelled";
  reason?: string;
}

export async function listApprovals(
  params?: { status?: string; limit?: number; offset?: number },
  options: RequestOptions = {}
): Promise<ApiApproval[]> {
  return apiClient<ApiApproval[]>("/api/v1/approvals", {
    params: params as Record<string, string | number | undefined>,
    token: options.token,
    organizationId: options.organizationId,
  });
}

export async function getApprovalById(
  approvalId: string,
  options: RequestOptions = {}
): Promise<ApiApproval> {
  return apiClient<ApiApproval>(`/api/v1/approvals/${approvalId}`, options);
}

export async function decideApproval(
  approvalId: string,
  decision: "approved" | "rejected" | "expired" | "cancelled",
  reason?: string,
  options: RequestOptions = {}
): Promise<ApiApproval> {
  return apiClient<ApiApproval>(`/api/v1/approvals/${approvalId}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, reason: reason || "" }),
    token: options.token,
    organizationId: options.organizationId,
  });
}

