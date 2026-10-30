"use client";

import React from "react";
import {
  Building,
  Crown,
  Code,
  Brain,
  Sparkles,
  TrendingUp,
  ShieldAlert,
  Users,
  Headphones,
  HelpCircle,
  Layers,
} from "lucide-react";
import { useWorldStore } from "@/store/worldStore";
import { ISLAND_CAMERA_BOOKMARKS } from "@/data/worldConfig";

interface WorldHUDProps {
  onToggleMissionDrawer?: () => void;
  isMissionDrawerOpen?: boolean;
  onOpenTaskModal?: () => void;
}

export default function WorldHUD({
  onToggleMissionDrawer,
  isMissionDrawerOpen,
  onOpenTaskModal,
}: WorldHUDProps) {
  const isLiveConnected = useWorldStore((s) => s.isLiveConnected);
  const backendConnection = useWorldStore((s) => s.backendConnection);
  const backendError = useWorldStore((s) => s.backendError);
  const cameraPreset = useWorldStore((s) => s.cameraPreset);
  const selectedAreaId = useWorldStore((s) => s.selectedAreaId);
  const selectedAgentId = useWorldStore((s) => s.selectedAgentId);
  const selectArea = useWorldStore((s) => s.selectArea);
  const resetToTacticalOverview = useWorldStore((s) => s.resetToTacticalOverview);
  const toggleControlsHelp = useWorldStore((s) => s.toggleControlsHelp);

  const smoothFocusCamera = useWorldStore((s) => s.smoothFocusCamera);

  const renderBookmarkIcon = (icon: string) => {
    switch (icon) {
      case "Crown":
        return <Crown className="w-3.5 h-3.5 text-blue-400" />;
      case "Code":
        return <Code className="w-3.5 h-3.5 text-cyan-400" />;
      case "Brain":
        return <Brain className="w-3.5 h-3.5 text-purple-400" />;
      case "Sparkles":
        return <Sparkles className="w-3.5 h-3.5 text-rose-400" />;
      case "TrendingUp":
        return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
      case "ShieldAlert":
        return <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />;
      case "Users":
        return <Users className="w-3.5 h-3.5 text-teal-400" />;
      case "Headphones":
        return <Headphones className="w-3.5 h-3.5 text-teal-300" />;
      case "Building":
      default:
        return <Building className="w-3.5 h-3.5 text-slate-300" />;
    }
  };

  return (
    <header className="absolute top-0 left-0 right-0 z-30 px-5 py-3 flex items-center justify-between pointer-events-none">
      {/* Brand & Corporate Identity */}
      <div className="flex items-center gap-3 pointer-events-auto">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-800 flex items-center justify-center shadow-lg shadow-blue-500/25 border border-blue-400/40">
          <Building className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-wider text-white flex items-center gap-2">
            AI AGENCY
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 uppercase font-mono font-semibold">
              AUTONOMOUS HQ
            </span>
          </h1>
          <p className="text-[11px] text-slate-400">
            Level 42 Executive Tower • Real AI Runtime & Department Telemetry
          </p>
        </div>
      </div>

      {/* Center Camera & Department Navigation Bar */}
      <div className="hidden lg:flex items-center gap-1 p-1 rounded-2xl bg-slate-900/85 backdrop-blur-xl pointer-events-auto shadow-xl border border-slate-700/60 max-w-[62vw] overflow-x-auto no-scrollbar">
        {ISLAND_CAMERA_BOOKMARKS.map((b) => {
          const isActive =
            selectedAreaId === b.id ||
            (b.id === "all-office" && !selectedAreaId && cameraPreset === "tactical");

          return (
            <button
              key={b.id}
              onClick={() => {
                smoothFocusCamera(
                  b.cameraPosition,
                  b.targetPosition,
                  b.id === "all-office" ? undefined : b.id
                );
              }}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                isActive
                  ? "bg-blue-600 text-white font-semibold shadow-md shadow-blue-500/20"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/60"
              }`}
            >
              {renderBookmarkIcon(b.icon)}
              {b.label}
            </button>
          );
        })}
      </div>

      {/* Right Action Tools: Connection Status, Help, Mission Toggle */}
      <div className="flex items-center gap-2.5 pointer-events-auto">
        {/* Backend API Connection Status Badge */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900/85 backdrop-blur-xl border ${
            backendConnection === "connected"
              ? "border-emerald-500/40 text-emerald-400 shadow-emerald-500/10"
              : backendConnection === "connecting"
              ? "border-sky-500/40 text-sky-400 animate-pulse"
              : backendConnection === "demo_fallback"
              ? "border-amber-500/40 text-amber-400"
              : "border-rose-500/40 text-rose-400"
          }`}
          title={backendError || undefined}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              backendConnection === "connected"
                ? "bg-emerald-400 animate-pulse"
                : backendConnection === "connecting"
                ? "bg-sky-400 animate-ping"
                : backendConnection === "demo_fallback"
                ? "bg-amber-400"
                : "bg-rose-400"
            }`}
          />
          <span className="uppercase tracking-wider">
            {backendConnection === "connected"
              ? "Runtime Connected"
              : backendConnection === "connecting"
              ? "Connecting..."
              : backendConnection === "demo_fallback"
              ? "Local Standalone"
              : "Runtime Disconnected"}
          </span>
        </div>

        {/* Tactical Overview Camera Reset Button */}
        <button
          onClick={resetToTacticalOverview}
          className="p-2 rounded-xl bg-slate-900/85 hover:bg-slate-800 text-slate-300 hover:text-white transition-all border border-slate-700/60 cursor-pointer shadow-lg"
          title="Reset to Full Headquarters Overview"
        >
          <Layers className="w-4 h-4" />
        </button>

        {/* 3D Controls Help Button */}
        <button
          onClick={toggleControlsHelp}
          className="p-2 rounded-xl bg-slate-900/85 hover:bg-slate-800 text-slate-300 hover:text-white transition-all border border-slate-700/60 cursor-pointer shadow-lg"
          title="3D Navigation Controls Help"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        {/* Mission Dispatcher Drawer Toggle Button */}
        {onToggleMissionDrawer && (
          <button
            onClick={onToggleMissionDrawer}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-lg border ${
              isMissionDrawerOpen
                ? "bg-blue-600 border-blue-500 text-white"
                : "bg-slate-900/85 hover:bg-slate-800 text-blue-400 border-blue-500/40 hover:border-blue-500/80"
            }`}
          >
            <span>DISPATCH CONSOLE</span>
          </button>
        )}
      </div>
    </header>
  );
}
