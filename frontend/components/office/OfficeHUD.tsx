"use client";

import React, { useState } from "react";
import {
  Building2,
  Activity,
  Users,
  Monitor,
  RefreshCw,
  Compass,
  Eye,
  ShieldCheck,
  PlusCircle,
  UserPlus,
  Terminal,
  Camera,
  ZoomIn,
  Move,
  MousePointer,
  Pause,
  Play,
  ArrowRight,
  Sliders,
  GitBranch,
  Navigation,
} from "lucide-react";

interface OfficeHUDProps {
  organizationId: string;
  connectionStatus: "connected" | "connecting" | "reconnecting" | "error" | "demo_fallback";
  sequenceId: number;
  totalAgents: number;
  activeTasksCount: number;
  totalWorkstations: number;
  occupiedWorkstations: number;
  activeFloor?: number;
  isFloorIsolated?: boolean;
  onSelectFloor?: (floor: number) => void;
  onToggleIsolation?: () => void;
  onResetCamera: () => void;
  onFocusCEO: () => void;
  onFocusMeetingRoom?: () => void;
  onOpenMeetingDiscovery?: () => void;
  onRefreshData?: () => void;
  onToggleMissionDrawer?: () => void;
  isMissionDrawerOpen?: boolean;
  onOpenTaskModal?: () => void;
  onOpenRecruitmentModal?: () => void;
}

