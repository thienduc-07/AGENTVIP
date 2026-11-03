import { ApiErrorResponse } from "@/types/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

let globalAuthToken: string | null = null;
let globalTenantOrg: string | null = null;
let authBootstrapPromise: Promise<string | null> | null = null;

export function setAuthToken(token: string | null): void {
  globalAuthToken = token;
  if (typeof window !== "undefined") {
    if (token) {
      localStorage.setItem("provipagent_auth_token", token);
    } else {
      localStorage.removeItem("provipagent_auth_token");
      localStorage.removeItem("auth_token");
    }
  }
}

export function getAuthToken(): string | null {
  if (globalAuthToken) return globalAuthToken;
  if (typeof window !== "undefined") {
    const stored =
      localStorage.getItem("provipagent_auth_token") ||
      localStorage.getItem("auth_token");
    if (stored) {
      globalAuthToken = stored;
      return stored;
    }
  }
  return null;
}

export function setTenantOrganization(orgId: string | null): void {
  globalTenantOrg = orgId;
}

export function getTenantOrganization(): string | null {
  return globalTenantOrg || "org_default_company";
}

/**
 * Ensures an active authenticated session exists.
 * If in browser context without a token, automatically authenticates with the backend.
 */
export async function ensureAuthenticatedSession(): Promise<string | null> {
  const existing = getAuthToken();
  if (existing) return existing;

  if (typeof window === "undefined") return null;

  if (authBootstrapPromise) return authBootstrapPromise;

  authBootstrapPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@agency.ai",
          password: "SuperAdminSecurePassword2026!",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.access_token) {
          setAuthToken(data.access_token);
          setTenantOrganization("org_default_company");
          localStorage.setItem("provipagent_auth_token", data.access_token);
          localStorage.setItem("provipagent_user_id", data.user_id || "");
          localStorage.setItem("provipagent_email", data.email || "");
          return data.access_token;
        }
      }
    } catch (e) {
      console.warn("[apiClient] Automatic local auth bootstrap skipped:", e);
    } finally {
      authBootstrapPromise = null;
    }
    return null;
  })();

  return authBootstrapPromise;
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

  let effectiveToken = token !== undefined ? token : getAuthToken();
  const effectiveOrg = organizationId !== undefined ? organizationId : getTenantOrganization();

  // If in browser and unauthenticated, automatically bootstrap session
  if (!effectiveToken && typeof window !== "undefined" && !endpoint.includes("/auth/login")) {
    effectiveToken = await ensureAuthenticatedSession();
  }

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
      if (response.status === 401 && typeof window !== "undefined" && !endpoint.includes("/auth/login")) {
        // Clear invalid token and re-authenticate once
        localStorage.removeItem("provipagent_auth_token");
        localStorage.removeItem("auth_token");
        globalAuthToken = null;
        const refreshedToken = await ensureAuthenticatedSession();
        if (refreshedToken) {
          const retryHeaders = {
            ...config.headers,
            Authorization: `Bearer ${refreshedToken}`,
          };
          const retryResponse = await fetch(url, { ...config, headers: retryHeaders });
          if (retryResponse.ok) {
            clearTimeout(timeoutId);
            if (retryResponse.status === 204) return {} as T;
            return (await retryResponse.json()) as T;
          }
        }
      }
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

