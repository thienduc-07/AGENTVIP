"use client";

import React from "react";
import { useWorldStore } from "@/store/worldStore";

const CORPORATE_LEADERS = [
  {
    id: "agent-exec-ceo",
    name: "Victoria Vance",
    role: "CEO & Strategy",
    color: "#3b82f6",
    avatarIcon: "🏛️",
    cameraPos: [0, 6.5, -4] as [number, number, number],
    targetPos: [0, 1.2, -10] as [number, number, number],
  },
  {
    id: "agent-eng-lead",
    name: "David Chen",
    role: "Principal Architect",
    color: "#0ea5e9",
    avatarIcon: "💻",
    cameraPos: [-8, 6.5, 2] as [number, number, number],
    targetPos: [-14, 1.2, -4] as [number, number, number],
  },
  {
    id: "agent-research-ai",
    name: "Dr. Elena Rostova",
    role: "Chief AI Scientist",
    color: "#8b5cf6",
    avatarIcon: "🔬",
    cameraPos: [-8, 6.5, 16] as [number, number, number],
    targetPos: [-14, 1.2, 10] as [number, number, number],
  },
  {
    id: "agent-mkt-growth",
    name: "Sophia Martinez",
    role: "VP Marketing",
    color: "#f43f5e",
    avatarIcon: "📈",
    cameraPos: [8, 6.5, 2] as [number, number, number],
    targetPos: [14, 1.2, -4] as [number, number, number],
  },
  {
    id: "agent-sales-director",
    name: "Marcus Reynolds",
    role: "Director of Sales",
    color: "#10b981",
    avatarIcon: "🤝",
    cameraPos: [8, 6.5, 16] as [number, number, number],
    targetPos: [14, 1.2, 10] as [number, number, number],
  },
  {
    id: "agent-fin-controller",
    name: "Julian Thorne",
    role: "CFO & Treasury",
    color: "#eab308",
    avatarIcon: "⚖️",
    cameraPos: [2, 6.0, 2] as [number, number, number],
    targetPos: [6, 1.2, -4] as [number, number, number],
  },
  {
    id: "agent-ops-recruiter",
    name: "Amara Okafor",
    role: "Head of Operations",
    color: "#06b6d4",
    avatarIcon: "⚙️",
    cameraPos: [-2, 6.0, 2] as [number, number, number],
    targetPos: [-6, 1.2, -4] as [number, number, number],
  },
  {
    id: "agent-support-lead",
    name: "Liam O'Connor",
    role: "Customer Success",
    color: "#14b8a6",
    avatarIcon: "🎧",
    cameraPos: [0, 6.0, 6] as [number, number, number],
    targetPos: [0, 1.2, 12] as [number, number, number],
  },
];

export default function CorporateAgentDock() {
  const selectedAgentId = useWorldStore((s) => s.selectedAgentId);
  const selectAgent = useWorldStore((s) => s.selectAgent);
  const smoothFocusCamera = useWorldStore((s) => s.smoothFocusCamera);
  const agents = useWorldStore((s) => s.agents);

  const handleSelect = (member: typeof CORPORATE_LEADERS[0]) => {
    selectAgent(member.id);
    smoothFocusCamera(member.cameraPos, member.targetPos);
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
      <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-900/90 backdrop-blur-xl border border-slate-700/60 rounded-2xl shadow-2xl">
        <div className="flex items-center gap-1.5 pr-2 mr-1 border-r border-slate-700/60 text-xs font-semibold text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>HQ DEPARTMENTS</span>
        </div>

        <div className="flex items-center gap-1">
          {CORPORATE_LEADERS.map((member) => {
            const isSelected = selectedAgentId === member.id;
            const liveAgent = agents[member.id];
            const isWorking = liveAgent?.status === "working";
            const isApproval = liveAgent?.status === "waiting_approval";

            return (
              <button
                key={member.id}
                onClick={() => handleSelect(member)}
                className={`relative group flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all duration-200 ${
                  isSelected
                    ? "bg-slate-800 border border-slate-600 shadow-lg text-white"
                    : "hover:bg-slate-800/60 text-slate-400 hover:text-slate-200"
                }`}
                style={{
                  borderLeft: isSelected ? `3px solid ${member.color}` : undefined,
                }}
              >
                <span className="text-sm">{member.avatarIcon}</span>
                <span className="text-xs font-medium hidden sm:inline">{member.name.split(" ")[0]}</span>

                {/* Status Dot */}
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isApproval
                      ? "bg-rose-500 animate-ping"
                      : isWorking
                      ? "bg-amber-400 animate-pulse"
                      : "bg-emerald-500"
                  }`}
                />

                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center pointer-events-none whitespace-nowrap z-50">
                  <div className="px-2.5 py-1 bg-slate-950/95 text-xs text-slate-200 rounded-md border border-slate-700 shadow-xl">
                    <span className="font-semibold text-white">{member.name}</span>
                    <span className="text-slate-400 ml-1.5">({member.role})</span>
                  </div>
                  <div className="w-1.5 h-1.5 bg-slate-950 border-r border-b border-slate-700 rotate-45 -mt-1" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
