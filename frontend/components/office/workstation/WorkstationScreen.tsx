"use client";

import React, { useEffect } from "react";
import {
  X,
  Terminal as TerminalIcon,
  Wrench,
  FileCode,
  LayoutDashboard,
  Info,
  Activity,
  Cpu,
  Coins,
  FileText,
  Clock,
  Radio,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import { useWorkstationStore } from "@/store/workstationStore";
import { useWorkstationSync } from "@/hooks/useWorkstationSync";
import LiveTerminal from "./LiveTerminal";
import ToolActivityMonitor from "./ToolActivityMonitor";
import { WorkstationScreenTab } from "@/types/workstation";

interface WorkstationScreenProps {
  organizationId?: string;
  onClose?: () => void;
}

export default function WorkstationScreen({
  organizationId = "org_default_company",
  onClose,
}: WorkstationScreenProps) {
  // Sync hook listens to real-time execution & terminal events
  useWorkstationSync(organizationId);

  const {
    isWorkstationScreenOpen,
    selectedAgentId,
    selectedWorkstationId,
    activeTab,
    workstationDetail,
    activeExecution,
    executionsList,
    terminalLines,
    toolActivities,
    fileOperations,
    autoScrollEnabled,
    connectionStatus,
    isLoading,
    errorMessage,
    setActiveTab,
    toggleAutoScroll,
    clearTerminalBuffer,
    closeWorkstationScreen,
    selectExecution,
  } = useWorkstationStore();

  const handleClose = () => {
    closeWorkstationScreen();
    if (onClose) onClose();
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isWorkstationScreenOpen) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isWorkstationScreenOpen]);

  if (!isWorkstationScreenOpen) return null;

  const agentName = workstationDetail?.agent_name || selectedAgentId || "AI Employee";
  const agentRole = workstationDetail?.agent_role || "Specialist";
  const agentStatus = workstationDetail?.agent_status || "idle";
  const behavioralState = workstationDetail?.behavioral_state || "IDLE";
  const deskNumber = workstationDetail?.workstation?.desk_number;
  const deskZone = workstationDetail?.workstation?.office_zone || workstationDetail?.workstation?.department || "Office";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200 select-text"
      role="dialog"
      aria-label="Workstation Screen"
    >
      <div className="relative flex flex-col w-full max-w-6xl h-[90vh] bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden">
        {/* Top Header Bar */}
        <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-slate-900/95 border-b border-slate-800">
          <div className="flex items-center gap-3">
            {/* Pulsing Status Beacon */}
            <div className="relative flex items-center justify-center">
              <span
                className={`w-3 h-3 rounded-full ${
                  behavioralState === "WORKING" || agentStatus === "working"
                    ? "bg-emerald-400 animate-pulse"
                    : behavioralState === "ERROR"
                    ? "bg-rose-400 animate-ping"
                    : "bg-amber-400"
                }`}
              />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-100">{agentName}</h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {agentRole}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-sky-950 border border-sky-800 text-sky-300 font-mono">
                  Bàn {deskNumber !== undefined ? `#${deskNumber}` : "V"} ({deskZone})
                </span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                <span>Agent ID: {selectedAgentId}</span>
                {workstationDetail?.current_task_title && (
                  <span className="text-emerald-400 truncate max-w-xs">
                    • Nhiệm vụ: {workstationDetail.current_task_title}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Header: Execution selector & Close button */}
          <div className="flex items-center gap-3">
            {/* Executions selector if multiple exist */}
            {executionsList.length > 0 && (
              <div className="relative">
                <select
                  value={activeExecution?.id || ""}
                  onChange={(e) => selectExecution(e.target.value)}
                  className="px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 font-mono cursor-pointer"
                >
                  {executionsList.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.id.substring(0, 14)}... ({ex.status})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Close button */}
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-950 hover:text-rose-400 text-slate-400 border border-slate-700 transition-colors cursor-pointer"
              aria-label="Đóng màn hình làm việc"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Telemetry Stats Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 px-4 py-2 bg-slate-950 border-b border-slate-800 text-xs">
          <div className="flex items-center gap-2 p-1.5 rounded bg-slate-900/50 border border-slate-800/60">
            <Activity className="w-3.5 h-3.5 text-sky-400" />
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Trạng thái</div>
              <div className="font-bold text-slate-200 font-mono">
                {activeExecution?.status || behavioralState}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-1.5 rounded bg-slate-900/50 border border-slate-800/60">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Tổng Tokens</div>
              <div className="font-bold text-slate-200 font-mono">
                {activeExecution?.total_tokens ?? 0}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-1.5 rounded bg-slate-900/50 border border-slate-800/60">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Chi phí ($)</div>
              <div className="font-bold text-slate-200 font-mono">
                ${(activeExecution?.estimated_cost_usd ?? 0).toFixed(4)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-1.5 rounded bg-slate-900/50 border border-slate-800/60">
            <Wrench className="w-3.5 h-3.5 text-emerald-400" />
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Lệnh gọi công cụ</div>
              <div className="font-bold text-slate-200 font-mono">
                {activeExecution?.tool_calls_count ?? toolActivities.length}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-1.5 rounded bg-slate-900/50 border border-slate-800/60">
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Dòng Terminal</div>
              <div className="font-bold text-slate-200 font-mono">
                {terminalLines.length}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-1.5 rounded bg-slate-900/50 border border-slate-800/60">
            <FileCode className="w-3.5 h-3.5 text-purple-400" />
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Tệp xử lý</div>
              <div className="font-bold text-slate-200 font-mono">
                {activeExecution?.files_count ?? fileOperations.length}
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center px-4 bg-slate-900/80 border-b border-slate-800 gap-1">
          <button
            onClick={() => setActiveTab("terminal")}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === "terminal"
                ? "border-emerald-500 text-emerald-400 bg-slate-800/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <TerminalIcon className="w-4 h-4" />
            <span>Terminal</span>
          </button>

          <button
            onClick={() => setActiveTab("activity")}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === "activity"
                ? "border-sky-500 text-sky-400 bg-slate-800/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Wrench className="w-4 h-4" />
            <span>Công cụ ({toolActivities.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("files")}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === "files"
                ? "border-purple-500 text-purple-400 bg-slate-800/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <FileCode className="w-4 h-4" />
            <span>Tệp ({fileOperations.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("overview")}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === "overview"
                ? "border-amber-500 text-amber-400 bg-slate-800/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Tổng quan</span>
          </button>

          <button
            onClick={() => setActiveTab("details")}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === "details"
                ? "border-slate-400 text-slate-200 bg-slate-800/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Info className="w-4 h-4" />
            <span>Chi tiết JSON</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 p-3 overflow-hidden bg-slate-950">
          {activeTab === "terminal" && (
            <LiveTerminal
              lines={terminalLines}
              autoScrollEnabled={autoScrollEnabled}
              onToggleAutoScroll={toggleAutoScroll}
              onClearBuffer={clearTerminalBuffer}
              agentName={agentName}
              executionId={activeExecution?.id}
            />
          )}

          {activeTab === "activity" && (
            <ToolActivityMonitor
              activities={toolActivities}
              isLoading={isLoading}
            />
          )}

          {activeTab === "files" && (
            <div className="flex flex-col h-full bg-slate-950/90 text-slate-100 rounded-lg border border-slate-800 overflow-hidden">
              <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                <span className="font-semibold text-xs text-slate-200">
                  NHẬT KÝ THAO TÁC TỆP (FILE OPERATIONS)
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {fileOperations.length} tệp
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {fileOperations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 py-12">
                    <FileCode className="w-8 h-8 opacity-40" />
                    <p className="italic text-xs">Chưa có thao tác đọc/ghi tệp nào trong phiên này.</p>
                  </div>
                ) : (
                  fileOperations.map((file, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
                            file.operation === "write" || file.operation === "edit"
                              ? "bg-purple-950 border border-purple-800 text-purple-300"
                              : "bg-cyan-950 border border-cyan-800 text-cyan-300"
                          }`}
                        >
                          {file.operation}
                        </span>
                        <span className="font-mono text-slate-200 truncate">
                          {file.path}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-slate-400 text-[11px] shrink-0 font-mono">
                        {file.size_bytes !== undefined && (
                          <span>{file.size_bytes} bytes</span>
                        )}
                        <span>{new Date(file.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === "overview" && (
            <div className="flex flex-col h-full overflow-y-auto p-4 space-y-4 text-xs bg-slate-950">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-2">
                  <h3 className="font-bold text-slate-200 text-sm">Thông tin Nhân sự & Bàn làm việc</h3>
                  <div className="space-y-1.5 text-slate-300 font-mono text-[11px]">
                    <div>Tên: <span className="text-white font-semibold">{agentName}</span></div>
                    <div>Chức vụ: <span className="text-sky-300">{agentRole}</span></div>
                    <div>ID Nhân sự: <span className="text-slate-400">{selectedAgentId}</span></div>
                    <div>Bàn làm việc: <span className="text-emerald-400">{selectedWorkstationId || "Virtual Desk"}</span></div>
                    <div>Khu vực: <span className="text-slate-300">{deskZone}</span></div>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-2">
                  <h3 className="font-bold text-slate-200 text-sm">Phiên thực thi hiện tại</h3>
                  {activeExecution ? (
                    <div className="space-y-1.5 text-slate-300 font-mono text-[11px]">
                      <div>Execution ID: <span className="text-white">{activeExecution.id}</span></div>
                      <div>Trạng thái: <span className="text-emerald-400 uppercase font-bold">{activeExecution.status}</span></div>
                      <div>Bắt đầu lúc: <span className="text-slate-400">{new Date(activeExecution.started_at).toLocaleString()}</span></div>
                      {activeExecution.completed_at && (
                        <div>Hoàn thành lúc: <span className="text-slate-400">{new Date(activeExecution.completed_at).toLocaleString()}</span></div>
                      )}
                      <div>Tokens Prompt / Completion: <span className="text-indigo-300">{activeExecution.prompt_tokens} / {activeExecution.completion_tokens}</span></div>
                    </div>
                  ) : (
                    <div className="text-slate-500 italic py-2">Chưa có phiên thực thi nào đang chạy.</div>
                  )}
                </div>
              </div>

              {workstationDetail?.recent_events && workstationDetail.recent_events.length > 0 && (
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-2">
                  <h3 className="font-bold text-slate-200 text-sm">Sự kiện gần đây ({workstationDetail.recent_events.length})</h3>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto font-mono text-[11px]">
                    {workstationDetail.recent_events.map((evt) => (
                      <div key={evt.id} className="flex items-center justify-between p-2 rounded bg-slate-950/60 border border-slate-800/80">
                        <span className="text-sky-400 font-semibold">{evt.event_type}</span>
                        <span className="text-slate-300 truncate max-w-md">{evt.message}</span>
                        <span className="text-slate-500 text-[10px]">{new Date(evt.created_at).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "details" && (
            <div className="h-full overflow-y-auto p-4 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs">
              <pre className="text-emerald-400 whitespace-pre-wrap break-all">
                {JSON.stringify(
                  {
                    workstationDetail,
                    activeExecution,
                    executionsCount: executionsList.length,
                    terminalLinesCount: terminalLines.length,
                    toolActivitiesCount: toolActivities.length,
                    fileOperationsCount: fileOperations.length,
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </div>

        {/* Bottom Status Bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-900/90 border-t border-slate-800 text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                connectionStatus === "connected"
                  ? "bg-emerald-400"
                  : connectionStatus === "connecting"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-rose-400"
              }`}
            />
            <span className="uppercase text-[10px] tracking-wide">
              WEBSOCKET: {connectionStatus}
            </span>
            <span className="text-slate-600">|</span>
            <span>Vùng đệm: {terminalLines.length} / 1000 dòng</span>
          </div>

          <div className="flex items-center gap-3">
            {activeExecution?.id && (
              <span className="text-slate-500 truncate">
                Phiên: {activeExecution.id}
              </span>
            )}
            <span className="text-slate-600">|</span>
            <span>Nhấn Esc để đóng</span>
          </div>
        </div>
      </div>
    </div>
  );
}
