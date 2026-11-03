"use client";

import React, { useState, useMemo } from "react";
import {
  Building2,
  Users,
  Monitor,
  Activity,
  MessageSquare,
  Search,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Compass,
  Cpu,
  Coffee,
  Sliders,
  Terminal,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
} from "lucide-react";
import { AgentAvatarData } from "./AgentAvatar";
import { WorkstationData } from "./Workstation";
import { CANONICAL_STATE_CONFIGS } from "@/types/office";
import { FLOOR_DEFINITIONS } from "@/lib/office/floorDefinitions";

interface SimulationHUDProps {
  organizationId: string;
  connectionStatus: "connected" | "connecting" | "reconnecting" | "error" | "demo_fallback";
  agents: Record<string, AgentAvatarData>;
  workstations: Record<string, WorkstationData>;
  activeFloor: number;
  isFloorIsolated: boolean;
  onSelectFloor: (floor: number) => void;
  onToggleIsolation?: () => void;
  onSelectAgent: (id: string) => void;
  onResetCamera: () => void;
  onFocusWorkstations?: () => void;
  onFocusMeetingRoom?: () => void;
  onFocusServerRoom?: () => void;
  onFocusCEO?: () => void;
  onOpenChat: () => void;
  isChatOpen: boolean;
  events?: any[];
  pendingAction?: any;
  onApprovalDecision?: (actionId: string, decision: "APPROVE" | "REJECT") => void;
  qualityMode?: "LOW" | "BALANCED" | "HIGH";
  onChangeQuality?: (mode: "LOW" | "BALANCED" | "HIGH") => void;
  onRefreshData?: () => void;
}

