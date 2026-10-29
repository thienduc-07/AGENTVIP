"use client";

import React from "react";
import { X, Shield, Sparkles, Terminal, Compass, AlertTriangle, CheckCircle } from "lucide-react";
import { useWorldStore } from "@/store/worldStore";

interface AgentInfoPanelProps {
  onOpenMissionDispatcher?: () => void;
  onOpenTaskModal?: () => void;
}

export default function AgentInfoPanel({
  onOpenMissionDispatcher,
  onOpenTaskModal,
}: AgentInfoPanelProps) {
  const selectedAgentId = useWorldStore((s) => s.selectedAgentId);
  const agents = useWorldStore((s) => s.agents);
  const closeInfoPanel = useWorldStore((s) => s.closeInfoPanel);
  const resetToTacticalOverview = useWorldStore((s) => s.resetToTacticalOverview);

  if (!selectedAgentId || !agents[selectedAgentId]) return null;

  const agent = agents[selectedAgentId];

  const getStatusBadge = () => {
    switch (agent.status) {
      case "working":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-500/60 animate-pulse flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5" />
            WORKING
          </span>
        );
      case "waiting_approval":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-950 text-red-200 border border-red-500/80 approval-pulse flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" />
            AWAITING APPROVAL
          </span>
        );
      case "error":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-500/50">
            ERROR
          </span>
        );
      case "offline":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
            OFFLINE
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/50 flex items-center gap-1">
            <CheckCircle className="w-2.5 h-2.5" />
            IDLE (READY)
          </span>
        );
    }
  };

  return (
    <div className="absolute top-20 right-5 z-20 w-88 p-4 rounded-3xl glass-panel border border-slate-700/80 shadow-2xl flex flex-col gap-3 pointer-events-auto animate-in slide-in-from-right-4 duration-200">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2.5">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg font-bold text-base"
            style={{ backgroundColor: `${agent.color}25`, border: `1.5px solid ${agent.color}80`, color: agent.color }}
          >
            {agent.name.charAt(0)}
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
              {agent.name}
            </h3>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {agent.role}
            </span>
          </div>
        </div>
        <button
          onClick={closeInfoPanel}
          className="text-slate-400 hover:text-white transition-colors cursor-pointer p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Live Status Pill & Station */}
      <div className="flex items-center justify-between text-xs px-1">
        <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
          <span>Trạm phụ trách:</span>
          <span className="font-semibold text-slate-200 uppercase font-mono">{agent.station}</span>
        </div>
        {getStatusBadge()}
      </div>

      {/* Current Task Box */}
      <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-xs flex flex-col gap-1">
        <span className="font-semibold text-amber-400 text-[11px] flex items-center gap-1">
          <Terminal className="w-3.5 h-3.5" />
          Nhiệm vụ hiện tại:
        </span>
        <p className="text-slate-300 leading-relaxed text-[11px]">
          {agent.currentTask || "Đang túc trực tại trạm, sẵn sàng nhận nhiệm vụ mới từ Thuyền Trưởng."}
        </p>
      </div>

      {/* Capabilities Tags */}
      {agent.capabilities && agent.capabilities.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Năng lực & Công cụ chuyên trách
          </span>
          <div className="flex flex-wrap gap-1">
            {agent.capabilities.map((cap, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded-lg text-[10px] bg-slate-800/90 text-cyan-300 border border-cyan-500/30"
              >
                {cap}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Interactive Daily Activities & Routines (Hành Động Thường Nhật) */}
      {(() => {
        const AGENT_ROUTINES: Record<string, Array<{ id: string; label: string; icon: string }>> = {
          "agent-captain-roger": [
            { id: "haki", label: "⚡ Haki Bá Vương (Sấm Đỏ)", icon: "⚡" },
            { id: "eating", label: "🍖 Ăn Thịt Nướng Khổng Lồ", icon: "🍖" },
            { id: "strolling", label: "🏃 Đi Dạo Quanh Núi Lửa", icon: "🏃" },
          ],
          "agent-zoro-quartermaster": [
            { id: "sword_kata", label: "⚔️ Song Long Diễm Kiếm", icon: "⚔️" },
            { id: "heavy_weights", label: "🏋️ Cử Tạ Sắt Khổng Lồ", icon: "🏋️" },
            { id: "meditation", label: "🧘 Thiền Định Kiếm Đạo", icon: "🧘" },
          ],
          "agent-sanji-cook": [
            { id: "cooking", label: "🍳 Nấu Ăn Baratie", icon: "🍳" },
            { id: "diable_jambe", label: "🔥 Diable Jambe", icon: "🔥" },
            { id: "smoking_stroll", label: "🚬 Dạo Quanh Hồ", icon: "🚬" },
          ],
          "agent-franky-shipwright": [
            { id: "ship_repair", label: "🔨 Sửa Tàu Thousand Sunny", icon: "🔨" },
            { id: "super_pose", label: "⭐ SUUUUPER!!", icon: "⭐" },
            { id: "cola_toast", label: "🥤 Uống Pirate Cola", icon: "🥤" },
          ],
          "agent-chopper-doctor": [
            { id: "apothecary", label: "🌿 Bào Chế Thuốc Sakura", icon: "🌿" },
            { id: "cotton_candy", label: "🍭 Kẹo Bông Gòn Hồng", icon: "🍭" },
            { id: "dancing", label: "🌸 Điệu Nhảy Rừng Hoa", icon: "🌸" },
          ],
          "agent-nami-navigator": [
            { id: "cartography", label: "🗺️ Nghiên Cứu Hải Đồ", icon: "🗺️" },
            { id: "zeus_weather", label: "⚡ Mây Sấm Zeus", icon: "⚡" },
            { id: "mikan_harvest", label: "🍊 Hái Cam Vườn Mikan", icon: "🍊" },
          ],
          "agent-usopp-sniper": [
            { id: "sniper_scout", label: "🎯 Ngắm Bắn Kuro Kabuto", icon: "🎯" },
            { id: "gadget_crafting", label: "🔧 Sáng Chế Vũ Khí", icon: "🔧" },
            { id: "tall_tales", label: "👑 Kể Chuyện Thuyền Trưởng", icon: "👑" },
          ],
          "agent-robin-scholar": [
            { id: "cien_fleurs", label: "🪷 Nở Ngàn Cánh Hoa", icon: "🪷" },
            { id: "poneglyph_study", label: "📖 Đọc Cổ Thư Poneglyph", icon: "📖" },
            { id: "afternoon_tea", label: "☕ Trà Chiều Thư Giãn", icon: "☕" },
          ],
          "agent-brook-musician": [
            { id: "violin_concert", label: "🎻 Hòa Nhạc Binks", icon: "🎻" },
            { id: "ice_slash", label: "❄️ Kiếm Băng Soul Solid", icon: "❄️" },
            { id: "tea_joke", label: "🎩 Yo-ho-ho-ho!", icon: "🎩" },
          ],
          "agent-jinbe-helmsman": [
            { id: "karate_kata", label: "🌊 Karate Người Cá", icon: "🌊" },
            { id: "helm_steer", label: "⚓ Cầm Lái Bánh Lái Tàu", icon: "⚓" },
            { id: "zen_meditation", label: "🧘 Khí Công Đại Dương", icon: "🧘" },
          ],
        };

        const routines = AGENT_ROUTINES[agent.id] || [];
        const currentActivity = useWorldStore.getState().agentActivities[agent.id];
        const setAgentActivity = useWorldStore.getState().setAgentActivity;

        if (routines.length === 0) return null;

        return (
          <div className="flex flex-col gap-1.5 p-2.5 rounded-2xl bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              Hành Động & Thói Quen Thường Nhật:
            </span>
            <div className="grid grid-cols-1 gap-1.5 mt-1">
              {routines.map((r) => {
                const isActive = currentActivity === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setAgentActivity(agent.id, r.id)}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                      isActive
                        ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/25 border border-amber-300"
                        : "bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700/80 border border-slate-700/50"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">{r.label}</span>
                    {isActive && (
                      <span className="text-[9px] uppercase font-extrabold tracking-wider px-1.5 py-0.5 bg-slate-950/30 text-slate-950 rounded">
                        Đang làm
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Description / Lore */}
      {agent.description && (
        <p className="text-[11px] text-slate-400 leading-relaxed italic border-t border-slate-800 pt-2">
          "{agent.description}"
        </p>
      )}

      {/* Footer Controls */}
      <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
        <button
          onClick={resetToTacticalOverview}
          className="px-3 py-1.5 rounded-xl text-[11px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-all flex items-center gap-1.5 cursor-pointer"
        >
          <Compass className="w-3.5 h-3.5" />
          Toàn Cảnh
        </button>

        {(onOpenTaskModal || onOpenMissionDispatcher) && (
          <button
            onClick={() => {
              if (onOpenTaskModal) onOpenTaskModal();
              else if (onOpenMissionDispatcher) onOpenMissionDispatcher();
            }}
            className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20 transition-all flex items-center gap-1 cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5" />
            Giao Nhiệm Vụ
          </button>
        )}
      </div>
    </div>
  );
}
