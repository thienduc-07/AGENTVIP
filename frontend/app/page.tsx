"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import WorldCanvas from "@/components/world/WorldCanvas";
import WorldHUD from "@/components/interface/WorldHUD";
import AgentInfoPanel from "@/components/interface/AgentInfoPanel";
import AreaInfoPanel from "@/components/interface/AreaInfoPanel";
import WorldControlsHelp from "@/components/interface/WorldControlsHelp";
import MissionControl from "@/components/hud/MissionControl";
import CaptainApprovalModal from "@/components/hud/CaptainApprovalModal";
import TaskHistoryModal from "@/components/hud/TaskHistoryModal";
import TaskCreateModal from "@/components/interface/TaskCreateModal";
import { MemoryCenterModal } from "@/components/hud/MemoryCenterModal";
import { ToolCenterModal } from "@/components/hud/ToolCenterModal";
import InteractiveMissionTerminal from "@/components/hud/InteractiveMissionTerminal";
import CorporateAgentDock from "@/components/interface/CorporateAgentDock";
import { useWorldStore } from "@/store/worldStore";
import { Agent, EventLog, PendingAction, Task } from "@/types";
import { getAgents } from "@/lib/api/agents";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || (API_BASE.replace(/^http/, "ws") + "/api/v1/events/ws");

