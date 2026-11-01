import { ApiErrorResponse } from "@/types/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

let globalAuthToken: string | null = null;
let globalTenantOrg: string | null = null;

export function setAuthToken(token: string | null): void {
  globalAuthToken = token;
}

export function getAuthToken(): string | null {
  return globalAuthToken;
}

export function setTenantOrganization(orgId: string | null): void {
  globalTenantOrg = orgId;
}

export function getTenantOrganization(): string | null {
  return globalTenantOrg;
}

export class ApiClientError extends Error {
  code: string;
  statusCode: number;
  details?: any;

  constructor(message: string, code: string = "API_ERROR", statusCode: number = 500, details?: any) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | undefined | null>;
  token?: string | null;
  organizationId?: string | null;
  timeoutMs?: number;
}

export async function apiClient<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { params, headers, token, organizationId, timeoutMs = 15000, signal, ...customConfig } = options;

  let url = `${API_BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const effectiveToken = token !== undefined ? token : globalAuthToken;
  const effectiveOrg = organizationId !== undefined ? organizationId : globalTenantOrg;

  const authHeaders: Record<string, string> = {};
  if (effectiveToken) {
    authHeaders["Authorization"] = `Bearer ${effectiveToken}`;
  }
  if (effectiveOrg) {
    authHeaders["X-Organization-Id"] = effectiveOrg;
  }

  const defaultHeaders: HeadersInit = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...authHeaders,
  };

  // Controller for timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort(new Error("REQUEST_TIMEOUT"));
  }, timeoutMs);

  let combinedSignal = timeoutController.signal;
  if (signal) {
    // If external signal provided, abort when either triggers
    signal.addEventListener("abort", () => timeoutController.abort(signal.reason));
  }

  const config: RequestInit = {
    headers: {
      ...defaultHeaders,
      ...headers,
    },
    signal: combinedSignal,
    ...customConfig,
  };

  try {
    const response = await fetch(url, config);
    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorCode = response.status === 401 ? "UNAUTHORIZED" : response.status === 403 ? "FORBIDDEN" : "HTTP_ERROR";
      let errorMessage = `Request failed with status ${response.status}`;
      let errorDetails = undefined;

      try {
        const errorData = await response.json();
        if (errorData?.detail) {
          errorMessage = typeof errorData.detail === "string" ? errorData.detail : JSON.stringify(errorData.detail);
          errorCode = response.status === 422 ? "VALIDATION_ERROR" : errorCode;
          errorDetails = errorData.detail;
        } else if (errorData?.error) {
          errorCode = errorData.error.code || errorCode;
          errorMessage = errorData.error.message || errorMessage;
          errorDetails = errorData.error;
        }
      } catch {
        // Fallback if not valid JSON
      }

      throw new ApiClientError(errorMessage, errorCode, response.status, errorDetails);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error instanceof ApiClientError) {
      throw error;
    }
    if (error?.name === "AbortError" || error?.message === "REQUEST_TIMEOUT") {
      throw new ApiClientError("Yêu cầu quá hạn (Request Timeout)", "TIMEOUT_ERROR", 408);
    }
    throw new ApiClientError(
      error?.message || "Không thể kết nối đến máy chủ backend (Network Error)",
      "NETWORK_ERROR",
      0
    );
  }
}

