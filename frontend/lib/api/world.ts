import { apiClient } from "./client";
import { WorldSnapshotResponse } from "@/types/world";

export async function getWorldSnapshot(options?: {
  token?: string | null;
  organizationId?: string | null;
}): Promise<WorldSnapshotResponse> {
  return apiClient<WorldSnapshotResponse>("/api/v1/world/snapshot", {
    token: options?.token,
    organizationId: options?.organizationId,
  });
}
