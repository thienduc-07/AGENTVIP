"use client";

import React, { useState } from "react";
import {
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
} from "lucide-react";
import { ApiToolActivity } from "@/types/workstation";

interface ToolActivityMonitorProps {
  activities: ApiToolActivity[];
  isLoading?: boolean;
}

export default function ToolActivityMonitor({
  activities,
  isLoading = false,
}: ToolActivityMonitorProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const formatDuration = (ms?: number) => {
    if (ms === undefined || ms === null) return "--";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="flex flex-col h-full bg-slate-950/90 text-slate-100 rounded-lg border border-slate-800/80 overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-sky-400" />
          <span className="font-semibold text-xs text-slate-200 tracking-wide">
            THEO DÕI HOẠT ĐỘNG CÔNG CỤ (TOOL TRACE)
          </span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">
            {activities.length} lệnh gọi
          </span>
        </div>
      </div>

      {/* Activity List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 py-12">
            <Wrench className="w-8 h-8 opacity-40" />
            <p className="italic text-xs">Chưa có công cụ nào được gọi trong phiên thực thi này.</p>
          </div>
        ) : (
          activities.map((act) => {
            const isExpanded = expandedId === act.tool_call_id;
            const isRunning = act.status === "RUNNING";
            const isFailed = act.status === "FAILED";
            const isSucceeded = act.status === "SUCCEEDED";

            return (
              <div
                key={act.tool_call_id}
                className="rounded-lg border border-slate-800/80 bg-slate-900/60 overflow-hidden text-xs transition-colors hover:border-slate-700"
              >
                {/* Item Row Header */}
                <div
                  onClick={() => toggleExpand(act.tool_call_id)}
                  className="flex items-center justify-between p-2.5 cursor-pointer hover:bg-slate-800/40 select-none"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Status Icon */}
                    {isRunning && (
                      <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                    )}
                    {isSucceeded && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                    {isFailed && (
                      <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}

                    {/* Tool Name */}
                    <span className="font-mono font-semibold text-slate-200 truncate">
                      {act.tool_name}
                    </span>

                    {/* Status Pill */}
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                        isRunning
                          ? "bg-sky-950 text-sky-300 border border-sky-800"
                          : isSucceeded
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          : "bg-rose-950 text-rose-300 border border-rose-800"
                      }`}
                    >
                      {act.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {/* Duration */}
                    <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>{formatDuration(act.duration_ms)}</span>
                    </div>

                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                </div>

                {/* Collapsible Details */}
                {isExpanded && (
                  <div className="p-3 border-t border-slate-800 bg-slate-950/70 space-y-2 text-[11px] font-mono">
                    {/* Tool Call ID */}
                    <div className="flex items-center justify-between text-slate-500 text-[10px]">
                      <span>ID: {act.tool_call_id}</span>
                      <span>
                        {act.started_at ? new Date(act.started_at).toLocaleTimeString() : ""}
                      </span>
                    </div>

                    {/* Arguments */}
                    {act.arguments && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                          <Code2 className="w-3 h-3 text-sky-400" />
                          <span>Tham số đầu vào (Arguments):</span>
                        </div>
                        <pre className="p-2 rounded bg-slate-900 border border-slate-800/80 text-sky-300 overflow-x-auto whitespace-pre-wrap break-all max-h-40">
                          {typeof act.arguments === "object"
                            ? JSON.stringify(act.arguments, null, 2)
                            : String(act.arguments)}
                        </pre>
                      </div>
                    )}

                    {/* Result or Error */}
                    {act.result_summary && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase font-bold text-slate-400">
                          Kết quả tóm tắt (Result Summary):
                        </div>
                        <div className="p-2 rounded bg-slate-900 border border-emerald-900/40 text-emerald-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                          {act.result_summary}
                        </div>
                      </div>
                    )}

                    {act.error_message && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase font-bold text-rose-400">
                          Lỗi thực thi (Error):
                        </div>
                        <div className="p-2 rounded bg-rose-950/40 border border-rose-800 text-rose-300 whitespace-pre-wrap break-all">
                          {act.error_message}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
