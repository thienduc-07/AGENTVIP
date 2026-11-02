import { create } from "zustand";
import {
  ApiExecution,
  ApiTerminalLine,
  ApiToolActivity,
  ApiFileOperation,
  WorkstationLiveDetail,
  WorkstationScreenTab,
} from "@/types/workstation";
import {
  getWorkstation,
  getWorkstationExecutions,
  getWorkstationTerminal,
  getExecution,
  getExecutionTerminal,
} from "@/lib/api/workstations";

export const MAX_TERMINAL_BUFFER_LINES = 1000;

export interface WorkstationState {
  // Navigation & Selection
  selectedAgentId: string | null;
  selectedWorkstationId: string | null;
  isWorkstationScreenOpen: boolean;
  activeTab: WorkstationScreenTab;

  // Real-time authoritative runtime state
  workstationDetail: WorkstationLiveDetail | null;
  activeExecution: ApiExecution | null;
  executionsList: ApiExecution[];
  terminalLines: ApiTerminalLine[];
  toolActivities: ApiToolActivity[];
  fileOperations: ApiFileOperation[];

  // Viewer options
  autoScrollEnabled: boolean;
  connectionStatus: "connected" | "connecting" | "disconnected";
  isLoading: boolean;
  errorMessage: string | null;

  // Actions
  openWorkstationScreen: (agentOrWsId: string) => void;
  closeWorkstationScreen: () => void;
  setActiveTab: (tab: WorkstationScreenTab) => void;
  toggleAutoScroll: () => void;
  setAutoScroll: (enabled: boolean) => void;
  loadWorkstationData: (
    agentOrWsId: string,
    options?: { token?: string | null; organizationId?: string | null }
  ) => Promise<void>;
  loadExecutionsList: (
    agentOrWsId: string,
    options?: { token?: string | null; organizationId?: string | null }
  ) => Promise<void>;
  selectExecution: (
    executionId: string,
    options?: { token?: string | null; organizationId?: string | null }
  ) => Promise<void>;
  appendTerminalLine: (line: ApiTerminalLine) => void;
  setTerminalLines: (lines: ApiTerminalLine[]) => void;
  clearTerminalBuffer: () => void;
  upsertToolActivity: (activity: ApiToolActivity) => void;
  addFileOperation: (op: ApiFileOperation) => void;
  updateAgentStatus: (status: string, behavioralState?: string) => void;
  setConnectionStatus: (status: "connected" | "connecting" | "disconnected") => void;
  resetWorkstationState: () => void;
}

