import { create } from "zustand";

export type AgentVisualPresentationState =
  | "IDLE"
  | "WORKING"
  | "WAITING_APPROVAL"
  | "BLOCKED"
  | "OFFLINE"
  | "UNKNOWN";

export interface AgentVisualNode {
  agentId: string;
  presentationState: AgentVisualPresentationState;
  position: [number, number, number];
  rotationY: number;
  assignedWorkstationId: string | null;
  activityLabel: string | null;
  lastUpdated: number;
}

export interface WorkstationTransform {
  workstationId: string;
  department: string;
  zone: string;
  deskNumber: number;
  position: [number, number, number];
  rotationY: number;
  isOccupied: boolean;
  occupantAgentId: string | null;
}

export interface SceneState {
  agentVisuals: Record<string, AgentVisualNode>;
  workstationTransforms: Record<string, WorkstationTransform>;
  selectedEntityId: string | null;
  hoveredEntityId: string | null;
  cameraTarget: [number, number, number];
  cameraPosition: [number, number, number];

  // Actions
  setAgentVisual: (agentId: string, partial: Partial<AgentVisualNode>) => void;
  setBatchAgentVisuals: (visuals: Record<string, AgentVisualNode>) => void;
  setWorkstationTransforms: (transforms: Record<string, WorkstationTransform>) => void;
  setWorkstationOccupant: (workstationId: string, agentId: string | null) => void;
  selectEntity: (id: string | null) => void;
  hoverEntity: (id: string | null) => void;
  setCameraTarget: (target: [number, number, number]) => void;
  setCameraPosition: (pos: [number, number, number]) => void;
  resetScene: () => void;
}

const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, 1.2, 0];
const DEFAULT_CAMERA_POSITION: [number, number, number] = [0, 12, 22];

export const useSceneStore = create<SceneState>((set) => ({
  agentVisuals: {},
  workstationTransforms: {},
  selectedEntityId: null,
  hoveredEntityId: null,
  cameraTarget: DEFAULT_CAMERA_TARGET,
  cameraPosition: DEFAULT_CAMERA_POSITION,

  setAgentVisual: (agentId, partial) =>
    set((state) => {
      const existing = state.agentVisuals[agentId] || {
        agentId,
        presentationState: "UNKNOWN",
        position: [0, 0, 0],
        rotationY: 0,
        assignedWorkstationId: null,
        activityLabel: null,
        lastUpdated: Date.now(),
      };
      return {
        agentVisuals: {
          ...state.agentVisuals,
          [agentId]: {
            ...existing,
            ...partial,
            lastUpdated: Date.now(),
          },
        },
      };
    }),

  setBatchAgentVisuals: (visuals) =>
    set({
      agentVisuals: visuals,
    }),

  setWorkstationTransforms: (transforms) =>
    set({
      workstationTransforms: transforms,
    }),

  setWorkstationOccupant: (workstationId, agentId) =>
    set((state) => {
      const existing = state.workstationTransforms[workstationId];
      if (!existing) return state;
      return {
        workstationTransforms: {
          ...state.workstationTransforms,
          [workstationId]: {
            ...existing,
            isOccupied: agentId !== null,
            occupantAgentId: agentId,
          },
        },
      };
    }),

  selectEntity: (id) => set({ selectedEntityId: id }),
  hoverEntity: (id) => set({ hoveredEntityId: id }),
  setCameraTarget: (target) => set({ cameraTarget: target }),
  setCameraPosition: (pos) => set({ cameraPosition: pos }),

  resetScene: () =>
    set({
      agentVisuals: {},
      workstationTransforms: {},
      selectedEntityId: null,
      hoveredEntityId: null,
      cameraTarget: DEFAULT_CAMERA_TARGET,
      cameraPosition: DEFAULT_CAMERA_POSITION,
    }),
}));
