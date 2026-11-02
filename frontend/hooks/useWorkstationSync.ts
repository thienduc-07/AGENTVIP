"use client";

import { useEffect, useRef, useCallback } from "react";
import { useWorkstationStore } from "@/store/workstationStore";
import { syncManager } from "@/lib/websocket/syncManager";
import { EventEnvelope } from "@/types/events";
import { ApiTerminalLine, ApiToolActivity, ApiFileOperation } from "@/types/workstation";

export function useWorkstationSync(organizationId: string = "org_default_company") {
  const selectedAgentId = useWorkstationStore((s) => s.selectedAgentId);
  const isWorkstationScreenOpen = useWorkstationStore((s) => s.isWorkstationScreenOpen);
  const activeExecution = useWorkstationStore((s) => s.activeExecution);
  const appendTerminalLine = useWorkstationStore((s) => s.appendTerminalLine);
  const upsertToolActivity = useWorkstationStore((s) => s.upsertToolActivity);
  const addFileOperation = useWorkstationStore((s) => s.addFileOperation);
  const updateAgentStatus = useWorkstationStore((s) => s.updateAgentStatus);
  const setConnectionStatus = useWorkstationStore((s) => s.setConnectionStatus);
  const loadWorkstationData = useWorkstationStore((s) => s.loadWorkstationData);

  const selectedAgentIdRef = useRef<string | null>(selectedAgentId);
  const activeExecIdRef = useRef<string | null>(activeExecution?.id || null);

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  useEffect(() => {
    activeExecIdRef.current = activeExecution?.id || null;
  }, [activeExecution?.id]);

  const handleEnvelope = useCallback(
    (envelope: EventEnvelope) => {
      const { event_type, payload, agent_id, execution_id } = envelope as any;
      if (!event_type) return;

      const currentAgentId = selectedAgentIdRef.current;
      const currentExecId = activeExecIdRef.current;

      // Filter events: event must belong to the selected agent or current execution,
      // or payload has matching agent_id or execution_id
      const payloadAgentId = payload?.agent_id || agent_id;
      const payloadExecId = payload?.execution_id || execution_id;

      const isForActiveAgent =
        currentAgentId && (payloadAgentId === currentAgentId || currentAgentId.includes(payloadAgentId));
      const isForActiveExec =
        currentExecId && payloadExecId && currentExecId === payloadExecId;

      // If the screen is open but event is completely for another agent/execution, ignore it
      if (!isForActiveAgent && !isForActiveExec) {
        return;
      }

      // 1. Terminal lines streaming
      if (
        event_type === "terminal.output" ||
        event_type === "TERMINAL_OUTPUT" ||
        event_type === "terminal.error" ||
        event_type === "TERMINAL_ERROR"
      ) {
        const stream =
          event_type.includes("error") || event_type === "TERMINAL_ERROR"
            ? "stderr"
            : (payload?.stream as any) || "stdout";

        const line: ApiTerminalLine = {
          id: envelope.event_id || `term_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          execution_id: payloadExecId || currentExecId || "",
          sequence_number:
            typeof payload?.sequence_number === "number"
              ? payload.sequence_number
              : typeof envelope.sequence_id === "number"
              ? envelope.sequence_id
              : Date.now(),
          stream,
          content: payload?.content || payload?.text || payload?.message || "",
          timestamp: envelope.occurred_at || new Date().toISOString(),
          metadata: payload?.metadata || null,
        };

        appendTerminalLine(line);
      }

      // 2. Execution lifecycle events
      else if (event_type === "execution.started" || event_type === "EXECUTION_STARTED") {
        const newExec = payload?.execution || {
          id: payloadExecId || envelope.event_id,
          organization_id: organizationId,
          agent_id: payloadAgentId || currentAgentId,
          task_id: payload?.task_id || null,
          status: "running",
          started_at: envelope.occurred_at || new Date().toISOString(),
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
          tool_calls_count: 0,
          total_lines: 0,
          files_count: 0,
          created_at: envelope.occurred_at || new Date().toISOString(),
          updated_at: envelope.occurred_at || new Date().toISOString(),
        };

        useWorkstationStore.setState({ activeExecution: newExec });

        appendTerminalLine({
          id: `line_init_${Date.now()}`,
          execution_id: newExec.id,
          sequence_number: 0,
          stream: "system",
          content: `>>> Execution started: ${newExec.id} (Task: ${newExec.task_id || "Direct"})`,
          timestamp: envelope.occurred_at || new Date().toISOString(),
        });
      } else if (
        event_type === "execution.completed" ||
        event_type === "EXECUTION_COMPLETED"
      ) {
        useWorkstationStore.setState((state) => {
          if (!state.activeExecution) return state;
          return {
            activeExecution: {
              ...state.activeExecution,
              status: "completed",
              completed_at: envelope.occurred_at || new Date().toISOString(),
              total_tokens: payload?.total_tokens ?? state.activeExecution.total_tokens,
              estimated_cost_usd:
                payload?.estimated_cost_usd ?? state.activeExecution.estimated_cost_usd,
              summary: payload?.summary ?? state.activeExecution.summary,
            },
          };
        });

        appendTerminalLine({
          id: `line_complete_${Date.now()}`,
          execution_id: payloadExecId || currentExecId || "",
          sequence_number: 999999,
          stream: "system",
          content: `>>> Execution completed successfully. ${payload?.summary ? `[${payload.summary}]` : ""}`,
          timestamp: envelope.occurred_at || new Date().toISOString(),
        });
      } else if (
        event_type === "execution.failed" ||
        event_type === "EXECUTION_FAILED"
      ) {
        useWorkstationStore.setState((state) => {
          if (!state.activeExecution) return state;
          return {
            activeExecution: {
              ...state.activeExecution,
              status: "failed",
              completed_at: envelope.occurred_at || new Date().toISOString(),
              error_message: payload?.error || payload?.message,
            },
          };
        });

        appendTerminalLine({
          id: `line_failed_${Date.now()}`,
          execution_id: payloadExecId || currentExecId || "",
          sequence_number: 999999,
          stream: "stderr",
          content: `>>> Execution failed: ${payload?.error || payload?.message || "Unknown error"}`,
          timestamp: envelope.occurred_at || new Date().toISOString(),
        });
      }

      // 3. Tool activity events
      else if (
        event_type.startsWith("tool.execution_") ||
        event_type.startsWith("tool_call_") ||
        event_type === "TOOL_CALL_STARTED" ||
        event_type === "TOOL_CALL_COMPLETED" ||
        event_type === "TOOL_CALL_FAILED"
      ) {
        const toolCallId =
          payload?.tool_call_id || envelope.event_id || `tc_${Date.now()}`;
        const toolName = payload?.tool_name || payload?.tool || "tool";
        const status =
          event_type.endsWith("completed") || event_type === "TOOL_CALL_COMPLETED"
            ? "SUCCEEDED"
            : event_type.endsWith("failed") || event_type === "TOOL_CALL_FAILED"
            ? "FAILED"
            : "RUNNING";

        const activity: ApiToolActivity = {
          tool_call_id: toolCallId,
          tool_name: toolName,
          status,
          arguments: payload?.arguments,
          result_summary: payload?.result_summary,
          error_message: payload?.error,
          duration_ms: payload?.duration_ms,
          started_at: payload?.started_at || envelope.occurred_at,
          completed_at: status !== "RUNNING" ? envelope.occurred_at : undefined,
        };

        upsertToolActivity(activity);
      }

      // 4. File operations
      else if (event_type === "file.operation" || event_type === "FILE_OPERATION") {
        if (payload?.path) {
          const fileOp: ApiFileOperation = {
            path: String(payload.path),
            operation: (payload.operation as any) || "write",
            size_bytes: payload.size_bytes,
            timestamp: envelope.occurred_at,
            summary: payload.summary || payload.message,
          };
          addFileOperation(fileOp);
        }
      }

      // 5. Agent status update
      else if (event_type === "agent.status_changed" || event_type === "AGENT_STATUS_CHANGED") {
        if (payload?.status) {
          updateAgentStatus(payload.status, payload.behavioral_state);
        }
      }
    },
    [
      organizationId,
      appendTerminalLine,
      upsertToolActivity,
      addFileOperation,
      updateAgentStatus,
    ]
  );

  useEffect(() => {
    if (!isWorkstationScreenOpen || !selectedAgentId) return;

    // Listen to WebSocket events
    const unsubEvent = syncManager.onEvent(handleEnvelope);

    // Track connection state
    const unsubState = syncManager.onStateChange((state) => {
      if (state === "CONNECTED") {
        setConnectionStatus("connected");
        if (selectedAgentIdRef.current) {
          loadWorkstationData(selectedAgentIdRef.current, { organizationId });
        }
      } else if (state === "CONNECTING" || state === "RECONNECTING") {
        setConnectionStatus("connecting");
      } else {
        setConnectionStatus("disconnected");
      }
    });

    return () => {
      unsubEvent();
      unsubState();
    };
  }, [
    isWorkstationScreenOpen,
    selectedAgentId,
    organizationId,
    handleEnvelope,
    setConnectionStatus,
    loadWorkstationData,
  ]);
}
