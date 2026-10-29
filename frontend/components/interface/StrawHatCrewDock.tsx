"use client";

import React from "react";
import { useWorldStore } from "@/store/worldStore";

const CREW_MEMBERS = [
  {
    id: "agent-captain-roger",
    name: "Luffy",
    role: "Thuyền Trưởng",
    color: "#ef4444",
    avatarIcon: "👒",
    cameraPos: [2, 5, 8] as [number, number, number],
    targetPos: [2, 2.2, 2] as [number, number, number],
  },
  {
    id: "agent-zoro-quartermaster",
    name: "Zoro",
    role: "Kiếm Sĩ",
    color: "#10b981",
    avatarIcon: "⚔️",
    cameraPos: [6, 6, 17] as [number, number, number],
    targetPos: [6, 3.6, 11] as [number, number, number],
  },
  {
    id: "agent-nami-navigator",
    name: "Nami",
    role: "Hoa Tiêu",
    color: "#f59e0b",
    avatarIcon: "🗺️",
    cameraPos: [10, 5, 7] as [number, number, number],
    targetPos: [9, 2.8, 1] as [number, number, number],
  },
  {
    id: "agent-usopp-sniper",
    name: "Usopp",
    role: "Xạ Thủ",
    color: "#f97316",
    avatarIcon: "🎯",
    cameraPos: [-6, 5, 12] as [number, number, number],
    targetPos: [-6, 3.4, 6] as [number, number, number],
  },
  {
    id: "agent-sanji-cook",
    name: "Sanji",
    role: "Đầu Bếp",
    color: "#3b82f6",
    avatarIcon: "🍳",
    cameraPos: [-10, 5, 8] as [number, number, number],
    targetPos: [-10, 2.2, 2] as [number, number, number],
  },
  {
    id: "agent-chopper-doctor",
    name: "Chopper",
    role: "Bác Sĩ",
    color: "#ec4899",
    avatarIcon: "🌸",
    cameraPos: [1, 4, -8] as [number, number, number],
    targetPos: [1, 2.4, -4] as [number, number, number],
  },
  {
    id: "agent-robin-scholar",
    name: "Robin",
    role: "Khảo Cổ",
    color: "#a855f7",
    avatarIcon: "🪷",
    cameraPos: [-6, 6, -8] as [number, number, number],
    targetPos: [-6, 3.2, -3] as [number, number, number],
  },
  {
    id: "agent-franky-shipwright",
    name: "Franky",
    role: "Thợ Đóng Tàu",
    color: "#06b6d4",
    avatarIcon: "🔨",
    cameraPos: [-14, 5, 14] as [number, number, number],
    targetPos: [-14, 2.4, 9] as [number, number, number],
  },
  {
    id: "agent-brook-musician",
    name: "Brook",
    role: "Nhạc Công",
    color: "#14b8a6",
    avatarIcon: "🎻",
    cameraPos: [-3, 6, 16] as [number, number, number],
    targetPos: [-3, 3.8, 10] as [number, number, number],
  },
  {
    id: "agent-jinbe-helmsman",
    name: "Jinbe",
    role: "Lái Tàu",
    color: "#0284c7",
    avatarIcon: "🌊",
    cameraPos: [-8, 6, 14] as [number, number, number],
    targetPos: [-8, 3.5, 8] as [number, number, number],
  },
];

export default function StrawHatCrewDock() {
  const selectedAgentId = useWorldStore((s) => s.selectedAgentId);
  const selectAgent = useWorldStore((s) => s.selectAgent);
  const smoothFocusCamera = useWorldStore((s) => s.smoothFocusCamera);
  const agentActivities = useWorldStore((s) => s.agentActivities);
  const setAgentActivity = useWorldStore((s) => s.setAgentActivity);

  return (
    <aside aria-label="Thanh Điều Khiển Thủy Thủ Đoàn" className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
      <div className="flex items-center gap-1.5 p-1.5 rounded-2xl glass-panel shadow-2xl border border-slate-700/70 backdrop-blur-xl">
        <div className="hidden sm:flex items-center px-2 text-[10px] font-bold text-amber-400 uppercase tracking-widest border-r border-slate-800">
          Crew
        </div>

        {CREW_MEMBERS.map((member) => {
          const isSelected = selectedAgentId === member.id;
          const currentActivity = agentActivities[member.id];

          return (
            <button
              key={member.id}
              onClick={() => {
                selectAgent(member.id);
                smoothFocusCamera(member.cameraPos, member.targetPos);
              }}
              className={`group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                isSelected
                  ? "bg-amber-500 text-slate-950 font-bold shadow-lg shadow-amber-500/25 scale-105"
                  : "bg-slate-900/60 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800"
              }`}
              title={`${member.name} (${member.role}) - ${currentActivity || "Sẵn sàng"}`}
            >
              <span className="text-base select-none">{member.avatarIcon}</span>
              <span className="text-xs font-semibold hidden md:inline">{member.name}</span>

              {/* Status indicator pip */}
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: isSelected ? "#0f172a" : member.color }}
              />

              {/* Hover Tooltip showing current daily routine */}
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-slate-950 text-slate-200 text-[10px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-md border border-slate-800">
                {member.role}: {currentActivity || "Túc trực"}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