export default function CorporateHQ3DWorldPage() {
  const syncAgentsFromBackend = useWorldStore((s) => s.syncAgentsFromBackend);
  const setBackendStatus = useWorldStore((s) => s.setBackendStatus);
  const backendConnection = useWorldStore((s) => s.backendConnection);
  const backendError = useWorldStore((s) => s.backendError);
  const updateAgentStatus = useWorldStore((s) => s.updateAgentStatus);
  const setLiveConnected = useWorldStore((s) => s.setLiveConnected);
  const selectedAgentId = useWorldStore((s) => s.selectedAgentId);
  const activeInfoPanel = useWorldStore((s) => s.activeInfoPanel);
  const agents = useWorldStore((s) => s.agents);
  const applySnapshot = useWorldStore((s) => s.applySnapshot);
  const applyEvent = useWorldStore((s) => s.applyEvent);

  // Mission & Execution State
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isMissionDrawerOpen, setIsMissionDrawerOpen] = useState<boolean>(false);
  const [isTaskCreateOpen, setIsTaskCreateOpen] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isDecidingApproval, setIsDecidingApproval] = useState<boolean>(false);
  const [isLoadingTask, setIsLoadingTask] = useState<boolean>(false);
  const [isFetchingAgents, setIsFetchingAgents] = useState<boolean>(true);

  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Initial Data Fetch from FastAPI backend
  useEffect(() => {
    fetchAgents();
    checkPendingApprovals();
  }, []);

  const fetchAgents = async () => {
    setIsFetchingAgents(true);
    setBackendStatus("connecting", null);
    try {
      const data = await getAgents();
      syncAgentsFromBackend(data);
      setBackendStatus("connected", null);
    } catch (err: any) {
      console.warn("Backend API not reachable:", err);
      setBackendStatus("error", err?.message || "Không thể kết nối tới backend");
    } finally {
      setIsFetchingAgents(false);
    }
  };

  const handleEnableDemoMode = () => {
    setBackendStatus("demo_fallback", null);
  };

  const checkPendingApprovals = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/approvals/pending`);
      if (res.ok) {
        const list: PendingAction[] = await res.json();
        if (list.length > 0) {
          setPendingAction(list[0]);
        }
      }
    } catch (err) {
      // Ignore
    }
  };

  // Start polling fallback when WebSocket is down
  const startPollingFallback = useCallback(() => {
    if (pollingIntervalRef.current) return;
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const list = await getAgents();
        syncAgentsFromBackend(list);
      } catch (e) {
        // Fallback polling network error
      }
    }, 4000);
  }, [syncAgentsFromBackend]);

  const stopPollingFallback = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // 2. WebSocket Realtime Sync Engine with Reconnect & Replay
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const ws = new WebSocket(WS_BASE);
        wsRef.current = ws;

        ws.onopen = () => {
          retryCountRef.current = 0;
          setLiveConnected(true);
          setBackendStatus("connected", null);
          stopPollingFallback();

          // Start 15s Heartbeat Ping
          if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ action: "ping", timestamp: Date.now() }));
            }
          }, 15000);

          // Request replay for missed events if reconnected with prior cursor
          const currentSeq = useWorldStore.getState().lastSequenceId;
          if (currentSeq > 0) {
            ws.send(JSON.stringify({ action: "replay", last_sequence_id: currentSeq }));
          }
        };

        ws.onclose = () => {
          setLiveConnected(false);
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }

          // Exponential backoff with jitter
          const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current) + Math.random() * 500, 10000);
          retryCountRef.current += 1;
          setBackendStatus("reconnecting", `Reconnecting in ${(delay / 1000).toFixed(1)}s...`);

          // Activate polling fallback while disconnected
          startPollingFallback();

          reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
        };

        ws.onerror = () => {
          setLiveConnected(false);
          startPollingFallback();
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            handleWsMessage(msg);
          } catch (e) {
            console.error("WS Parse error:", e);
          }
        };
      } catch (err) {
        setLiveConnected(false);
        startPollingFallback();
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 4000);
      }
    };

    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      stopPollingFallback();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [stopPollingFallback, startPollingFallback]);

  const handleWsMessage = useCallback((msg: any) => {
    // 1. Authoritative Initial / Resync Snapshot
    if (msg.message_type === "snapshot" && msg.data) {
      applySnapshot(msg.data, msg.last_sequence_id || 0);
      return;
    }

    // 2. Standardized Event Envelope
    if (msg.message_type === "event" && msg.event) {
      const envelope = msg.event;
      applyEvent(envelope);

      // Append to Mission Control live log feed
      const newEvent: EventLog = {
        id: envelope.event_id,
        task_id: envelope.task_id || "",
        agent_id: envelope.agent_id || "",
        event_type: envelope.event_type.toUpperCase().replace(/\./g, "_"),
        payload: envelope.payload || {},
        timestamp: envelope.occurred_at || new Date().toISOString(),
      };
      setEvents((prev) => [...prev, newEvent]);

      if (envelope.event_type === "approval.required") {
        setPendingAction(envelope.payload);
      } else if (envelope.event_type === "task.completed") {
        setIsLoadingTask(false);
        confetti({
          particleCount: 85,
          spread: 65,
          origin: { y: 0.8 },
          colors: ["#f59e0b", "#fbbf24", "#38bdf8", "#10b981"],
        });
      } else if (envelope.event_type === "task.cancelled" || envelope.event_type === "task.failed") {
        setIsLoadingTask(false);
      }
      return;
    }

    // 3. Backward-compatibility handlers
    const { type, data } = msg;
    if (type === "init_state" && data?.agents) {
      syncAgentsFromBackend(data.agents);
    } else if (type === "agent_status") {
      const statusStr = data.status;
      let mapped = "idle";
      if (statusStr === "THINKING" || statusStr === "EXECUTING_TOOL") mapped = "working";
      else if (statusStr === "AWAITING_APPROVAL") mapped = "waiting_approval";
      else if (statusStr === "FAILED") mapped = "error";
      else mapped = "idle";
      updateAgentStatus(data.agent_id, mapped as any);
    } else if (type === "approval_required") {
      setPendingAction(data);
    } else if (type === "task_completed") {
      setIsLoadingTask(false);
      confetti({
        particleCount: 85,
        spread: 65,
        origin: { y: 0.8 },
        colors: ["#f59e0b", "#fbbf24", "#38bdf8", "#10b981"],
      });
    } else if (type === "task_cancelled") {
      setIsLoadingTask(false);
    }
  }, [applySnapshot, applyEvent, syncAgentsFromBackend, updateAgentStatus]);

  // 3. User Task Submission via Authoritative REST API
  const handleSubmitTask = async (agentId: string, promptText: string) => {
    setIsLoadingTask(true);
    setEvents([]);

    try {
      const res = await fetch(`${API_BASE}/api/v1/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: promptText.slice(0, 60),
          description: promptText,
          assigned_agent_id: agentId,
          priority: "high",
        }),
      });

      if (res.ok) {
        const created: any = await res.json();
        setActiveTask(created);
        setIsMissionDrawerOpen(true);
        if (agentId !== "agent-captain-roger") {
          useWorldStore
            .getState()
            .triggerTaskHandoff(
              "agent-captain-roger",
              agentId,
              "Gomu Gomu no Bajrang Gun",
              promptText.slice(0, 45)
            );
        }
      } else {
        setIsLoadingTask(false);
      }
    } catch (e) {
      console.error("Task dispatch failed:", e);
      setIsLoadingTask(false);
    }
  };

  const handleSubmitWorkflow = async (title: string, description: string) => {
    setIsLoadingTask(true);
    setEvents([]);

    try {
      const res = await fetch(`${API_BASE}/api/v1/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.slice(0, 120),
          description: description,
          assigned_agent_id: "agent-captain-roger",
          priority: "high",
        }),
      });

      if (res.ok) {
        const created: any = await res.json();
        useWorldStore.getState().setActiveWorkflow(created);
        setIsMissionDrawerOpen(true);
        // Victoria Vance (CEO) initiates workflow orchestrator dispatch to David Chen (Engineering)
        useWorldStore
          .getState()
          .triggerTaskHandoff(
            "agent-exec-ceo",
            "agent-eng-lead",
            "Executive Governance & Strategy",
            title.slice(0, 45)
          );
      } else {
        setIsLoadingTask(false);
      }
    } catch (e) {
      console.error("Workflow dispatch failed:", e);
      setIsLoadingTask(false);
    }
  };

  const handleApprovalDecision = async (
    actionId: string,
    decision: "APPROVE" | "REJECT"
  ) => {
    setIsDecidingApproval(true);
    try {
      const res = await fetch(`${API_BASE}/api/approvals/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action_id: actionId,
          decision: decision,
        }),
      });
      if (res.ok) {
        setPendingAction(null);
      }
    } catch (e) {
      console.error("Approval decision error:", e);
    } finally {
      setIsDecidingApproval(false);
    }
  };

  const currentSelectedAgent = selectedAgentId ? agents[selectedAgentId] : null;

  // Convert AgentCharacterData to Agent for MissionControl compatibility
  const selectedAgentForMission: Agent | null = currentSelectedAgent
    ? {
        id: currentSelectedAgent.id,
        name: currentSelectedAgent.name,
        role: currentSelectedAgent.role,
        station: currentSelectedAgent.station,
        status: currentSelectedAgent.status === "working" ? "EXECUTING_TOOL" : "IDLE",
        pos_x: currentSelectedAgent.position[0],
        pos_y: currentSelectedAgent.position[1],
        pos_z: currentSelectedAgent.position[2],
        color: currentSelectedAgent.color,
        avatar: currentSelectedAgent.appearance,
        description: currentSelectedAgent.description,
      }
    : null;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#070b14]">
      {/* Top Glassmorphic Navigation HUD */}
      <WorldHUD
        onToggleMissionDrawer={() => setIsMissionDrawerOpen((prev) => !prev)}
        isMissionDrawerOpen={isMissionDrawerOpen}
        onOpenTaskModal={() => setIsTaskCreateOpen(true)}
      />

      {/* Backend Offline / Error Toast Banner */}
      {backendConnection === "error" && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-xl bg-rose-950/90 border border-rose-500/50 text-rose-200 text-xs shadow-xl flex items-center gap-3 backdrop-blur-md">
          <span className="font-semibold text-rose-300">⚠️ Không kết nối được Backend FastAPI (Port 8000)</span>
          <button
            onClick={fetchAgents}
            disabled={isFetchingAgents}
            className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/40 text-rose-200 text-[11px] font-bold uppercase transition-colors"
          >
            {isFetchingAgents ? "Đang kết nối..." : "Thử lại"}
          </button>
          <button
            onClick={handleEnableDemoMode}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition-colors"
          >
            Chế độ Demo
          </button>
        </div>
      )}

      {/* Demo Mode Notice */}
      {backendConnection === "demo_fallback" && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 px-3 py-1 rounded-full bg-amber-950/80 border border-amber-500/40 text-amber-300 text-[11px] shadow-lg flex items-center gap-2 backdrop-blur-md">
          <span>⚡ Chế độ xem trước Demo (Dữ liệu cục bộ)</span>
          <button
            onClick={fetchAgents}
            className="underline text-amber-400 hover:text-amber-200 font-semibold"
          >
            Thử kết nối lại
          </button>
        </div>
      )}

      {/* 3D World Scene */}
      <WorldCanvas />

      {/* Dynamic Right Side Panels */}
      {activeInfoPanel === "agent" && (
        <AgentInfoPanel
          onOpenMissionDispatcher={() => setIsMissionDrawerOpen(true)}
          onOpenTaskModal={() => setIsTaskCreateOpen(true)}
        />
      )}

      {activeInfoPanel === "area" && <AreaInfoPanel />}

      {/* Collapsible Mission Control Terminal Drawer */}
      {isMissionDrawerOpen && (
        <MissionControl
          selectedAgent={selectedAgentForMission}
          activeTask={activeTask}
          events={events}
          onSubmitTask={handleSubmitTask}
          onSubmitWorkflow={handleSubmitWorkflow}
          isLoading={isLoadingTask}
        />
      )}

      {/* Realtime 3D Mission Terminal with Anthropic Skills, Chat & Artifacts */}
      <InteractiveMissionTerminal />

      {/* Minimalist 3D Controls Help at Bottom Left */}
      <WorldControlsHelp />

      {/* Corporate Leadership Quick Switcher Dock */}
      <CorporateAgentDock />

      {/* Executive Board Authorization Modal (High Risk Sandbox Action) */}
      <CaptainApprovalModal
        pendingAction={pendingAction}
        onDecide={handleApprovalDecision}
        isDeciding={isDecidingApproval}
      />

      {/* Task Creation Modal (Milestone 3) */}
      <TaskCreateModal
        isOpen={isTaskCreateOpen}
        onClose={() => setIsTaskCreateOpen(false)}
        defaultAgentId={selectedAgentId}
      />

      {/* Task History Archives Modal */}
      <TaskHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        apiBaseUrl={API_BASE}
      />

      {/* Grand Line Archives & Memory Center Modal (Milestone 7) */}
      <MemoryCenterModal />

      {/* Grand Line Tool Ecosystem & Skills Foundry (Milestone 8) */}
      <ToolCenterModal />
    </main>
  );
}
