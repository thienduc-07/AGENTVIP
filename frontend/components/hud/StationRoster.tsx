"use client";

import React from "react";
import { Shield, Anchor, BookOpen, Wrench, AlertTriangle, PlayCircle } from "lucide-react";
import { Agent, AgentStatus } from "@/types";

interface StationRosterProps {
  agents: Agent[];
  selectedAgent: Agent | null;
  onSelectAgent: (agent: Agent) => void;
}

export default function StationRoster({
  agents,
  selectedAgent,
  onSelectAgent,
}: StationRosterProps) {
  const getStationIcon = (station: string) => {
    switch (station) {
      case "executive_suite":
        return <Anchor className="w-4 h-4 text-blue-400" />;
      case "engineering_bay":
        return <Shield className="w-4 h-4 text-cyan-400" />;
      case "research_lab":
        return <BookOpen className="w-4 h-4 text-purple-400" />;
      case "marketing_studio":
        return <Wrench className="w-4 h-4 text-rose-400" />;
      case "sales_wing":
        return <Shield className="w-4 h-4 text-emerald-400" />;
      case "finance_office":
        return <Anchor className="w-4 h-4 text-amber-400" />;
      case "operations_hub":
        return <Wrench className="w-4 h-4 text-teal-400" />;
      case "support_lounge":
        return <BookOpen className="w-4 h-4 text-teal-300" />;
      default:
        return <PlayCircle className="w-4 h-4 text-slate-400" />;
    }
  };

  const getStatusBadge = (status: AgentStatus) => {
    switch (status) {
      case "THINKING":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-950 text-sky-300 border border-sky-500/40 animate-pulse">
            THINKING
          </span>
        );
      case "EXECUTING_TOOL":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950 text-amber-300 border border-amber-500/40 animate-pulse">
            RUNNING TOOL
          </span>
        );
      case "AWAITING_APPROVAL":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-950 text-red-200 border border-red-500/80 approval-pulse flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" /> APPROVAL
          </span>
        );
      case "COMPLETED":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-500/40">
            COMPLETED
          </span>
        );
      case "FAILED":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-950 text-rose-300 border border-rose-500/40">
            FAILED
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            IDLE
          </span>
        );
    }
  };

  return (
    <div className="absolute top-20 left-5 z-20 w-72 flex flex-col gap-2.5 pointer-events-auto">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Fleet Stations
        </h2>
        <span className="text-[10px] text-amber-400 font-mono">
          {agents.length} AGENTS ACTIVE
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {agents.map((agent) => {
          const isSelected = selectedAgent?.id === agent.id;
          const isUrgent = agent.status === "AWAITING_APPROVAL";

          return (
            <div
              key={agent.id}
              onClick={() => onSelectAgent(agent)}
              className={`p-3 rounded-2xl cursor-pointer transition-all ${
                isSelected
                  ? "bg-slate-900/95 border-2 border-amber-400/80 shadow-lg shadow-amber-500/10 scale-[1.02]"
                  : isUrgent
                  ? "bg-red-950/70 border-2 border-red-500/80 approval-pulse"
                  : "glass-card hover:border-slate-600/60"
              }`}
            >
              <div className="flex items-start justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60">
                    {getStationIcon(agent.station)}
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                      {agent.name}
                    </h3>
                    <p className="text-[10px] text-slate-400">{agent.role}</p>
                  </div>
                </div>
                {getStatusBadge(agent.status)}
              </div>

              {agent.description && (
                <p className="text-[10px] text-slate-400 line-clamp-2 mt-1">
                  {agent.description}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
