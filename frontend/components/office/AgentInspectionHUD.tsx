"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  User,
  Monitor,
  Activity,
  Play,
  Pause,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Compass,
  FileText,
  History,
  ShieldAlert,
  Loader2,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { ApiAgentInspection, ApiApproval, ApiEvent } from "@/types/api";
import { CanonicalAgentState, CANONICAL_STATE_CONFIGS } from "@/types/office";
import { getAgentInspection } from "@/lib/api/agents";
import { pauseTask, resumeTask } from "@/lib/api/tasks";
import { decideApproval } from "@/lib/api/approvals";
import { syncManager } from "@/lib/websocket/syncManager";
import { EventEnvelope } from "@/types/events";

interface AgentInspectionHUDProps {
  agentId: string | null;
  onClose: () => void;
  onFocusWorkstation?: (workstationId: string) => void;
  onFocusAgent?: (agentId: string) => void;
}

export default function AgentInspectionHUD({
  agentId,
  onClose,
  onFocusWorkstation,
  onFocusAgent,
}: AgentInspectionHUDProps) {
  const [data, setData] = useState<ApiAgentInspection | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "task" | "events">("overview");
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [operatorGuidance, setOperatorGuidance] = useState<string>("");

  const isMountedRef = useRef<boolean>(true);

  // 1. Authoritative Data Hydration
  const fetchInspection = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getAgentInspection(id);
      if (isMountedRef.current) {
        setData(res);
        setIsLoading(false);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err?.message || "Không thể tải dữ liệu kiểm tra đặc vụ");
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (agentId) {
      fetchInspection(agentId);
    } else {
      setData(null);
    }
    return () => {
      isMountedRef.current = false;
    };
  }, [agentId, fetchInspection]);

  // 2. Real-Time WebSocket Event Ingestion
  useEffect(() => {
    if (!agentId) return;

    const unsubEvent = syncManager.onEvent((envelope: EventEnvelope) => {
      if (!isMountedRef.current || !data) return;

      const { event_type, agent_id: evAgentId, task_id: evTaskId, payload } = envelope;

      // Match event to this agent or its active task
      const matchesAgent = evAgentId === agentId || payload?.agent_id === agentId;
      const matchesTask = data.current_task && (evTaskId === data.current_task.id || payload?.task_id === data.current_task.id);

      if (!matchesAgent && !matchesTask) return;

      // Reactively reconcile state
      if (event_type === "task.paused") {
        setData((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            status: "PAUSED",
            current_task: prev.current_task ? { ...prev.current_task, status: "paused" } : null,
          };
        });
      } else if (event_type === "task.resumed") {
        setData((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            status: "WORKING",
            current_task: prev.current_task ? { ...prev.current_task, status: "running" } : null,
          };
        });
      } else if (event_type === "approval.created") {
        setData((prev) => {
          if (!prev) return null;
          const newAppr: ApiApproval = {
            id: payload?.approval_id || `appr_${Date.now()}`,
            task_id: evTaskId || prev.current_task?.id || "",
            action_type: payload?.action_type || "execute_protected_action",
            description: payload?.description || "Phê duyệt cấp quyền thao tác bảo vệ",
            status: "pending",
            requested_at: new Date().toISOString(),
          };
          return {
            ...prev,
            status: "WAITING_APPROVAL",
            pending_approvals: [...prev.pending_approvals, newAppr],
          };
        });
      } else if (
        event_type === "approval.decided" ||
        event_type === "approval.approved" ||
        event_type === "approval.rejected"
      ) {
        const decidedId = payload?.approval_id;
        setData((prev) => {
          if (!prev) return null;
          const remaining = prev.pending_approvals.filter((a) => a.id !== decidedId);
          return {
            ...prev,
            status: remaining.length > 0 ? "WAITING_APPROVAL" : "WORKING",
            pending_approvals: remaining,
          };
        });
      } else if (event_type === "agent.status_changed") {
        const nextStatus = (payload?.status || payload?.operational_status || "IDLE").toUpperCase();
        setData((prev) => (prev ? { ...prev, status: nextStatus } : null));
      } else if (event_type === "task.completed" || event_type === "task.failed" || event_type === "task.cancelled") {
        // Refresh full state on terminal lifecycle event
        fetchInspection(agentId);
      }
    });

    // Reconnection handling: re-fetch authoritative state when connection recovers
    const unsubState = syncManager.onStateChange((state) => {
      if (state === "CONNECTED" && agentId) {
        fetchInspection(agentId);
      }
    });

    return () => {
      unsubEvent();
      unsubState();
    };
  }, [agentId, data, fetchInspection]);

  // 3. Action Handlers
  const handlePauseTask = async () => {
    if (!data?.current_task) return;
    setActionPending("pause");
    setActionNotice(null);
    try {
      await pauseTask(data.current_task.id, "Tạm dừng từ 3D HUD");
      setActionNotice({ type: "success", text: "Nhiệm vụ đã được tạm dừng thành công" });
      if (agentId) fetchInspection(agentId);
    } catch (err: any) {
      setActionNotice({ type: "error", text: err?.message || "Không thể tạm dừng nhiệm vụ" });
    } finally {
      setActionPending(null);
    }
  };

  const handleResumeTask = async () => {
    if (!data?.current_task) return;
    setActionPending("resume");
    setActionNotice(null);
    try {
      await resumeTask(data.current_task.id, operatorGuidance || undefined);
      setActionNotice({ type: "success", text: "Nhiệm vụ đã được tiếp tục thực thi" });
      setOperatorGuidance("");
      if (agentId) fetchInspection(agentId);
    } catch (err: any) {
      setActionNotice({ type: "error", text: err?.message || "Không thể tiếp tục nhiệm vụ" });
    } finally {
      setActionPending(null);
    }
  };

  const handleDecideApproval = async (approvalId: string, decision: "approved" | "rejected") => {
    setActionPending(approvalId);
    setActionNotice(null);
    try {
      await decideApproval(approvalId, decision, `Quyết định từ 3D HUD: ${decision}`);
      setActionNotice({
        type: "success",
        text: decision === "approved" ? "Đã phê duyệt và auto-resume nhiệm vụ" : "Đã từ chối cấp quyền thao tác",
      });
      if (agentId) fetchInspection(agentId);
    } catch (err: any) {
      setActionNotice({ type: "error", text: err?.message || "Không thể xử lý quyết định phê duyệt" });
    } finally {
      setActionPending(null);
    }
  };

  if (!agentId) return null;

  const canonicalState = (data?.status || "IDLE") as CanonicalAgentState;
  const stateCfg = CANONICAL_STATE_CONFIGS[canonicalState] || CANONICAL_STATE_CONFIGS.IDLE;

  return (
    <div
      className="absolute right-4 top-20 bottom-6 w-96 z-40 pointer-events-auto flex flex-col select-text"
      role="region"
      aria-label="Agent Inspection HUD"
    >
      <div className="w-full h-full rounded-2xl bg-slate-950/90 border border-slate-800 shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden animate-in slide-in-from-right-6 duration-200">
        {/* Top Header */}
        <div className="px-4 py-3.5 border-b border-slate-800/80 bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <User className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold tracking-wide uppercase text-slate-200">
                AI Employee HUD
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {agentId}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors cursor-pointer"
            aria-label="Đóng bảng kiểm tra"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Loading / Error States */}
        {isLoading && !data && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3">
            <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
            <p className="text-xs text-slate-400">Đang truy xuất trạng thái runtime...</p>
          </div>
        )}

        {error && !data && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3 text-center">
            <AlertTriangle className="w-8 h-8 text-rose-400" />
            <p className="text-xs text-rose-300 font-medium">{error}</p>
            <button
              onClick={() => fetchInspection(agentId)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-600 transition-colors"
            >
              Thử lại
            </button>
          </div>
        )}

        {data && (
          <>
            {/* Agent Profile Summary Card */}
            <div className="p-4 border-b border-slate-800/60 bg-gradient-to-b from-slate-900/40 to-transparent space-y-3">
              <div className="flex items-start gap-3">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-base shadow-lg shrink-0 border"
                  style={{
                    backgroundColor: `${data.color || "#38bdf8"}18`,
                    color: data.color || "#38bdf8",
                    borderColor: `${data.color || "#38bdf8"}40`,
                  }}
                >
                  {data.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold text-sm text-slate-100 truncate">{data.name}</h3>
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-semibold border flex items-center gap-1.5 shrink-0"
                      style={{
                        backgroundColor: `${stateCfg.beaconColor}15`,
                        color: stateCfg.beaconColor,
                        borderColor: `${stateCfg.beaconColor}40`,
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{ backgroundColor: stateCfg.beaconColor }}
                      />
                      {data.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 truncate mt-0.5">{data.role}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800/90 text-slate-300 border border-slate-700 font-medium">
                      {data.department}
                    </span>
                    <span
                      className={`text-[10px] font-medium flex items-center gap-1 ${
                        data.is_available ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          data.is_available ? "bg-emerald-400" : "bg-amber-400"
                        }`}
                      />
                      {data.is_available ? "Sẵn sàng" : "Đang bận"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Workstation Badge & Camera Focus */}
              {data.workstation ? (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <Monitor className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-slate-300 font-mono text-[11px] truncate">
                      {data.workstation.logical_workstation_id} (Bàn #{data.workstation.desk_number ?? "V"})
                    </span>
                  </div>
                  {onFocusWorkstation && (
                    <button
                      onClick={() => onFocusWorkstation(data.workstation!.logical_workstation_id)}
                      className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800 hover:bg-emerald-900/80 text-[10px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                      title="Di chuyển camera đến bàn làm việc"
                    >
                      <Compass className="w-3 h-3" />
                      <span>Focus</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="p-2 rounded-lg bg-slate-900/40 border border-slate-800/60 text-[11px] text-slate-400 italic">
                  Chưa gán bàn làm việc cố định
                </div>
              )}
            </div>

            {/* Action Feedback Notice */}
            {actionNotice && (
              <div
                className={`mx-4 mt-3 p-2.5 rounded-xl border text-xs flex items-center justify-between animate-in fade-in ${
                  actionNotice.type === "success"
                    ? "bg-emerald-950/60 border-emerald-800 text-emerald-200"
                    : "bg-rose-950/60 border-rose-800 text-rose-200"
                }`}
              >
                <span>{actionNotice.text}</span>
                <button
                  onClick={() => setActionNotice(null)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Navigation Tabs */}
            <div className="px-4 pt-2 border-b border-slate-800/80 flex gap-2 text-xs">
              <button
                onClick={() => setActiveTab("overview")}
                className={`pb-2 font-semibold transition-colors border-b-2 cursor-pointer ${
                  activeTab === "overview"
                    ? "text-sky-400 border-sky-400"
                    : "text-slate-400 border-transparent hover:text-slate-200"
                }`}
              >
                Tổng Quan
              </button>
              <button
                onClick={() => setActiveTab("task")}
                className={`pb-2 font-semibold transition-colors border-b-2 cursor-pointer relative ${
                  activeTab === "task"
                    ? "text-sky-400 border-sky-400"
                    : "text-slate-400 border-transparent hover:text-slate-200"
                }`}
              >
                Nhiệm Vụ
                {data.current_task && (
                  <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[9px] bg-sky-900/60 text-sky-300 font-mono">
                    1
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("events")}
                className={`pb-2 font-semibold transition-colors border-b-2 cursor-pointer ${
                  activeTab === "events"
                    ? "text-sky-400 border-sky-400"
                    : "text-slate-400 border-transparent hover:text-slate-200"
                }`}
              >
                Nhật Ký ({data.recent_events.length})
              </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-slate-300">
              {/* TAB 1: OVERVIEW */}
              {activeTab === "overview" && (
                <>
                  {/* Pending Approvals Section (If Any) */}
                  {data.pending_approvals.length > 0 && (
                    <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 space-y-2">
                      <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs">
                        <ShieldAlert className="w-4 h-4 text-amber-400" />
                        <span>Yêu Cầu Phê Duyệt Cấp Quyền ({data.pending_approvals.length})</span>
                      </div>
                      {data.pending_approvals.map((appr) => (
                        <div
                          key={appr.id}
                          className="p-2.5 rounded-lg bg-slate-900/80 border border-amber-900/60 space-y-2"
                        >
                          <div className="text-[11px] font-semibold text-slate-200">
                            {appr.action_type}
                          </div>
                          <p className="text-[10px] text-slate-400 leading-relaxed">
                            {appr.description}
                          </p>
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => handleDecideApproval(appr.id, "approved")}
                              disabled={actionPending === appr.id}
                              className="flex-1 py-1 px-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[10px] transition-colors flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              {actionPending === appr.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <CheckCircle className="w-3 h-3" />
                              )}
                              <span>Phê Duyệt</span>
                            </button>
                            <button
                              onClick={() => handleDecideApproval(appr.id, "rejected")}
                              disabled={actionPending === appr.id}
                              className="flex-1 py-1 px-2.5 rounded bg-rose-600/80 hover:bg-rose-600 text-white font-semibold text-[10px] transition-colors flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              <XCircle className="w-3 h-3" />
                              <span>Từ Chối</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Specialist Description */}
                  {data.description && (
                    <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/60 space-y-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                        Chuyên Môn & Năng Lực
                      </span>
                      <p className="text-slate-300 leading-relaxed text-[11px]">{data.description}</p>
                    </div>
                  )}

                  {/* Runtime Telemetry Metrics */}
                  <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/60 space-y-2">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                      Thông Số Vận Hành
                    </span>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="p-2 rounded bg-slate-950/60 border border-slate-800/80">
                        <span className="text-slate-500 block text-[9px]">Vị trí 3D (X, Z)</span>
                        <span className="font-mono text-slate-200">
                          {data.pos_x.toFixed(1)}, {data.pos_z.toFixed(1)}m
                        </span>
                      </div>
                      <div className="p-2 rounded bg-slate-950/60 border border-slate-800/80">
                        <span className="text-slate-500 block text-[9px]">Thời gian thực thi</span>
                        <span className="font-mono text-slate-200">
                          {data.current_task_duration_seconds !== null && data.current_task_duration_seconds !== undefined
                            ? `${data.current_task_duration_seconds.toFixed(0)}s`
                            : "0s"}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* TAB 2: ACTIVE TASK */}
              {activeTab === "task" && (
                <div className="space-y-3">
                  {data.current_task ? (
                    <>
                      <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold text-slate-100 text-xs leading-snug">
                            {data.current_task.title}
                          </h4>
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-semibold uppercase ${
                              data.current_task.status === "paused"
                                ? "bg-amber-950 text-amber-300 border border-amber-800"
                                : "bg-blue-950 text-blue-300 border border-blue-800"
                            }`}
                          >
                            {data.current_task.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {data.current_task.description}
                        </p>
                        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                          <span>Task ID: {data.current_task.id}</span>
                          <span>Đã thực hiện: {data.current_task_steps_count} bước</span>
                        </div>
                      </div>

                      {/* Task Action Bar */}
                      <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/60 space-y-2">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                          Thao Tác Tự Trị (Human-in-the-Loop)
                        </span>

                        {data.current_task.status === "paused" ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={operatorGuidance}
                              onChange={(e) => setOperatorGuidance(e.target.value)}
                              placeholder="Nhập chỉ dẫn cho đặc vụ khi tiếp tục..."
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
                            />
                            <button
                              onClick={handleResumeTask}
                              disabled={actionPending === "resume"}
                              className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              {actionPending === "resume" ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Play className="w-3.5 h-3.5 fill-current" />
                              )}
                              <span>Tiếp Tục Thực Thi (Resume)</span>
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={handlePauseTask}
                            disabled={actionPending === "pause"}
                            className="w-full py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            {actionPending === "pause" ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Pause className="w-3.5 h-3.5 fill-current" />
                            )}
                            <span>Tạm Dừng Nhiệm Vụ (Pause)</span>
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="p-8 text-center text-slate-500 space-y-2">
                      <FileText className="w-8 h-8 mx-auto text-slate-600" />
                      <p className="text-xs">Hiện không có nhiệm vụ active đang thực thi</p>
                      <p className="text-[10px] text-slate-600">Đặc vụ đang ở trạng thái rảnh rỗi (IDLE)</p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: ACTIVITY LOG */}
              {activeTab === "events" && (
                <div className="space-y-2">
                  {data.recent_events.length > 0 ? (
                    data.recent_events.map((ev) => (
                      <div
                        key={ev.id}
                        className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80 space-y-1"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-sky-400 font-mono">
                            {ev.event_type}
                          </span>
                          <span className="text-[9px] text-slate-500 font-mono">
                            {new Date(ev.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                        {ev.payload_json && (
                          <div className="text-[10px] text-slate-400 font-mono bg-slate-950/60 p-1.5 rounded overflow-x-auto">
                            {JSON.stringify(ev.payload_json)}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-slate-500 space-y-2">
                      <History className="w-8 h-8 mx-auto text-slate-600" />
                      <p className="text-xs">Chưa có nhật ký hoạt động nào gần đây</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Footer Telemetry */}
            <div className="px-4 py-2.5 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between text-[10px] text-slate-400">
              <span>PROVIPAGENT v4.3.3 Enterprise</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Live Runtime Sync
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

