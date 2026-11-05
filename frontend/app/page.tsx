"use client";

import React, { useState, useEffect, useCallback } from "react";
import confetti from "canvas-confetti";
import MyOfficeDiorama from "@/components/office/MyOfficeDiorama";
import CaptainApprovalModal from "@/components/hud/CaptainApprovalModal";
import TaskHistoryModal from "@/components/hud/TaskHistoryModal";
import TaskCreateModal from "@/components/interface/TaskCreateModal";
import { MemoryCenterModal } from "@/components/hud/MemoryCenterModal";
import { ToolCenterModal } from "@/components/hud/ToolCenterModal";
import SpecialistRecruitmentModal from "@/components/hud/SpecialistRecruitmentModal";
import InteractiveMissionTerminal from "@/components/hud/InteractiveMissionTerminal";
import { useWorldStore } from "@/store/worldStore";
import { PendingAction, Task, EventLog } from "@/types";
import { getAgents } from "@/lib/api/agents";
import { ensureAuthenticatedSession } from "@/lib/api/client";
import { createTask } from "@/lib/api/tasks";
import { syncManager } from "@/lib/websocket/syncManager";
import { stateBridge } from "@/lib/stateBridge";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (typeof window !== "undefined" ? "" : "http://localhost:8000");

const AGENT_MAPPING: Record<string, string> = {
  leo: "agent-eng-lead",
  mina: "agent-fin-controller",
  hana: "agent-mkt-growth",
  victor: "agent-exec-ceo",
};

export default function CorporateHQ3DWorldPage() {
  const syncAgentsFromBackend = useWorldStore((s) => s.syncAgentsFromBackend);
  const setBackendStatus = useWorldStore((s) => s.setBackendStatus);
  const backendConnection = useWorldStore((s) => s.backendConnection);
  const setLiveConnected = useWorldStore((s) => s.setLiveConnected);
  const selectedAgentId = useWorldStore((s) => s.selectedAgentId);
  const applySnapshot = useWorldStore((s) => s.applySnapshot);
  const applyEvent = useWorldStore((s) => s.applyEvent);

  // Mission & Execution State
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isTaskCreateOpen, setIsTaskCreateOpen] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isDecidingApproval, setIsDecidingApproval] = useState<boolean>(false);
  const [isLoadingTask, setIsLoadingTask] = useState<boolean>(false);

  // 1. Initial Data Fetch from FastAPI backend
  useEffect(() => {
    let isMounted = true;
    const initBackend = async () => {
      setBackendStatus("connecting", null);
      try {
        await ensureAuthenticatedSession();
        if (!isMounted) return;
        const data = await getAgents();
        if (!isMounted) return;
        syncAgentsFromBackend(data);
        setBackendStatus("connected", null);
        syncManager.connect();
      } catch (err: any) {
        console.warn("Backend API not reachable:", err);
        setBackendStatus("error", err?.message || "Không thể kết nối tới backend");
      }
      checkPendingApprovals();
    };

    initBackend();

    return () => {
      isMounted = false;
    };
  }, []);

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

  // 2. Real-Time Event Synchronization Engine
  useEffect(() => {
    const unsubSnapshot = syncManager.onSnapshot((snapshot) => {
      applySnapshot(snapshot.data, snapshot.last_sequence_id);
    });

    const unsubEvent = syncManager.onEvent((envelope) => {
      const newEvent: EventLog = {
        id: envelope.event_id,
        task_id: envelope.task_id || "",
        agent_id: envelope.agent_id || "",
        event_type: envelope.event_type.toUpperCase().replace(/\./g, "_"),
        payload: envelope.payload || {},
        timestamp: envelope.occurred_at || new Date().toISOString(),
      };
      setEvents((prev) => [...prev, newEvent]);

      if (envelope.event_type === "approval.required" || envelope.event_type === "tool.awaiting_approval") {
        setPendingAction(envelope.payload as any);
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
    });

    const unsubState = syncManager.onStateChange((state, error) => {
      if (state === "CONNECTED") {
        setLiveConnected(true);
        setBackendStatus("connected", null);
      } else if (state === "RECONNECTING" || state === "CONNECTING") {
        setLiveConnected(false);
        setBackendStatus(state === "CONNECTING" ? "connecting" : "reconnecting", error);
      } else if (state === "ERROR") {
        setLiveConnected(false);
        setBackendStatus("error", error);
      } else {
        setLiveConnected(false);
      }
    });

    const stopBridge = stateBridge.start();

    return () => {
      unsubSnapshot();
      unsubEvent();
      unsubState();
      syncManager.disconnect();
      stopBridge();
    };
  }, [applySnapshot, applyEvent, setLiveConnected, setBackendStatus]);

  // 3. User Task Submission via Authoritative REST API with apiClient Auth
  const handleSubmitTask = async (agentId: string, promptText: string) => {
    setIsLoadingTask(true);
    setEvents([]);

    const backendAgentId = AGENT_MAPPING[agentId] || agentId;

    try {
      const created = await createTask({
        title: promptText.slice(0, 60),
        description: promptText,
        assigned_agent_id: backendAgentId,
        priority: "high",
      });

      setActiveTask(created as any);
      setIsLoadingTask(false);
      return created;
    } catch (e) {
      console.warn("Task dispatch note:", e);
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

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#070b14]">
      {/* 3D Diorama Multi-Floor HQ with Instant 1:1 Camera, Elevator & Smart Auto-Router Chat */}
      <MyOfficeDiorama
        onSubmitTask={handleSubmitTask}
        backendStatus={backendConnection}
      />

      {/* Realtime 3D Mission Terminal with Anthropic Skills, Chat & Artifacts */}
      <InteractiveMissionTerminal />

      {/* Executive Board Authorization Modal (High Risk Sandbox Action) */}
      <CaptainApprovalModal
        pendingAction={pendingAction}
        onDecide={handleApprovalDecision}
        isDeciding={isDecidingApproval}
      />

      {/* Task Creation Modal */}
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

      {/* Grand Line Archives & Memory Center Modal */}
      <MemoryCenterModal />

      {/* Grand Line Tool Ecosystem & Skills Foundry */}
      <ToolCenterModal />

      {/* Specialist Recruitment & Talent Hub */}
      <SpecialistRecruitmentModal />
    </main>
  );
}