export default function OfficeHUD({
  organizationId,
  connectionStatus,
  sequenceId,
  totalAgents,
  activeTasksCount,
  totalWorkstations,
  occupiedWorkstations,
  activeFloor = 0,
  isFloorIsolated = false,
  onSelectFloor,
  onToggleIsolation,
  onResetCamera,
  onFocusCEO,
  onFocusMeetingRoom,
  onOpenMeetingDiscovery,
  onRefreshData,
  onToggleMissionDrawer,
  isMissionDrawerOpen,
  onOpenTaskModal,
  onOpenRecruitmentModal,
}: OfficeHUDProps) {
  const [isPaused, setIsPaused] = useState(false);
  const [activeTool, setActiveTool] = useState<"camera" | "zoom" | "pan" | "select">("camera");

  return (
    <>
      {/* =========================================================================
          TOP HEADER TELEMETRY & NAVIGATION BAR
          ========================================================================= */}
      <header className="absolute top-4 left-4 right-4 z-20 pointer-events-none flex items-center justify-between gap-4">
        {/* 1. Left: Brand & Organization Scope */}
        <div className="pointer-events-auto flex items-center gap-3 px-4 py-2 rounded-2xl bg-slate-900/85 border border-slate-700/60 shadow-xl backdrop-blur-md">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-md shadow-sky-500/20">
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xs font-bold text-slate-100 tracking-wide uppercase">
                PROVIPAGENT 3D OFFICE
              </h1>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-sky-950 text-sky-400 border border-sky-800/60">
                v4.1
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">
              Org: <span className="text-slate-200 font-semibold">{organizationId}</span>
            </p>
          </div>
        </div>

        {/* 2. Center: Telemetry Summary Pills */}
        <div className="pointer-events-auto hidden md:flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-slate-900/80 border border-slate-700/60 shadow-lg backdrop-blur-md text-xs">
          {/* Agents metric */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950/60 border border-slate-800/40">
            <Users className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-slate-400">Đặc vụ:</span>
            <span className="font-bold text-slate-100">{totalAgents}</span>
          </div>

          {/* Tasks metric */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950/60 border border-slate-800/40">
            <Activity className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-slate-400">Nhiệm vụ:</span>
            <span className="font-bold text-slate-100">{activeTasksCount}</span>
          </div>

          {/* Workstations metric */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950/60 border border-slate-800/40">
            <Monitor className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-400">Bàn làm việc:</span>
            <span className="font-bold text-slate-100">
              {occupiedWorkstations} / {totalWorkstations}
            </span>
          </div>
        </div>

        {/* 3. Right: Connection Status & Global Actions */}
        <div className="pointer-events-auto flex items-center gap-2">
          {/* Real-time Connection Status */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-900/85 border border-slate-700/60 shadow-xl backdrop-blur-md text-xs">
            {connectionStatus === "connected" && (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
                <div className="flex flex-col text-left">
                  <span className="text-[10px] font-bold text-emerald-300 leading-none">LIVE SYNC</span>
                  <span className="text-[8px] text-slate-400">Đồng bộ thời gian thực</span>
                </div>
              </>
            )}

            {connectionStatus === "connecting" && (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-ping" />
                <span className="text-[10px] font-semibold text-amber-300">ĐANG ĐỒNG BỘ...</span>
              </>
            )}

            {connectionStatus === "reconnecting" && (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-[10px] font-semibold text-amber-400">KẾT NỐI LẠI...</span>
              </>
            )}

            {connectionStatus === "error" && (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
                <span className="text-[10px] font-semibold text-rose-400">MẤT KẾT NỐI</span>
              </>
            )}

            {connectionStatus === "demo_fallback" && (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                <span className="text-[10px] font-semibold text-slate-400">CHẾ ĐỘ STANDBY</span>
              </>
            )}

            {onRefreshData && (
              <button
                type="button"
                onClick={onRefreshData}
                title="Làm mới snapshot backend"
                className="ml-1 p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Camera Quick Buttons */}
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-slate-900/85 border border-slate-700/60 shadow-xl backdrop-blur-md">
            <button
              type="button"
              onClick={onResetCamera}
              title="Góc nhìn toàn cảnh"
              className="px-2.5 py-1.5 rounded-xl hover:bg-slate-800 text-slate-300 hover:text-slate-100 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Compass className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Toàn Cảnh</span>
            </button>
            <button
              type="button"
              onClick={onFocusCEO}
              title="Tiêu điểm CEO Suite"
              className="px-2.5 py-1.5 rounded-xl hover:bg-slate-800 text-slate-300 hover:text-slate-100 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">CEO Suite</span>
            </button>
            {onFocusMeetingRoom && (
              <button
                type="button"
                onClick={onFocusMeetingRoom}
                title="Tiêu điểm Phòng Họp Điều Hành"
                className="px-2.5 py-1.5 rounded-xl hover:bg-slate-800 text-slate-300 hover:text-slate-100 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Users className="w-3.5 h-3.5 text-purple-400" />
                <span className="hidden sm:inline">Phòng Họp</span>
              </button>
            )}
          </div>

          {/* Operational Action Buttons */}
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-slate-900/85 border border-slate-700/60 shadow-xl backdrop-blur-md">
            {onOpenTaskModal && (
              <button
                type="button"
                onClick={onOpenTaskModal}
                title="Giao việc"
                className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-md shadow-sky-600/30"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Giao việc</span>
              </button>
            )}

            {onOpenRecruitmentModal && (
              <button
                type="button"
                onClick={onOpenRecruitmentModal}
                title="Tùy chỉnh"
                className="px-2.5 py-1.5 rounded-xl hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden md:inline">Tùy chỉnh</span>
              </button>
            )}

            {onToggleMissionDrawer && (
              <button
                type="button"
                onClick={onToggleMissionDrawer}
                title="Quy trình & Console"
                className={`px-2.5 py-1.5 rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                  isMissionDrawerOpen
                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/25"
                    : "hover:bg-slate-800 text-slate-300 hover:text-white"
                }`}
              >
                <GitBranch className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden md:inline">Quy trình</span>
              </button>
            )}
          </div>
        </div>

        {/* 4. Floor Navigation Bar (Multi-Story Controller Centered Below Top Header) */}
        <div className="absolute top-18 left-1/2 -translate-x-1/2 z-20 pointer-events-auto flex items-center gap-1 p-1 rounded-2xl bg-slate-900/90 border border-slate-700/70 shadow-2xl backdrop-blur-md max-w-[96vw] overflow-x-auto">
          <button
            type="button"
            onClick={() => onSelectFloor?.(0)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeFloor === 0
                ? "bg-sky-500 text-white shadow-md shadow-sky-500/35"
                : "text-slate-300 hover:text-white hover:bg-slate-800"
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Toàn Cảnh</span>
          </button>

          {[
            { f: 1, label: "T1: Lễ Tân & Ops", color: "#06b6d4" },
            { f: 2, label: "T2: Thiết Kế", color: "#ec4899" },
            { f: 3, label: "T3: Marketing", color: "#f59e0b" },
            { f: 4, label: "T4: Ngân Hàng", color: "#8b5cf6" },
            { f: 5, label: "T5: Kỹ Thuật", color: "#10b981" },
            { f: 6, label: "T6: Điều Hành", color: "#38bdf8" },
          ].map((item) => (
            <button
              type="button"
              key={item.f}
              onClick={() => onSelectFloor?.(item.f)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                activeFloor === item.f
                  ? "bg-sky-500 text-white shadow-md shadow-sky-500/35"
                  : "text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span>{item.label}</span>
            </button>
          ))}

          {onToggleIsolation && (
            <div className="ml-1 pl-1.5 border-l border-slate-700/60 flex items-center">
              <button
                onClick={onToggleIsolation}
                title={isFloorIsolated ? "Hủy cô lập tầng" : "Cô lập tầng"}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                  isFloorIsolated
                    ? "bg-amber-600/30 text-amber-300 border border-amber-500/40"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                {isFloorIsolated ? "⚡ Đang Cô Lập" : "🔍 Cô Lập Tầng"}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* =========================================================================
          BOTTOM CONTROL BAR & ARCHITECTURAL MINI-MAP
          ========================================================================= */}
      <footer className="absolute bottom-4 left-4 right-4 z-20 pointer-events-none flex items-end justify-between">
        {/* Left: Mini-map Blueprint & Floating Tool Controls */}
        <div className="pointer-events-auto flex flex-col items-start gap-3">
          {/* 2D Architectural Mini-Map Blueprint Frame */}
          <div className="relative w-36 h-36 rounded-2xl bg-slate-900/85 border border-slate-700/70 p-2.5 shadow-2xl backdrop-blur-md flex flex-col justify-between overflow-hidden">
            {/* North Indicator */}
            <div className="absolute top-2 right-2 flex items-center gap-0.5 text-[10px] font-mono text-sky-400 font-bold">
              <Navigation className="w-3 h-3 text-sky-400" />
              <span>N</span>
            </div>

            {/* Architectural Building Core Grid */}
            <div className="w-full h-full relative border border-sky-500/20 rounded-lg p-1.5 bg-slate-950/40">
              {/* Floor layout representation */}
              <div className="grid grid-cols-4 grid-rows-3 gap-1 w-full h-full">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={`mini-cell-${i}`}
                    className={`rounded-sm border ${
                      i === 5 || i === 6
                        ? "bg-sky-500/30 border-sky-400/50"
                        : "bg-slate-800/40 border-slate-700/30"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="text-[9px] text-slate-400 font-mono text-center">
              Tầng {activeFloor === 0 ? "Toàn Cảnh" : activeFloor}
            </div>
          </div>

          {/* Floating Tool Controls Pill */}
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-slate-900/85 border border-slate-700/70 shadow-xl backdrop-blur-md">
            {[
              { id: "camera", label: "Camera", icon: Camera },
              { id: "zoom", label: "Zoom", icon: ZoomIn },
              { id: "pan", label: "Pan", icon: Move },
              { id: "select", label: "Chọn", icon: MousePointer },
            ].map((tool) => {
              const Icon = tool.icon;
              const isActive = activeTool === tool.id;
              return (
                <button
                  type="button"
                  key={tool.id}
                  onClick={() => setActiveTool(tool.id as any)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                    isActive
                      ? "bg-sky-600 text-white shadow-md shadow-sky-600/30"
                      : "text-slate-300 hover:text-white hover:bg-slate-800"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tool.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Simulation Controls & Version Status */}
        <div className="pointer-events-auto flex items-center gap-2">
          {/* Pause / Resume Button */}
          <button
            type="button"
            onClick={() => setIsPaused(!isPaused)}
            className="px-3 py-2 rounded-2xl bg-slate-900/85 hover:bg-slate-800 border border-slate-700/70 text-slate-200 hover:text-white text-xs font-medium transition-all flex items-center gap-2 shadow-xl backdrop-blur-md cursor-pointer"
          >
            {isPaused ? (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>Tiếp tục</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5 text-amber-400" />
                <span>Tạm dừng</span>
              </>
            )}
          </button>

          {/* Primary Next Action Button */}
          <button
            type="button"
            className="px-3.5 py-2 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-all flex items-center gap-2 shadow-xl shadow-sky-600/30 cursor-pointer"
          >
            <span>Tiến Luật Tiếp Theo</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          {/* Status Badge */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-900/85 border border-slate-700/70 shadow-xl backdrop-blur-md text-xs text-slate-300">
            <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_6px_#38bdf8] animate-pulse" />
            <span className="font-mono text-[11px]">Giao diện: 3D Office (v4.1)</span>
          </div>
        </div>
      </footer>
    </>
  );
}
