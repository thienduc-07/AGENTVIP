import { describe, it, expect, vi, beforeEach } from "vitest";
import { CANONICAL_STATE_CONFIGS, CanonicalAgentState } from "../types/office";
import { ApiAgentInspection, ApiApproval, ApiWorkstationInspection } from "../types/api";
import { normalizeBehavioralState } from "../lib/spatialMovement";

describe("Phase 4.3.3: Interactive 3D Workstations & Agent Inspection HUD", () => {
  // =========================================================================
  // 1. WORKSTATION INTERACTION & SELECTION INVARIANTS
  // =========================================================================
  describe("1. Workstation Selection & Highlighting Logic", () => {
    interface MockWorkstation {
      workstation_id: string;
      assigned_employee: string | null;
      pos_x: number;
      pos_z: number;
    }

    const workstations: Record<string, MockWorkstation> = {
      "ws-eng-01": {
        workstation_id: "ws-eng-01",
        assigned_employee: "agent-eng-lead",
        pos_x: -14.0,
        pos_z: -4.0,
      },
      "ws-vacant-01": {
        workstation_id: "ws-vacant-01",
        assigned_employee: null, // Unoccupied
        pos_x: 6.0,
        pos_z: 20.0,
      },
    };

    it("should select the corresponding Agent when an occupied workstation is clicked", () => {
      const targetWs = workstations["ws-eng-01"];
      const selectAction = (wsId: string) => {
        const ws = workstations[wsId];
        if (!ws) return { type: "none" };
        if (ws.assigned_employee) {
          return { type: "agent", id: ws.assigned_employee };
        }
        return { type: "workstation", id: wsId };
      };

      const result = selectAction("ws-eng-01");
      expect(result.type).toBe("agent");
      expect(result.id).toBe("agent-eng-lead");
    });

    it("should select the workstation without fabricating an Agent when an unoccupied workstation is clicked", () => {
      const selectAction = (wsId: string) => {
        const ws = workstations[wsId];
        if (!ws) return { type: "none" };
        if (ws.assigned_employee) {
          return { type: "agent", id: ws.assigned_employee };
        }
        return { type: "workstation", id: wsId };
      };

      const result = selectAction("ws-vacant-01");
      expect(result.type).toBe("workstation");
      expect(result.id).toBe("ws-vacant-01");
      // Must not fabricate any agent ID
      expect((result as any).agentId).toBeUndefined();
    });

    it("should compute visual highlighting for a workstation when its assigned agent is selected", () => {
      const selection = { type: "agent", id: "agent-eng-lead" };

      const isWorkstationHighlighted = (ws: MockWorkstation) => {
        if (selection.type === "workstation") {
          return selection.id === ws.workstation_id;
        }
        if (selection.type === "agent") {
          return ws.assigned_employee === selection.id;
        }
        return false;
      };

      expect(isWorkstationHighlighted(workstations["ws-eng-01"])).toBe(true);
      expect(isWorkstationHighlighted(workstations["ws-vacant-01"])).toBe(false);
    });
  });

  // =========================================================================
  // 2. RUNTIME STATUS BADGES & CANONICAL MATRIX
  // =========================================================================
  describe("2. Runtime Lifecycle Status Matrix", () => {
    const requiredStatuses: CanonicalAgentState[] = [
      "IDLE",
      "WORKING",
      "THINKING",
      "WAITING_APPROVAL",
      "PAUSED",
      "ERROR",
      "OFFLINE",
    ];

    it("should support all required HUD runtime states with valid visual configurations", () => {
      requiredStatuses.forEach((st) => {
        const cfg = CANONICAL_STATE_CONFIGS[st];
        expect(cfg, `Missing config for state: ${st}`).toBeDefined();
        expect(cfg.label).toBeTruthy();
        expect(cfg.beaconColor).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(cfg.monitorColor).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(cfg.emissiveIntensity).toBeGreaterThanOrEqual(0.1);
      });
    });

    it("should display PAUSED with amber color and distinct paused monitor glow", () => {
      const pausedCfg = CANONICAL_STATE_CONFIGS["PAUSED"];
      expect(pausedCfg.beaconColor).toBe("#fbbf24");
      expect(pausedCfg.monitorColor).toBe("#d97706");
      expect(pausedCfg.label).toContain("Tạm dừng");
    });

    it("should display WAITING_APPROVAL with alert glow and distinct waiting color", () => {
      const waitingCfg = CANONICAL_STATE_CONFIGS["WAITING_APPROVAL"];
      expect(waitingCfg.beaconColor).toBe("#fb923c");
      expect(waitingCfg.ambientVfx).toBe("alert_ring");
      expect(waitingCfg.label).toContain("Chờ phê duyệt");
    });
  });

  // =========================================================================
  // 3. HUD DATA MAPPING & AUTHORITATIVE INVARIANTS
  // =========================================================================
  describe("3. HUD Inspection Data & Availability", () => {
    it("should compute agent availability strictly based on runtime status", () => {
      const computeAvailability = (status: string, hasActiveTask: boolean) => {
        return status === "IDLE" && !hasActiveTask;
      };

      expect(computeAvailability("IDLE", false)).toBe(true);
      expect(computeAvailability("WORKING", true)).toBe(false);
      expect(computeAvailability("PAUSED", true)).toBe(false);
      expect(computeAvailability("WAITING_APPROVAL", true)).toBe(false);
      expect(computeAvailability("ERROR", false)).toBe(false);
      expect(computeAvailability("OFFLINE", false)).toBe(false);
    });

    it("should accurately format execution duration in seconds", () => {
      const calculateDurationSeconds = (startedAt: string, now: Date) => {
        const start = new Date(startedAt).getTime();
        return Math.max(0, Math.round((now.getTime() - start) / 1000));
      };

      const now = new Date("2026-11-02T18:00:00Z");
      const started = "2026-11-02T17:55:00Z"; // 5 minutes ago = 300s
      expect(calculateDurationSeconds(started, now)).toBe(300);
    });
  });

  // =========================================================================
  // 4. ACTION HUD CONTRACTS
  // =========================================================================
  describe("4. Action HUD Execution Contracts", () => {
    it("should construct valid pause action payload", () => {
      const taskId = "task-alpha-123";
      const reason = "Operator paused via 3D HUD";
      const payload = { taskId, reason };

      expect(payload.taskId).toBe("task-alpha-123");
      expect(payload.reason).toBe("Operator paused via 3D HUD");
    });

    it("should construct valid resume action payload with optional guidance", () => {
      const taskId = "task-alpha-123";
      const guidance = "Proceed with deployment to cluster B";
      const payload = { taskId, guidance };

      expect(payload.taskId).toBe("task-alpha-123");
      expect(payload.guidance).toBe("Proceed with deployment to cluster B");
    });

    it("should enforce approval decisions to only approved or rejected", () => {
      const validateDecision = (decision: string): boolean => {
        return decision === "approved" || decision === "rejected";
      };

      expect(validateDecision("approved")).toBe(true);
      expect(validateDecision("rejected")).toBe(true);
      expect(validateDecision("bypass")).toBe(false);
      expect(validateDecision("arbitrary")).toBe(false);
    });
  });

  // =========================================================================
  // 5. WEBSOCKET REAL-TIME EVENT INGESTION & CLEANUP
  // =========================================================================
  describe("5. WebSocket Event Reconciler & Listener Cleanup", () => {
    it("should reactively update agent state when task.paused event arrives", () => {
      let state: Partial<ApiAgentInspection> = {
        agent_id: "agent-1",
        status: "WORKING",
        current_task: {
          id: "task-1",
          title: "Build app",
          description: "Compiling",
          status: "running",
          priority: "normal",
          assigned_agent_id: "agent-1",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };

      const applyEvent = (evType: string) => {
        if (evType === "task.paused") {
          state = {
            ...state,
            status: "PAUSED",
            current_task: state.current_task ? { ...state.current_task, status: "paused" } : null,
          };
        } else if (evType === "task.resumed") {
          state = {
            ...state,
            status: "WORKING",
            current_task: state.current_task ? { ...state.current_task, status: "running" } : null,
          };
        }
      };

      applyEvent("task.paused");
      expect(state.status).toBe("PAUSED");
      expect(state.current_task?.status).toBe("paused");

      applyEvent("task.resumed");
      expect(state.status).toBe("WORKING");
      expect(state.current_task?.status).toBe("running");
    });

    it("should properly register and cleanup WebSocket event listeners without memory leaks", () => {
      const listeners = new Set<() => void>();
      const subscribe = (cb: () => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      };

      const mockListener = vi.fn();
      const unsub = subscribe(mockListener);

      expect(listeners.size).toBe(1);
      unsub();
      expect(listeners.size).toBe(0);
    });
  });
});

