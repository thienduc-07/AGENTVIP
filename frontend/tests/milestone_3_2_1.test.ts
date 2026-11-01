import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useWorldStore, ENABLE_DEMO_SIMULATION } from "@/store/worldStore";
import { createTask, validateCreateTaskRequest } from "@/lib/api/tasks";
import { ApiClientError, setAuthToken, setTenantOrganization } from "@/lib/api/client";

describe("Milestone 3.2.1: Demo Simulation Isolation & Real Task Submission", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Reset Zustand store state to defaults
    useWorldStore.setState({
      isDemoMode: false,
      activeTasks: {},
      chatMessages: [],
      executionQueue: [],
      activeDeliverables: [],
      isExecutingMission: false,
    });
    setAuthToken(null);
    setTenantOrganization(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("A. Demo Simulation Isolation", () => {
    it("should have production default demo flag disabled", () => {
      // In production or test environment without NEXT_PUBLIC_ENABLE_DEMO_SIMULATION='true'
      expect(ENABLE_DEMO_SIMULATION).toBe(false);
      expect(useWorldStore.getState().isDemoMode).toBe(false);
    });

    it("should NOT execute synthetic simulation loops or generate fake deliverables when demo mode is false", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Call executeMissionPipeline when demo mode is false
      await useWorldStore.getState().executeMissionPipeline("Tạo tài liệu PRD docx");

      // Verify that no synthetic execution queue or fake deliverables were created
      expect(useWorldStore.getState().executionQueue.length).toBe(0);
      expect(useWorldStore.getState().activeDeliverables.length).toBe(0);
      expect(useWorldStore.getState().isExecutingMission).toBe(false);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Synthetic demo simulation is DISABLED")
      );
    });

    it("should allow explicit enablement of demo mode when configured", async () => {
      useWorldStore.getState().setIsDemoMode(true);
      expect(useWorldStore.getState().isDemoMode).toBe(true);
    });

    it("should never fabricate deliverables in production mode even if prompt requests docx/xlsx", async () => {
      useWorldStore.setState({ isDemoMode: false });
      await useWorldStore.getState().executeMissionPipeline("Phân tích tài chính .xlsx và tạo báo cáo");

      expect(useWorldStore.getState().activeDeliverables).toEqual([]);
      expect(useWorldStore.getState().executionQueue).toEqual([]);
    });
  });

  describe("B. Task Creation Validation", () => {
    it("should reject task creation when title is empty or missing", () => {
      expect(() =>
        validateCreateTaskRequest({
          title: "",
          description: "Valid mission description",
          assigned_agent_id: "agent-exec-ceo",
        })
      ).toThrowError(/Tiêu đề nhiệm vụ không được để trống/);
    });

    it("should reject task creation when title exceeds 200 characters", () => {
      const longTitle = "A".repeat(201);
      expect(() =>
        validateCreateTaskRequest({
          title: longTitle,
          description: "Valid description",
          assigned_agent_id: "agent-exec-ceo",
        })
      ).toThrowError(/Tiêu đề nhiệm vụ không được vượt quá 200 ký tự/);
    });

    it("should reject task creation when description is empty or missing", () => {
      expect(() =>
        validateCreateTaskRequest({
          title: "Valid Title",
          description: "   ",
          assigned_agent_id: "agent-exec-ceo",
        })
      ).toThrowError(/Mô tả nhiệm vụ không được để trống/);
    });

    it("should reject task creation when assigned_agent_id is empty or missing", () => {
      expect(() =>
        validateCreateTaskRequest({
          title: "Valid Title",
          description: "Valid description",
          assigned_agent_id: "",
        })
      ).toThrowError(/Nhiệm vụ phải được chỉ định cho một Agent/);
    });
  });

  describe("C. Authenticated Task Submission API Client", () => {
    it("should send authenticated POST request and return backend task response on 201 Created", async () => {
      const mockBackendTask = {
        id: "task_real_999",
        organization_id: "org_default_company",
        title: "Deploy microservice to Kubernetes cluster",
        description: "Deploy production release",
        status: "queued",
        priority: "normal",
        assigned_agent_id: "agent-eng-lead",
        created_at: "2026-11-01T03:00:00Z",
        updated_at: "2026-11-01T03:00:00Z",
      };

      setAuthToken("jwt_mock_token_123");
      setTenantOrganization("org_alpha_test");

      let capturedUrl = "";
      let capturedInit: any = undefined;

      global.fetch = vi.fn().mockImplementation(async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init;
        return {
          ok: true,
          status: 201,
          json: async () => mockBackendTask,
        };
      });

      const result = await createTask({
        title: "Deploy microservice to Kubernetes cluster",
        description: "Deploy production release",
        assigned_agent_id: "agent-eng-lead",
        priority: "normal",
      });

      expect(capturedUrl).toContain("/api/v1/tasks");
      expect(capturedInit?.method).toBe("POST");
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer jwt_mock_token_123");
      expect(headers["X-Organization-Id"]).toBe("org_alpha_test");
      expect(headers["Content-Type"]).toBe("application/json");

      expect(result.id).toBe("task_real_999");
      expect(result.status).toBe("queued");
      expect(result.assigned_agent_id).toBe("agent-eng-lead");
    });

    it("should handle 401 Unauthorized when auth token is expired or missing", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: "Invalid or expired authentication token" }),
      });

      await expect(
        createTask({
          title: "Audit ledger",
          description: "Audit quarterly finances",
          assigned_agent_id: "agent-fin-controller",
        })
      ).rejects.toMatchObject({
        name: "ApiClientError",
        statusCode: 401,
        code: "UNAUTHORIZED",
        message: "Invalid or expired authentication token",
      });
    });

    it("should handle 422 Validation Error from backend FastAPI", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          detail: [
            {
              loc: ["body", "title"],
              msg: "ensure this value has at most 100 characters",
              type: "value_error.any_str.max_length",
            },
          ],
        }),
      });

      await expect(
        createTask({
          title: "Title that backend rejects",
          description: "Full description",
          assigned_agent_id: "agent-exec-ceo",
        })
      ).rejects.toMatchObject({
        name: "ApiClientError",
        statusCode: 422,
        code: "VALIDATION_ERROR",
      });
    });

    it("should handle network connection failure gracefully", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Failed to fetch"));

      await expect(
        createTask({
          title: "Network test task",
          description: "Check connectivity",
          assigned_agent_id: "agent-exec-ceo",
        })
      ).rejects.toMatchObject({
        name: "ApiClientError",
        code: "NETWORK_ERROR",
        statusCode: 0,
      });
    });

    it("should handle request timeout and raise TIMEOUT_ERROR", async () => {
      global.fetch = vi.fn().mockImplementation(async (url, init) => {
        const signal = init?.signal;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({ ok: true, status: 200, json: async () => ({}) });
          }, 500);

          if (signal) {
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              const err = new Error("REQUEST_TIMEOUT");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      });

      await expect(
        createTask(
          {
            title: "Timeout task",
            description: "Will timeout",
            assigned_agent_id: "agent-exec-ceo",
          },
          { timeoutMs: 50 }
        )
      ).rejects.toMatchObject({
        name: "ApiClientError",
        code: "TIMEOUT_ERROR",
        statusCode: 408,
      });
    });
  });

  describe("D. Store Task Projection", () => {
    it("should add confirmed task to activeTasks in worldStore", () => {
      const realTask = {
        id: "task_confirmed_777",
        title: "Authorized System Upgrade",
        description: "Upgrading core runtime",
        status: "queued" as const,
        priority: "high" as const,
        assigned_agent_id: "agent-eng-lead",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      useWorldStore.getState().addTask(realTask);

      const tasks = useWorldStore.getState().activeTasks;
      expect(tasks["task_confirmed_777"]).toBeDefined();
      expect(tasks["task_confirmed_777"].title).toBe("Authorized System Upgrade");
      expect(tasks["task_confirmed_777"].status).toBe("queued");
    });
  });
});