export const useWorkstationStore = create<WorkstationState>((set, get) => ({
  selectedAgentId: null,
  selectedWorkstationId: null,
  isWorkstationScreenOpen: false,
  activeTab: "terminal",
  workstationDetail: null,
  activeExecution: null,
  executionsList: [],
  terminalLines: [],
  toolActivities: [],
  fileOperations: [],
  autoScrollEnabled: true,
  connectionStatus: "disconnected",
  isLoading: false,
  errorMessage: null,

  openWorkstationScreen: (agentOrWsId: string) => {
    set({
      isWorkstationScreenOpen: true,
      selectedAgentId: agentOrWsId,
      errorMessage: null,
    });
    get().loadWorkstationData(agentOrWsId);
  },

  closeWorkstationScreen: () => {
    set({
      isWorkstationScreenOpen: false,
      selectedAgentId: null,
      selectedWorkstationId: null,
    });
  },

  setActiveTab: (tab: WorkstationScreenTab) => {
    set({ activeTab: tab });
  },

  toggleAutoScroll: () => {
    set((state) => ({ autoScrollEnabled: !state.autoScrollEnabled }));
  },

  setAutoScroll: (enabled: boolean) => {
    set({ autoScrollEnabled: enabled });
  },

  loadWorkstationData: async (agentOrWsId, options) => {
    set({ isLoading: true, errorMessage: null });
    try {
      const detail = await getWorkstation(agentOrWsId, options);
      const activeExec = detail.active_execution || null;

      // Seed terminal lines from recent_terminal_lines
      const lines = [...(detail.recent_terminal_lines || [])].sort(
        (a, b) => a.sequence_number - b.sequence_number
      );

      // Reconstruct tool activities and file operations from recent events if present
      const initialTools: ApiToolActivity[] = [];
      const initialFiles: ApiFileOperation[] = [];

      if (detail.recent_events && detail.recent_events.length > 0) {
        for (const evt of detail.recent_events) {
          if (evt.event_type.startsWith("tool.execution_") || evt.event_type.startsWith("tool_call_")) {
            const payload = evt.payload || {};
            const toolCallId = (payload.tool_call_id as string) || evt.id;
            const toolName = (payload.tool_name as string) || (payload.tool as string) || "tool";
            const status =
              evt.event_type.endsWith("completed") || evt.event_type.endsWith("SUCCEEDED")
                ? "SUCCEEDED"
                : evt.event_type.endsWith("failed") || evt.event_type.endsWith("FAILED")
                ? "FAILED"
                : "RUNNING";

            const existingIdx = initialTools.findIndex((t) => t.tool_call_id === toolCallId);
            const toolItem: ApiToolActivity = {
              tool_call_id: toolCallId,
              tool_name: toolName,
              status,
              arguments: payload.arguments as any,
              result_summary: payload.result_summary as string,
              error_message: payload.error as string,
              duration_ms: payload.duration_ms as number,
              started_at: (payload.started_at as string) || evt.created_at,
              completed_at: payload.completed_at as string,
            };

            if (existingIdx >= 0) {
              initialTools[existingIdx] = { ...initialTools[existingIdx], ...toolItem };
            } else {
              initialTools.push(toolItem);
            }
          } else if (evt.event_type === "file.operation" || evt.event_type === "FILE_OPERATION") {
            const payload = evt.payload || {};
            if (payload.path) {
              initialFiles.push({
                path: String(payload.path),
                operation: (payload.operation as any) || "write",
                size_bytes: payload.size_bytes as number,
                timestamp: evt.created_at,
                summary: payload.summary as string,
              });
            }
          }
        }
      }

      set({
        workstationDetail: detail,
        selectedAgentId: detail.agent_id,
        selectedWorkstationId: detail.workstation?.logical_workstation_id || null,
        activeExecution: activeExec,
        terminalLines: lines.slice(-MAX_TERMINAL_BUFFER_LINES),
        toolActivities: initialTools,
        fileOperations: initialFiles,
        isLoading: false,
      });

      // Also trigger loading execution list in background
      get().loadExecutionsList(detail.agent_id, options);
    } catch (err: any) {
      set({
        isLoading: false,
        errorMessage: err.message || "Failed to load workstation live data",
      });
    }
  },

  loadExecutionsList: async (agentOrWsId, options) => {
    try {
      const res = await getWorkstationExecutions(agentOrWsId, options);
      set({ executionsList: res.items || [] });
    } catch (err) {
      console.warn("Could not load executions list:", err);
    }
  },

  selectExecution: async (executionId, options) => {
    set({ isLoading: true, errorMessage: null });
    try {
      const [execData, terminalData] = await Promise.all([
        getExecution(executionId, options),
        getExecutionTerminal(executionId, { limit: 1000, ...options }),
      ]);

      const sortedLines = (terminalData.lines || []).sort(
        (a, b) => a.sequence_number - b.sequence_number
      );

      set({
        activeExecution: execData,
        terminalLines: sortedLines.slice(-MAX_TERMINAL_BUFFER_LINES),
        isLoading: false,
      });
    } catch (err: any) {
      set({
        isLoading: false,
        errorMessage: err.message || `Failed to load execution ${executionId}`,
      });
    }
  },

  appendTerminalLine: (line: ApiTerminalLine) => {
    set((state) => {
      // Deduplicate by sequence_number or id
      if (
        state.terminalLines.some(
          (l) =>
            l.id === line.id ||
            (l.execution_id === line.execution_id && l.sequence_number === line.sequence_number)
        )
      ) {
        return state;
      }
      const updated = [...state.terminalLines, line];
      return {
        terminalLines: updated.slice(-MAX_TERMINAL_BUFFER_LINES),
      };
    });
  },

  setTerminalLines: (lines: ApiTerminalLine[]) => {
    set({
      terminalLines: lines.slice(-MAX_TERMINAL_BUFFER_LINES),
    });
  },

  clearTerminalBuffer: () => {
    set({ terminalLines: [] });
  },

  upsertToolActivity: (activity: ApiToolActivity) => {
    set((state) => {
      const idx = state.toolActivities.findIndex(
        (t) => t.tool_call_id === activity.tool_call_id
      );
      if (idx >= 0) {
        const next = [...state.toolActivities];
        next[idx] = { ...next[idx], ...activity };
        return { toolActivities: next };
      }
      return { toolActivities: [activity, ...state.toolActivities].slice(0, 100) };
    });
  },

  addFileOperation: (op: ApiFileOperation) => {
    set((state) => ({
      fileOperations: [op, ...state.fileOperations].slice(0, 100),
    }));
  },

  updateAgentStatus: (status: string, behavioralState?: string) => {
    set((state) => {
      if (!state.workstationDetail) return state;
      return {
        workstationDetail: {
          ...state.workstationDetail,
          agent_status: status,
          behavioral_state: behavioralState || state.workstationDetail.behavioral_state,
        },
      };
    });
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },

  resetWorkstationState: () => {
    set({
      selectedAgentId: null,
      selectedWorkstationId: null,
      isWorkstationScreenOpen: false,
      workstationDetail: null,
      activeExecution: null,
      executionsList: [],
      terminalLines: [],
      toolActivities: [],
      fileOperations: [],
      isLoading: false,
      errorMessage: null,
    });
  },
}));
