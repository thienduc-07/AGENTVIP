import { useWorldStore } from "@/store/worldStore";
import { useSceneStore, AgentVisualNode, AgentVisualPresentationState } from "@/store/sceneStore";
import { ApiTask } from "@/types/api";

/**
 * Deterministically resolves the presentation state of an agent
 * strictly from authoritative backend data.
 *
 * Never fabricates state. Returns UNKNOWN when data is missing or ambiguous.
 */
export function resolveAgentVisualState(
  agent: { status?: string | null; last_seen_at?: string | null } | null | undefined,
  assignedTask?: ApiTask | { status?: string | null } | null,
  isPendingApproval: boolean = false
): AgentVisualPresentationState {
  if (!agent) {
    return "UNKNOWN";
  }

  // Check explicit approval gates first
  if (isPendingApproval || assignedTask?.status === "waiting_approval" || agent.status === "waiting_approval") {
    return "WAITING_APPROVAL";
  }

  // Check error / blocked states
  if (assignedTask?.status === "failed" || agent.status === "error") {
    return "BLOCKED";
  }

  // Check active working states
  if (
    assignedTask?.status === "running" ||
    assignedTask?.status === "planning" ||
    agent.status === "working"
  ) {
    return "WORKING";
  }

  // Check offline status
  if (agent.status === "offline") {
    return "OFFLINE";
  }

  // Check idle / available status
  if (agent.status === "idle") {
    return "IDLE";
  }

  // If status is unrecognized or insufficient data to differentiate
  return "UNKNOWN";
}

export class StateBridge {
  private static instance: StateBridge | null = null;
  private unsubscribeWorldStore: (() => void) | null = null;
  private isRunning: boolean = false;
  private lastAgentsRef: Record<string, any> | null = null;
  private lastTasksRef: Record<string, ApiTask> | null = null;

  private constructor() {}

  public static getInstance(): StateBridge {
    if (!StateBridge.instance) {
      StateBridge.instance = new StateBridge();
    }
    return StateBridge.instance;
  }

  public start(): () => void {
    if (this.isRunning && this.unsubscribeWorldStore) {
      // Prevent duplicate subscriptions
      return () => this.stop();
    }

    this.isRunning = true;

    // Perform immediate initial projection
    this.projectWorldToScene(useWorldStore.getState());

    // Subscribe to business state updates from worldStore
    this.unsubscribeWorldStore = useWorldStore.subscribe((state) => {
      this.projectWorldToScene(state);
    });

    return () => this.stop();
  }

  public stop(): void {
    if (this.unsubscribeWorldStore) {
      this.unsubscribeWorldStore();
      this.unsubscribeWorldStore = null;
    }
    this.isRunning = false;
    this.lastAgentsRef = null;
    this.lastTasksRef = null;
  }

  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * One-way projection: worldStore -> stateBridge -> sceneStore
   * Strictly reads worldStore and writes presentation projection to sceneStore.
   * Never mutates worldStore.
   */
  public projectWorldToScene(worldState: {
    agents: Record<string, any>;
    activeTasks: Record<string, ApiTask>;
  }): void {
    const { agents, activeTasks } = worldState;

    // Strict reference and mutation guard:
    // If neither agents nor activeTasks references changed, skip projection completely
    // This prevents chat messages, modals, or tab switches in worldStore from triggering sceneStore recalculations.
    if (this.lastAgentsRef === agents && this.lastTasksRef === activeTasks) {
      return;
    }
    this.lastAgentsRef = agents;
    this.lastTasksRef = activeTasks;

    // Index active tasks by assigned agent ID for O(1) lookup
    const agentTasksMap: Record<string, ApiTask> = {};
    Object.values(activeTasks || {}).forEach((task) => {
      if (task.assigned_agent_id) {
        agentTasksMap[task.assigned_agent_id] = task;
      }
    });


    const nextVisuals: Record<string, AgentVisualNode> = {};

    Object.values(agents || {}).forEach((agent) => {
      if (!agent || !agent.id) return;

      const assignedTask = agentTasksMap[agent.id] || null;
      const presentationState = resolveAgentVisualState(agent, assignedTask);

      const pos: [number, number, number] = Array.isArray(agent.position) && agent.position.length === 3
        ? [agent.position[0], agent.position[1], agent.position[2]]
        : [agent.pos_x ?? 0, agent.pos_y ?? 0, agent.pos_z ?? 0];

      nextVisuals[agent.id] = {
        agentId: agent.id,
        presentationState,
        position: pos,
        rotationY: 0,
        assignedWorkstationId: agent.station || null,
        activityLabel: assignedTask?.title || agent.currentTask || null,
        lastUpdated: Date.now(),
      };
    });

    // Authoritative update to sceneStore
    useSceneStore.getState().setBatchAgentVisuals(nextVisuals);
  }
}

export const stateBridge = StateBridge.getInstance();
