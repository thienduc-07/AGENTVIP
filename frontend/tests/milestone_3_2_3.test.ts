import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveAgentVisualState, StateBridge } from "@/lib/stateBridge";
import { useWorldStore } from "@/store/worldStore";
import { useSceneStore } from "@/store/sceneStore";
import { ApiTask } from "@/types/api";

describe("Milestone 3.2.3: Decoupled Spatial Scene Store & Headless State Bridge", () => {
  beforeEach(() => {
    // Reset stores
    useWorldStore.setState({
      agents: {},
      activeTasks: {},
    });
    useSceneStore.getState().resetScene();
  });

  afterEach(() => {
    StateBridge.getInstance().stop();
  });

  describe("A. Deterministic Visual State Resolver", () => {
    it("should resolve to WORKING when task is running or planning", () => {
      const agent = { status: "idle", last_seen_at: new Date().toISOString() };
      const runningTask: Partial<ApiTask> = { id: "t1", status: "running" };

      expect(resolveAgentVisualState(agent, runningTask as ApiTask)).toBe("WORKING");

      const planningTask: Partial<ApiTask> = { id: "t2", status: "planning" };
      expect(resolveAgentVisualState(agent, planningTask as ApiTask)).toBe("WORKING");
    });

    it("should resolve to WAITING_APPROVAL when approval is pending or task is waiting approval", () => {
      const agent = { status: "idle" };
      const waitingTask: Partial<ApiTask> = { id: "t3", status: "waiting_approval" };

      expect(resolveAgentVisualState(agent, waitingTask as ApiTask)).toBe("WAITING_APPROVAL");
      expect(resolveAgentVisualState(agent, null, true)).toBe("WAITING_APPROVAL");
    });

    it("should resolve to BLOCKED when task is failed or agent is in error", () => {
      const errorAgent = { status: "error" };
      expect(resolveAgentVisualState(errorAgent, null)).toBe("BLOCKED");

      const idleAgent = { status: "idle" };
      const failedTask: Partial<ApiTask> = { id: "t4", status: "failed" };
      expect(resolveAgentVisualState(idleAgent, failedTask as ApiTask)).toBe("BLOCKED");
    });

    it("should resolve to OFFLINE only when supported by actual backend status", () => {
      const offlineAgent = { status: "offline" };
      expect(resolveAgentVisualState(offlineAgent, null)).toBe("OFFLINE");
    });

    it("should resolve to IDLE when agent is idle and no active task exists", () => {
      const idleAgent = { status: "idle" };
      expect(resolveAgentVisualState(idleAgent, null)).toBe("IDLE");

      // When task is completed, agent returns to IDLE
      const completedTask: Partial<ApiTask> = { id: "t5", status: "completed" };
      expect(resolveAgentVisualState(idleAgent, completedTask as ApiTask)).toBe("IDLE");
    });

    it("should resolve to UNKNOWN when data is missing or ambiguous", () => {
      expect(resolveAgentVisualState(null, null)).toBe("UNKNOWN");
      expect(resolveAgentVisualState(undefined, null)).toBe("UNKNOWN");
      expect(resolveAgentVisualState({ status: "unknown_weird_status" }, null)).toBe("UNKNOWN");
    });
  });

  describe("B. One-Way State Bridge (worldStore -> sceneStore)", () => {
    it("should project business agents and tasks from worldStore into sceneStore", () => {
      const bridge = StateBridge.getInstance();
      const stopBridge = bridge.start();

      expect(bridge.isActive()).toBe(true);

      // Populate worldStore with real backend entities
      useWorldStore.setState({
        agents: {
          "agent_ceo": {
            id: "agent_ceo",
            name: "Victoria Vance",
            role: "CEO",
            station: "desk_exec_1",
            status: "idle",
            color: "#3b82f6",
            appearance: "executive-ceo",
            position: [0, 0, -10],
          },
          "agent_eng": {
            id: "agent_eng",
            name: "David Chen",
            role: "Engineering Lead",
            station: "desk_eng_1",
            status: "working",
            color: "#10b981",
            appearance: "engineer-lead",
            position: [-10, 0, 5],
          },
        },
        activeTasks: {
          "task_prod_1": {
            id: "task_prod_1",
            title: "Compile Core Kernel",
            description: "Kernel compile",
            status: "running",
            priority: "high",
            assigned_agent_id: "agent_eng",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      });

      // Verify sceneStore projection
      const visuals = useSceneStore.getState().agentVisuals;
      expect(visuals["agent_ceo"]).toBeDefined();
      expect(visuals["agent_ceo"].presentationState).toBe("IDLE");
      expect(visuals["agent_ceo"].position).toEqual([0, 0, -10]);

      expect(visuals["agent_eng"]).toBeDefined();
      expect(visuals["agent_eng"].presentationState).toBe("WORKING");
      expect(visuals["agent_eng"].activityLabel).toBe("Compile Core Kernel");

      stopBridge();
      expect(bridge.isActive()).toBe(false);
    });

    it("should cleanly stop subscription without memory leaks or repeated executions", () => {
      const bridge = StateBridge.getInstance();
      const stopBridge = bridge.start();

      stopBridge();
      expect(bridge.isActive()).toBe(false);

      // Mutate worldStore after bridge stopped
      useWorldStore.setState({
        agents: {
          "agent_new": {
            id: "agent_new",
            name: "New Agent",
            role: "Specialist",
            station: "desk_new_1",
            color: "#6366f1",
            appearance: "operations-lead",
            status: "idle",
            position: [1, 2, 3],
          },
        },
      });

      // sceneStore should NOT be updated because bridge was stopped
      const visuals = useSceneStore.getState().agentVisuals;
      expect(visuals["agent_new"]).toBeUndefined();
    });

    it("should prevent duplicate subscriptions when start() is called multiple times", () => {
      const bridge = StateBridge.getInstance();
      const stop1 = bridge.start();
      const stop2 = bridge.start();

      expect(bridge.isActive()).toBe(true);

      stop1();
      expect(bridge.isActive()).toBe(false);
    });

    it("should NOT mutate worldStore business records when sceneStore updates", () => {
      const bridge = StateBridge.getInstance();
      bridge.start();

      const initialWorldAgents = {
        "agent_fin": {
          id: "agent_fin",
          name: "Julian Thorne",
          role: "Financial Controller",
          station: "desk_fin_1",
          color: "#f59e0b",
          appearance: "finance-lead",
          status: "idle" as const,
          position: [5, 0, 5] as [number, number, number],
        },
      };

      useWorldStore.setState({ agents: initialWorldAgents, activeTasks: {} });

      // Animate/transform in sceneStore
      useSceneStore.getState().setAgentVisual("agent_fin", {
        position: [99, 99, 99],
        rotationY: 1.57,
      });

      // Verify sceneStore updated
      expect(useSceneStore.getState().agentVisuals["agent_fin"].position).toEqual([99, 99, 99]);

      // Verify worldStore was strictly PRESERVED and NOT mutated by presentation layer!
      expect(useWorldStore.getState().agents["agent_fin"].position).toEqual([5, 0, 5]);
      expect(useWorldStore.getState().agents["agent_fin"].status).toBe("idle");
    });
  });
});