export default function SimulationHUD({
  organizationId,
  connectionStatus,
  agents,
  workstations,
  activeFloor,
  isFloorIsolated,
  onSelectFloor,
  onToggleIsolation,
  onSelectAgent,
  onResetCamera,
  onFocusWorkstations,
  onFocusMeetingRoom,
  onFocusServerRoom,
  onFocusCEO,
  onOpenChat,
  isChatOpen,
  events = [],
  pendingAction,
  onApprovalDecision,
  qualityMode = "BALANCED",
  onChangeQuality,
  onRefreshData,
}: SimulationHUDProps) {
  // Collapsible panels
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState<"all" | "active" | "approvals" | "idle">("all");
  const [zoomLevel, setZoomLevel] = useState(100);

  const agentList = useMemo(() => Object.values(agents), [agents]);
  const activeCount = useMemo(
    () => agentList.filter((a) => a.behavioralState === "IN_PROGRESS").length,
    [agentList]
  );
  const idleCount = useMemo(
    () => agentList.filter((a) => a.behavioralState !== "IN_PROGRESS").length,
    [agentList]
  );

  const filteredAgents = useMemo(() => {
    return agentList.filter((agent) => {
      const matchesSearch =
        agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.department.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (agentFilter === "active") return agent.behavioralState === "IN_PROGRESS";
      if (agentFilter === "idle") return agent.behavioralState !== "IN_PROGRESS";
      return true;
    });
  }, [agentList, searchQuery, agentFilter]);

  const activeFloorDef = FLOOR_DEFINITIONS[activeFloor] || FLOOR_DEFINITIONS[1];

  return (
    <>
      {/* =========================================================================
          1. TOP NAVIGATION & TELEMETRY BAR
          ========================================================================= */}
      <header className="absolute top-3.5 left-4 right-4 z-30 pointer-events-none flex items-center justify-between gap-3">
        {/* Brand & Floor Indicator */}
        <div className="pointer-events-auto flex items-center gap-3 px-3.5 py-2 rounded-2xl bg-slate-950/85 border border-slate-800 shadow-xl backdrop-blur-xl">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center font-black text-slate-950 text-xs shadow-md shadow-amber-500/30">
            5.0
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xs text-slate-100 tracking-wide uppercase">
                PROVIPAGENT
              </span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40">
                CHIBI 3D
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              Văn Phòng AI · Tầng: <span className="text-amber-400 font-bold">{activeFloorDef.code}</span>
            </p>
          </div>
        </div>

        {/* Center: Multi-Floor Switcher Carousel */}
        <div className="pointer-events-auto hidden lg:flex items-center gap-1 p-1 rounded-2xl bg-slate-950/85 border border-slate-800/80 shadow-xl backdrop-blur-xl text-xs">
          <button
            onClick={() => onSelectFloor(0)}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeFloor === 0
                ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30"
                : "text-slate-300 hover:text-white hover:bg-slate-800/80"
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Toàn Cảnh</span>
          </button>

          {[
            { f: 6, code: "T6", label: "CEO Suite", color: "#38bdf8" },
            { f: 5, code: "T5", label: "Kỹ Thuật", color: "#10b981" },
            { f: 4, code: "T4", label: "Dữ Liệu & AI", color: "#8b5cf6" },
            { f: 3, code: "T3", label: "Marketing", color: "#f59e0b" },
            { f: 2, code: "T2", label: "Thiết Kế", color: "#ec4899" },
            { f: 1, code: "T1", label: "Lễ Tân & Ops", color: "#06b6d4" },
          ].map((item) => (
            <button
              key={item.f}
              onClick={() => onSelectFloor(item.f)}
              className={`px-2.5 py-1.5 rounded-xl font-medium transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                activeFloor === item.f
                  ? "bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/30"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/80"
              }`}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              <span>{item.code}: {item.label}</span>
            </button>
          ))}

          {onToggleIsolation && (
            <button
              onClick={onToggleIsolation}
              className={`ml-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                isFloorIsolated
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
                  : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/60"
              }`}
            >
              {isFloorIsolated ? "⚡ Cô Lập" : "🔍 Toàn Bộ"}
            </button>
          )}
        </div>

        {/* Right: Live Sync, Quality Selector & Refresh */}
        <div className="pointer-events-auto flex items-center gap-2">
          {/* Quality Selector */}
          <div className="hidden sm:flex items-center gap-1 p-1 rounded-xl bg-slate-950/85 border border-slate-800/80 text-[10px]">
            {(["LOW", "BALANCED", "HIGH"] as const).map((q) => (
              <button
                key={q}
                onClick={() => onChangeQuality?.(q)}
                className={`px-2 py-1 rounded-lg font-bold transition-all ${
                  qualityMode === q
                    ? "bg-amber-500 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {q}
              </button>
            ))}
          </div>

          {/* Connection Status Pill */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-slate-950/85 border border-slate-800 shadow-xl backdrop-blur-xl text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-300">LIVE SYNC</span>
            {onRefreshData && (
              <button
                onClick={onRefreshData}
                title="Làm mới snapshot"
                className="text-slate-400 hover:text-white transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* =========================================================================
          2. LEFT PANEL: SESSIONS & APPROVAL QUEUE ("Phiên làm việc")
          ========================================================================= */}
      <aside
        className={`absolute top-20 left-4 bottom-20 z-20 w-72 rounded-3xl bg-slate-950/90 border border-slate-800/80 shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden text-slate-100 font-sans transition-all duration-300 ${
          isLeftPanelOpen ? "translate-x-0" : "-translate-x-[calc(100%+1rem)]"
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-900/40 flex items-center justify-between">
          <div>
            <h2 className="font-extrabold text-xs tracking-wider uppercase text-slate-200">
              PHIÊN LÀM VIỆC
            </h2>
            <span className="text-[10px] text-slate-400">
              {agentList.length} nhân viên AI đang hoạt động
            </span>
          </div>
          <button
            onClick={() => setIsLeftPanelOpen(false)}
            className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Filter Pills */}
        <div className="p-3 border-b border-slate-800/60 flex items-center gap-1 text-[11px]">
          <button
            onClick={() => setAgentFilter("all")}
            className={`flex-1 py-1 rounded-lg font-bold text-center transition-all ${
              agentFilter === "all"
                ? "bg-amber-500 text-slate-950 shadow-md"
                : "bg-slate-900 text-slate-400 hover:text-slate-200"
            }`}
          >
            Tất cả ({agentList.length})
          </button>
          <button
            onClick={() => setAgentFilter("active")}
            className={`flex-1 py-1 rounded-lg font-bold text-center transition-all ${
              agentFilter === "active"
                ? "bg-emerald-500 text-slate-950 shadow-md"
                : "bg-slate-900 text-slate-400 hover:text-slate-200"
            }`}
          >
            Đang làm ({activeCount})
          </button>
          <button
            onClick={() => setAgentFilter("idle")}
            className={`flex-1 py-1 rounded-lg font-bold text-center transition-all ${
              agentFilter === "idle"
                ? "bg-slate-700 text-white shadow-md"
                : "bg-slate-900 text-slate-400 hover:text-slate-200"
            }`}
          >
            Nghỉ ({idleCount})
          </button>
        </div>

        {/* Search Input */}
        <div className="p-3 border-b border-slate-800/60">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên hoặc phòng ban..."
              className="bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none w-full"
            />
          </div>
        </div>

        {/* Pending Approval Section */}
        {pendingAction && (
          <div className="p-3 border-b border-amber-500/30 bg-amber-950/30">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>CẦN BẠN DUYỆT</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900/90 border border-amber-500/40 text-xs space-y-2">
              <div className="text-slate-300 font-medium">
                Yêu cầu công cụ: <code className="text-amber-300 font-mono">{pendingAction.tool_name || pendingAction.action}</code>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => onApprovalDecision?.(pendingAction.id, "APPROVE")}
                  className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition-colors shadow-md"
                >
                  ✓ Duyệt
                </button>
                <button
                  onClick={() => onApprovalDecision?.(pendingAction.id, "REJECT")}
                  className="flex-1 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] transition-colors shadow-md"
                >
                  ✕ Từ chối
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Employees List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {filteredAgents.map((agent) => {
            const isWorking = agent.behavioralState === "IN_PROGRESS";
            return (
              <div
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className="p-2.5 rounded-2xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 hover:border-amber-400/50 cursor-pointer transition-all flex items-center justify-between gap-2.5 group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center font-bold text-amber-400 text-xs border border-slate-700/80 group-hover:scale-105 transition-transform">
                    {agent.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-xs text-slate-200 truncate group-hover:text-amber-300 transition-colors">
                      {agent.name}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {agent.department} · {agent.role.split(" ")[0]}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 flex flex-col items-end gap-1">
                  <span
                    className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                      isWorking
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {isWorking ? "Đang làm" : "Đang nghỉ"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Reopen Button for Left Panel */}
      {!isLeftPanelOpen && (
        <button
          onClick={() => setIsLeftPanelOpen(true)}
          className="absolute top-24 left-4 z-20 px-3 py-2 rounded-2xl bg-slate-950/90 hover:bg-slate-900 border border-slate-800 text-slate-200 text-xs font-bold shadow-xl backdrop-blur-xl flex items-center gap-1.5 cursor-pointer transition-transform hover:scale-105"
        >
          <ChevronRight className="w-4 h-4 text-amber-400" />
          <span>Phiên làm việc</span>
        </button>
      )}

      {/* =========================================================================
          3. RIGHT PANEL: LIVE ACTIVITY FEED ("Hoạt động")
          ========================================================================= */}
      <aside
        className={`absolute top-20 right-4 bottom-20 z-20 w-80 rounded-3xl bg-slate-950/90 border border-slate-800/80 shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden text-slate-100 font-sans transition-all duration-300 ${
          isRightPanelOpen ? "translate-x-0" : "translate-x-[calc(100%+1rem)]"
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-900/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <h2 className="font-extrabold text-xs tracking-wider uppercase text-slate-200">
              HOẠT ĐỘNG TRỰC TIẾP
            </h2>
          </div>
          <button
            onClick={() => setIsRightPanelOpen(false)}
            className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Metrics Counter Pill Header */}
        <div className="grid grid-cols-4 gap-1 p-3 border-b border-slate-800/60 bg-slate-900/20 text-center">
          <div className="p-1.5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="font-extrabold text-xs text-sky-400">{events.length}</div>
            <div className="text-[9px] text-slate-400">Việc</div>
          </div>
          <div className="p-1.5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="font-extrabold text-xs text-emerald-400">14</div>
            <div className="text-[9px] text-slate-400">Đọc</div>
          </div>
          <div className="p-1.5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="font-extrabold text-xs text-amber-400">8</div>
            <div className="text-[9px] text-slate-400">Sửa</div>
          </div>
          <div className="p-1.5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="font-extrabold text-xs text-indigo-400">6</div>
            <div className="text-[9px] text-slate-400">Lệnh</div>
          </div>
        </div>

        {/* Events Stream */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {events.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 text-xs">
              <Activity className="w-8 h-8 text-slate-600 mb-2 animate-pulse" />
              <span>Đang lắng nghe hoạt động tool calling và task từ backend...</span>
            </div>
          ) : (
            events.slice(-15).reverse().map((ev, idx) => (
              <div
                key={ev.id || idx}
                className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/70 text-xs space-y-1 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-mono text-amber-400 font-bold uppercase truncate max-w-[140px]">
                    {ev.event_type}
                  </span>
                  <span className="text-slate-500">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="text-slate-300 text-[11px] font-medium leading-relaxed">
                  {ev.payload?.tool_name
                    ? `Thực thi công cụ: ${ev.payload.tool_name}`
                    : ev.payload?.title || "Cập nhật trạng thái nhiệm vụ"}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Reopen Button for Right Panel */}
      {!isRightPanelOpen && (
        <button
          onClick={() => setIsRightPanelOpen(true)}
          className="absolute top-24 right-4 z-20 px-3 py-2 rounded-2xl bg-slate-950/90 hover:bg-slate-900 border border-slate-800 text-slate-200 text-xs font-bold shadow-xl backdrop-blur-xl flex items-center gap-1.5 cursor-pointer transition-transform hover:scale-105"
        >
          <span>Hoạt động</span>
          <ChevronLeft className="w-4 h-4 text-amber-400" />
        </button>
      )}

      {/* =========================================================================
          4. BOTTOM TOOLBAR & GAME CONTROLS
          ========================================================================= */}
      <footer className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex flex-col items-center gap-2">
        {/* Subtitle Quote Banner inspired by My-Office */}
        <div className="hidden md:flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-950/90 border border-slate-800 shadow-xl text-xs text-slate-200 font-medium backdrop-blur-xl">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>Mỗi phiên Claude Code là một nhân vật: đọc file ra thư viện, sửa code thì ngồi gõ</span>
        </div>

        <div className="flex items-center gap-2 p-1.5 rounded-3xl bg-slate-950/95 border border-slate-800 shadow-2xl backdrop-blur-2xl">
          {/* Quick View Presets */}
          <button
            onClick={onResetCamera}
            className="px-3.5 py-2 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Compass className="w-4 h-4 text-amber-400" />
            <span className="hidden sm:inline">Toàn cảnh</span>
          </button>

          {onFocusWorkstations && (
            <button
              onClick={onFocusWorkstations}
              className="px-3.5 py-2 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Monitor className="w-4 h-4 text-sky-400" />
              <span className="hidden sm:inline">Bàn làm việc</span>
            </button>
          )}

          {onFocusMeetingRoom && (
            <button
              onClick={onFocusMeetingRoom}
              className="px-3.5 py-2 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Users className="w-4 h-4 text-purple-400" />
              <span className="hidden sm:inline">Phòng họp</span>
            </button>
          )}

          {onFocusServerRoom && (
            <button
              onClick={onFocusServerRoom}
              className="px-3.5 py-2 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span className="hidden sm:inline">Máy chủ</span>
            </button>
          )}

          {/* Avatar Personification Toggle */}
          <button
            onClick={() => {
              const firstAgentId = Object.keys(agents)[0];
              if (firstAgentId) onSelectAgent(firstAgentId);
            }}
            className="px-3 py-2 rounded-2xl bg-slate-900 hover:bg-slate-800 text-amber-300 hover:text-amber-200 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border border-amber-500/20"
          >
            <span>✨</span>
            <span className="hidden sm:inline">Hoá thân</span>
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 px-2 border-l border-slate-800">
            <button
              onClick={() => setZoomLevel((z) => Math.max(50, z - 10))}
              className="w-7 h-7 rounded-lg bg-slate-900 hover:bg-slate-800 flex items-center justify-center text-slate-300 hover:text-white text-xs transition-colors"
            >
              -
            </button>
            <span className="text-[11px] font-mono text-slate-400 w-12 text-center">
              {zoomLevel}%
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(200, z + 10))}
              className="w-7 h-7 rounded-lg bg-slate-900 hover:bg-slate-800 flex items-center justify-center text-slate-300 hover:text-white text-xs transition-colors"
            >
              +
            </button>
          </div>

          {/* AI Command Center Toggle */}
          <div className="pl-2 border-l border-slate-800">
            <button
              onClick={onOpenChat}
              className={`px-4 py-2 rounded-2xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                isChatOpen
                  ? "bg-amber-400 text-slate-950 shadow-lg shadow-amber-400/40 scale-105"
                  : "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/30"
              }`}
            >
              <MessageSquare className="w-4 h-4 fill-slate-950" />
              <span>AI Command Center</span>
            </button>
          </div>
        </div>
      </footer>
    </>
  );
}

