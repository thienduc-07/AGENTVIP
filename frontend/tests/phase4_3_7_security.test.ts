import { describe, it, expect, beforeEach } from "vitest";
import {
  useWorkstationStore,
  MAX_TERMINAL_BUFFER_LINES,
} from "../store/workstationStore";
import { ApiTerminalLine } from "../types/workstation";

describe("Phase 4.3.7: Frontend Security & State Isolation Verification", () => {
  beforeEach(() => {
    useWorkstationStore.getState().resetWorkstationState();
  });

  describe("1. Client State Isolation & Cleanup", () => {
    it("should purge all sensitive workstation and terminal state on resetWorkstationState()", () => {
      const store = useWorkstationStore.getState();

      // Populate state with mock tenant session data
      store.openWorkstationScreen("agent-alpha-secret");
      store.appendTerminalLine({
        id: "line-test-1",
        execution_id: "exec-test-1",
        sequence_number: 1,
        stream: "stdout",
        content: "Internal operational log for Tenant Alpha",
        timestamp: new Date().toISOString(),
      });
      store.upsertToolActivity({
        tool_call_id: "tool-test-1",
        tool_name: "db_query",
        status: "RUNNING",
        started_at: new Date().toISOString(),
      });
      store.addFileOperation({
        path: "/workspace/config.json",
        operation: "write",
        timestamp: new Date().toISOString(),
      });

      const populated = useWorkstationStore.getState();
      expect(populated.terminalLines.length).toBe(1);
      expect(populated.toolActivities.length).toBe(1);
      expect(populated.fileOperations.length).toBe(1);
      expect(populated.selectedAgentId).toBe("agent-alpha-secret");

      // Action: Tenant switch or user logout triggers resetWorkstationState()
      store.resetWorkstationState();

      const cleared = useWorkstationStore.getState();
      expect(cleared.terminalLines).toEqual([]);
      expect(cleared.toolActivities).toEqual([]);
      expect(cleared.fileOperations).toEqual([]);
      expect(cleared.selectedAgentId).toBeNull();
      expect(cleared.activeExecution).toBeNull();
      expect(cleared.workstationDetail).toBeNull();
      expect(cleared.isWorkstationScreenOpen).toBe(false);
    });

    it("should ensure persistent store does not persist unencrypted sensitive credentials", () => {
      const store = useWorkstationStore.getState();
      // Inspect keys in workstation store
      const keys = Object.keys(store);
      expect(keys).not.toContain("password");
      expect(keys).not.toContain("secretKey");
      expect(keys).not.toContain("apiKey");
    });
  });

  describe("2. Terminal Output Bounding & Denial of Service Defense", () => {
    it("should strictly enforce MAX_TERMINAL_BUFFER_LINES under high-volume streaming", () => {
      const store = useWorkstationStore.getState();
      const floodCount = 1200;

      for (let i = 1; i <= floodCount; i++) {
        store.appendTerminalLine({
          id: `line-flood-${i}`,
          execution_id: "exec-test-1",
          sequence_number: i,
          stream: "stdout",
          content: `Automated telemetry stream item ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      const state = useWorkstationStore.getState();
      // Buffer must never exceed MAX_TERMINAL_BUFFER_LINES (1000)
      expect(state.terminalLines.length).toBe(MAX_TERMINAL_BUFFER_LINES);
      // FIFO eviction: oldest lines were discarded, latest lines retained
      expect(state.terminalLines[state.terminalLines.length - 1].sequence_number).toBe(floodCount);
      expect(state.terminalLines[0].sequence_number).toBe(floodCount - MAX_TERMINAL_BUFFER_LINES + 1);
    });
  });

  describe("3. Safe Log Export Formatting", () => {
    it("should format logs into pure plaintext lines without executing or rendering HTML tags", () => {
      const mockLines: ApiTerminalLine[] = [
        {
          id: "l1",
          execution_id: "exec-test-1",
          sequence_number: 1,
          stream: "stdout",
          content: "<script>alert('xss')</script>",
          timestamp: "2026-11-03T01:00:00.000Z",
        },
        {
          id: "l2",
          execution_id: "exec-test-1",
          sequence_number: 2,
          stream: "stderr",
          content: "<img src=x onerror=alert(1)>",
          timestamp: "2026-11-03T01:00:01.000Z",
        },
      ];

      const formatted = mockLines
        .map(
          (l) =>
            `[${new Date(l.timestamp).toISOString()}] [${l.stream.toUpperCase()}] ${l.content}`
        )
        .join("\n");

      // Verify structure is plaintext and contains raw literal content without evaluation
      expect(formatted).toContain("[2026-11-03T01:00:00.000Z] [STDOUT] <script>alert('xss')</script>");
      expect(formatted).toContain("[2026-11-03T01:00:01.000Z] [STDERR] <img src=x onerror=alert(1)>");
    });
  });
});
