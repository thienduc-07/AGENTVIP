"use client";

import React from "react";
import {
  Compass,
  Cpu,
  HardDrive,
  Activity,
  History,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { SystemStatus } from "@/types";
import { useWorldStore } from "@/store/worldStore";

interface TopNavProps {
  wsConnected: boolean;
  selectedProvider: string;
  onSelectProvider: (provider: string) => void;
  viewPreset: "tactical" | "agent";
  onToggleViewPreset: (preset: "tactical" | "agent") => void;
  systemStatus: SystemStatus | null;
  onOpenHistory: () => void;
}

export default function TopNav({
  wsConnected,
  selectedProvider,
  onSelectProvider,
  viewPreset,
  onToggleViewPreset,
  systemStatus,
  onOpenHistory,
}: TopNavProps) {
  const setIsMemoryCenterOpen = useWorldStore((s) => s.setIsMemoryCenterOpen);
  const setIsToolCenterOpen = useWorldStore((s) => s.setIsToolCenterOpen);
  return (
    <header className="absolute top-0 left-0 right-0 z-30 px-5 py-3 flex items-center justify-between pointer-events-none">
      {/* Brand Title */}
      <div className="flex items-center gap-3 pointer-events-auto">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-800 flex items-center justify-center shadow-lg shadow-blue-500/30 border border-blue-400/40">
          <Activity className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-wider text-blue-400 flex items-center gap-2">
            AI AGENCY HEADQUARTERS
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 uppercase">
              Autonomous Enterprise
            </span>
          </h1>
          <p className="text-[11px] text-slate-400">
            Level 42 Executive Tower • Real AI Runtime & Telemetry
          </p>
        </div>
      </div>

      {/* Center Controls: View Presets & Provider Selector */}
      <div className="flex items-center gap-3 pointer-events-auto">
        {/* Camera Preset Switcher */}
        <div className="flex items-center p-1 rounded-xl glass-panel">
          <button
            onClick={() => onToggleViewPreset("tactical")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewPreset === "tactical"
                ? "bg-amber-500 text-slate-950 font-semibold shadow"
                : "text-slate-300 hover:text-white"
            }`}
          >
            🗺️ Tactical Island
          </button>
          <button
            onClick={() => onToggleViewPreset("agent")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewPreset === "agent"
                ? "bg-amber-500 text-slate-950 font-semibold shadow"
                : "text-slate-300 hover:text-white"
            }`}
          >
            🎯 Focus Station
          </button>
        </div>

        {/* Model Provider Switcher */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl glass-panel text-xs">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-slate-400 font-medium">Provider:</span>
          <select
            value={selectedProvider}
            onChange={(e) => onSelectProvider(e.target.value)}
            className="bg-transparent text-amber-300 font-semibold focus:outline-none cursor-pointer"
          >
            <option value="deterministic" className="bg-slate-900 text-slate-100">
              ⚡ Zero-Cost Local Engine (Budget 0)
            </option>
            <option value="gemini" className="bg-slate-900 text-slate-100">
              🧠 Google Gemini 1.5 Flash
            </option>
            <option value="openai" className="bg-slate-900 text-slate-100">
              🤖 OpenAI GPT-4o Mini
            </option>
            <option value="ollama" className="bg-slate-900 text-slate-100">
              🦙 Local Ollama
            </option>
          </select>
        </div>
      </div>

      {/* Right Controls: Telemetry, WS Status, History */}
      <div className="flex items-center gap-3 pointer-events-auto">
        {/* Real Host Telemetry */}
        {systemStatus && (
          <div className="hidden lg:flex items-center gap-3 px-3 py-1.5 rounded-xl glass-panel text-xs text-slate-300">
            <div className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              <span>CPU: {systemStatus.cpu_percent}%</span>
            </div>
            <div className="w-[1px] h-3 bg-slate-700" />
            <div className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
              <span>RAM: {systemStatus.memory_percent}%</span>
            </div>
          </div>
        )}

        {/* WebSocket Realtime Status */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium glass-panel border ${
            wsConnected
              ? "border-emerald-500/40 text-emerald-400"
              : "border-red-500/40 text-red-400"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              wsConnected ? "bg-emerald-400 animate-pulse" : "bg-red-400"
            }`}
          />
          <span>{wsConnected ? "LIVE REALTIME" : "CONNECTING..."}</span>
        </div>

        {/* Memory Center Modal Button */}
        <button
          onClick={() => setIsMemoryCenterOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-panel hover:border-cyan-500/50 text-slate-300 hover:text-cyan-300 transition-all shadow text-xs font-semibold"
          title="Grand Line Archives & Memory Center"
        >
          <span className="text-sm">🧠</span>
          <span className="hidden sm:inline">Archives & Memory</span>
        </button>

        {/* Tool Center Modal Button */}
        <button
          onClick={() => setIsToolCenterOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-panel hover:border-amber-500/50 text-slate-300 hover:text-amber-300 transition-all shadow text-xs font-semibold"
          title="Grand Line Tool Ecosystem & Skills Foundry"
        >
          <span className="text-sm">🛠️</span>
          <span className="hidden sm:inline">Tool Center</span>
        </button>

        {/* Task History Modal Button */}
        <button
          onClick={onOpenHistory}
          className="p-2 rounded-xl glass-panel hover:border-amber-500/50 text-slate-300 hover:text-amber-300 transition-all shadow"
          title="Mission Archive & History"
        >
          <History className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
