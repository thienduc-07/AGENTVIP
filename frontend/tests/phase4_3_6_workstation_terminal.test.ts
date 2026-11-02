import { describe, it, expect, beforeEach } from "vitest";
import {
  useWorkstationStore,
  MAX_TERMINAL_BUFFER_LINES,
} from "../store/workstationStore";
import {
  ApiTerminalLine,
  ApiToolActivity,
  ApiFileOperation,
  ApiExecution,
} from "../types/workstation";

describe("Phase 4.3.6: Workstation Screen & Live Terminal", () => {
  beforeEach(() => {
    useWorkstationStore.getState().resetWorkstationState();
  });

  // =========================================================================
  // 1. WORKSTATION STORE NAVIGATION & MODAL CONTROLS
  // =========================================================================
  describe("1. Workstation Store Navigation & Modal Controls", () => {
    it("should open workstation screen and set selected agent", () => {
      const store = useWorkstationStore.getState();
      expect(store.isWorkstationScreenOpen).toBe(false);
      expect(store.selectedAgentId).toBeNull();

      store.openWorkstationScreen("agent-lead-01");

      const updated = useWorkstationStore.getState();
      expect(updated.isWorkstationScreenOpen).toBe(true);
      expect(updated.selectedAgentId).toBe("agent-lead-01");
      expect(updated.errorMessage).toBeNull();
    });

    it("should close workstation screen and clean up selection", () => {
      const store = useWorkstationStore.getState();
      store.openWorkstationScreen("agent-lead-01");
      expect(useWorkstationStore.getState().isWorkstationScreenOpen).toBe(true);

      store.closeWorkstationScreen();
      const closed = useWorkstationStore.getState();
      expect(closed.isWorkstationScreenOpen).toBe(false);
      expect(closed.selectedAgentId).toBeNull();
    });

    it("should allow switching between all 5 workstation tabs", () => {
      const store = useWorkstationStore.getState();
      expect(store.activeTab).toBe("terminal");

      store.setActiveTab("activity");
      expect(useWorkstationStore.getState().activeTab).toBe("activity");

      store.setActiveTab("files");
      expect(useWorkstationStore.getState().activeTab).toBe("files");

      store.setActiveTab("overview");
      expect(useWorkstationStore.getState().activeTab).toBe("overview");

      store.setActiveTab("details");
      expect(useWorkstationStore.getState().activeTab).toBe("details");

      store.setActiveTab("terminal");
      expect(useWorkstationStore.getState().activeTab).toBe("terminal");
    });

    it("should toggle and set autoscroll state", () => {
      const store = useWorkstationStore.getState();
      expect(store.autoScrollEnabled).toBe(true);

      store.toggleAutoScroll();
      expect(useWorkstationStore.getState().autoScrollEnabled).toBe(false);

      store.setAutoScroll(true);
      expect(useWorkstationStore.getState().autoScrollEnabled).toBe(true);
    });
  });

  // =========================================================================
  // 2. TERMINAL BUFFER MANAGEMENT & BOUNDED RING CAPACITY
  // =========================================================================
  describe("2. Terminal Buffer Management & Bounded Capacity", () => {
    it("should append terminal lines and maintain sequence order", () => {
      const store = useWorkstationStore.getState();
      const line1: ApiTerminalLine = {
        id: "line_01",
        execution_id: "exec_01",
        sequence_number: 1,
        stream: "stdout",
        content: "Initializing runtime environment...",
        timestamp: "2026-11-03T00:00:00Z",
      };
      const line2: ApiTerminalLine = {
        id: "line_02",
        execution_id: "exec_01",
        sequence_number: 2,
        stream: "stdout",
        content: "Loading specialist configuration...",
        timestamp: "2026-11-03T00:00:01Z",
      };

      store.appendTerminalLine(line1);
      store.appendTerminalLine(line2);

      const state = useWorkstationStore.getState();
      expect(state.terminalLines).toHaveLength(2);
      expect(state.terminalLines[0].content).toBe("Initializing runtime environment...");
      expect(state.terminalLines[1].content).toBe("Loading specialist configuration...");
    });

    it("should deduplicate lines with the same ID or execution sequence number", () => {
      const store = useWorkstationStore.getState();
      const line: ApiTerminalLine = {
        id: "line_dup_01",
        execution_id: "exec_01",
        sequence_number: 10,
        stream: "stdout",
        content: "Executing task step 1",
        timestamp: "2026-11-03T00:00:00Z",
      };

      store.appendTerminalLine(line);
      store.appendTerminalLine(line); // Duplicate

      const state = useWorkstationStore.getState();
      expect(state.terminalLines).toHaveLength(1);
    });

    it("should strictly cap terminal buffer at MAX_TERMINAL_BUFFER_LINES (1000 lines)", () => {
      const store = useWorkstationStore.getState();
      const totalToAppend = 1050;

      for (let i = 1; i <= totalToAppend; i++) {
        store.appendTerminalLine({
          id: `line_${i}`,
          execution_id: "exec_stress",
          sequence_number: i,
          stream: "stdout",
          content: `Streaming output line ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      const state = useWorkstationStore.getState();
      expect(state.terminalLines).toHaveLength(MAX_TERMINAL_BUFFER_LINES);
      expect(state.terminalLines.length).toBe(1000);
      // The oldest 50 lines should have been evicted; first line should have sequence_number 51
      expect(state.terminalLines[0].sequence_number).toBe(51);
      expect(state.terminalLines[MAX_TERMINAL_BUFFER_LINES - 1].sequence_number).toBe(1050);
    });

    it("should clear the terminal buffer on clearTerminalBuffer", () => {
      const store = useWorkstationStore.getState();
      store.appendTerminalLine({
        id: "line_temp",
        execution_id: "exec_01",
        sequence_number: 1,
        stream: "stdout",
        content: "Temporary output",
        timestamp: new Date().toISOString(),
      });
      expect(useWorkstationStore.getState().terminalLines).toHaveLength(1);

      store.clearTerminalBuffer();
      expect(useWorkstationStore.getState().terminalLines).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3. TOOL ACTIVITY TRACKING & STATE UPDATES
  // =========================================================================
  describe("3. Tool Activity Tracking & Invariants", () => {
    it("should record tool start and update on completion", () => {
      const store = useWorkstationStore.getState();
      const toolCall: ApiToolActivity = {
        tool_call_id: "call_web_01",
        tool_name: "web_search",
        status: "RUNNING",
        arguments: { query: "PROVIPAGENT architecture" },
        started_at: "2026-11-03T00:00:00Z",
      };

      store.upsertToolActivity(toolCall);
      expect(useWorkstationStore.getState().toolActivities).toHaveLength(1);
      expect(useWorkstationStore.getState().toolActivities[0].status).toBe("RUNNING");

      // Update to SUCCEEDED
      store.upsertToolActivity({
        ...toolCall,
        status: "SUCCEEDED",
        result_summary: "Found 12 matching architectural blueprints",
        duration_ms: 340,
        completed_at: "2026-11-03T00:00:01Z",
      });

      const updated = useWorkstationStore.getState();
      expect(updated.toolActivities).toHaveLength(1);
      expect(updated.toolActivities[0].status).toBe("SUCCEEDED");
      expect(updated.toolActivities[0].duration_ms).toBe(340);
      expect(updated.toolActivities[0].result_summary).toContain("Found 12 matching");
    });

    it("should record tool failure with error message", () => {
      const store = useWorkstationStore.getState();
      const toolCall: ApiToolActivity = {
        tool_call_id: "call_fail_01",
        tool_name: "bash",
        status: "RUNNING",
        started_at: "2026-11-03T00:00:00Z",
      };

      store.upsertToolActivity(toolCall);
      store.upsertToolActivity({
        ...toolCall,
        status: "FAILED",
        error_message: "Command timed out after 30s",
        duration_ms: 30000,
      });

      const updated = useWorkstationStore.getState();
      expect(updated.toolActivities[0].status).toBe("FAILED");
      expect(updated.toolActivities[0].error_message).toBe("Command timed out after 30s");
    });
  });

  // =========================================================================
  // 4. FILE OPERATIONS LOGGING
  // =========================================================================
  describe("4. File Operations Logging", () => {
    it("should record file write and edit operations", () => {
      const store = useWorkstationStore.getState();
      const op1: ApiFileOperation = {
        path: "src/agents/planner.py",
        operation: "write",
        size_bytes: 4096,
        timestamp: "2026-11-03T00:00:00Z",
        summary: "Created planner component",
      };
      const op2: ApiFileOperation = {
        path: "src/agents/planner.py",
        operation: "edit",
        size_bytes: 4500,
        timestamp: "2026-11-03T00:01:00Z",
        summary: "Added error handling",
      };

      store.addFileOperation(op1);
      store.addFileOperation(op2);

      const state = useWorkstationStore.getState();
      expect(state.fileOperations).toHaveLength(2);
      expect(state.fileOperations[0].operation).toBe("edit"); // Most recent prepended
      expect(state.fileOperations[1].operation).toBe("write");
    });
  });

  // =========================================================================
  // 5. AGENT STATUS & CONNECTION TELEMETRY
  // =========================================================================
  describe("5. Agent Status & Connection Telemetry", () => {
    it("should update agent status and behavioral state", () => {
      const store = useWorkstationStore.getState();
      store.openWorkstationScreen("agent-dev-01");

      useWorkstationStore.setState({
        workstationDetail: {
          agent_id: "agent-dev-01",
          agent_name: "Dev Specialist",
          agent_role: "Software Engineer",
          agent_status: "idle",
          behavioral_state: "IDLE",
          recent_terminal_lines: [],
          recent_events: [],
        },
      });

      store.updateAgentStatus("working", "WORKING");

      const state = useWorkstationStore.getState();
      expect(state.workstationDetail?.agent_status).toBe("working");
      expect(state.workstationDetail?.behavioral_state).toBe("WORKING");
    });

    it("should update connection status indicator", () => {
      const store = useWorkstationStore.getState();
      expect(store.connectionStatus).toBe("disconnected");

      store.setConnectionStatus("connecting");
      expect(useWorkstationStore.getState().connectionStatus).toBe("connecting");

      store.setConnectionStatus("connected");
      expect(useWorkstationStore.getState().connectionStatus).toBe("connected");
    });
  });
});
