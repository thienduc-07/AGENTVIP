"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Terminal as TerminalIcon,
  Play,
  Pause,
  Copy,
  Check,
  Download,
  Trash2,
  Search,
  ArrowDown,
} from "lucide-react";
import { ApiTerminalLine } from "@/types/workstation";

interface LiveTerminalProps {
  lines: ApiTerminalLine[];
  autoScrollEnabled: boolean;
  onToggleAutoScroll: () => void;
  onClearBuffer: () => void;
  agentName?: string;
  executionId?: string;
}

export default function LiveTerminal({
  lines,
  autoScrollEnabled,
  onToggleAutoScroll,
  onClearBuffer,
  agentName = "AI Specialist",
  executionId,
}: LiveTerminalProps) {
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Auto-scroll on new lines when enabled and user hasn't manually scrolled up
  useEffect(() => {
    if (autoScrollEnabled && !userScrolledUp && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, autoScrollEnabled, userScrolledUp]);

  // Detect user scroll position
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setUserScrolledUp(!atBottom);
  };

  const scrollToBottom = () => {
    setUserScrolledUp(false);
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Filtered lines
  const filteredLines = useMemo(() => {
    if (!filterQuery.trim()) return lines;
    const q = filterQuery.toLowerCase();
    return lines.filter(
      (l) =>
        l.content.toLowerCase().includes(q) ||
        l.stream.toLowerCase().includes(q) ||
        String(l.sequence_number).includes(q)
    );
  }, [lines, filterQuery]);

  const handleCopyLogs = async () => {
    try {
      const fullText = lines
        .map(
          (l) =>
            `[${new Date(l.timestamp).toISOString()}] [${l.stream.toUpperCase()}] ${l.content}`
        )
        .join("\n");
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy terminal logs:", err);
    }
  };

  const handleDownloadLogs = () => {
    const fullText = lines
      .map(
        (l) =>
          `[${new Date(l.timestamp).toISOString()}] [${l.stream.toUpperCase()}] ${l.content}`
      )
      .join("\n");
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `terminal_${agentName.replace(/\s+/g, "_")}_${
      executionId || "session"
    }_${Date.now()}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    } catch {
      return "--:--:--";
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950/95 text-slate-100 font-mono text-xs select-text rounded-lg border border-slate-800/80 overflow-hidden shadow-2xl">
      {/* Terminal Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-900/90 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-slate-200 tracking-wide">
            LIVE TERMINAL
          </span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">
            {lines.length} dòng
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {/* Search box */}
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Lọc nội dung..."
              className="pl-7 pr-2 py-1 rounded bg-slate-950 border border-slate-700/60 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 w-28 sm:w-36 transition-all"
            />
          </div>

          {/* Autoscroll toggle */}
          <button
            onClick={onToggleAutoScroll}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-sans transition-colors cursor-pointer ${
              autoScrollEnabled
                ? "bg-emerald-950/70 border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/80"
                : "bg-slate-800/80 border-slate-700 text-slate-400 hover:bg-slate-700"
            }`}
            title={autoScrollEnabled ? "Đang bật tự cuộn" : "Đã tạm dừng tự cuộn"}
          >
            {autoScrollEnabled ? (
              <>
                <Pause className="w-3 h-3 text-emerald-400" />
                <span>Tự cuộn: BẬT</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 text-slate-400" />
                <span>Tự cuộn: TẮT</span>
              </>
            )}
          </button>

          {/* Copy logs */}
          <button
            onClick={handleCopyLogs}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-sans transition-colors cursor-pointer"
            title="Sao chép toàn bộ logs vào clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Đã chép</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Sao chép</span>
              </>
            )}
          </button>

          {/* Download logs */}
          <button
            onClick={handleDownloadLogs}
            className="p-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] transition-colors cursor-pointer"
            title="Tải xuống tệp .log"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Clear screen buffer */}
          <button
            onClick={onClearBuffer}
            className="p-1 rounded bg-slate-800/80 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-800 text-slate-400 border border-slate-700 text-[11px] transition-colors cursor-pointer"
            title="Xóa vùng đệm màn hình"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-1 bg-black/80 font-mono text-[11px] leading-relaxed relative"
      >
        {filteredLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 py-12">
            <TerminalIcon className="w-8 h-8 opacity-40" />
            <p className="italic">Chưa có dòng lệnh nào được ghi nhận cho phiên làm việc này.</p>
            <p className="text-[10px] text-slate-700">Các hoạt động suy nghĩ, gọi công cụ và ghi tệp sẽ hiển thị trực tiếp tại đây.</p>
          </div>
        ) : (
          filteredLines.map((line, idx) => {
            const isStderr = line.stream === "stderr";
            const isSystem = line.stream === "system";

            return (
              <div
                key={line.id || `line-${line.sequence_number}-${idx}`}
                className={`flex items-start gap-2 py-0.5 px-1 rounded transition-colors hover:bg-slate-900/60 ${
                  isStderr
                    ? "bg-rose-950/20 text-rose-300"
                    : isSystem
                    ? "text-sky-300"
                    : "text-slate-200"
                }`}
              >
                {/* Sequence & Timestamp */}
                <span className="text-[10px] text-slate-600 select-none shrink-0 w-8 text-right">
                  {line.sequence_number}
                </span>
                <span className="text-[10px] text-slate-500 select-none shrink-0">
                  {formatTimestamp(line.timestamp)}
                </span>

                {/* Stream Badge */}
                <span
                  className={`text-[9px] uppercase px-1 rounded select-none shrink-0 font-bold ${
                    isStderr
                      ? "bg-rose-950 border border-rose-800 text-rose-400"
                      : isSystem
                      ? "bg-sky-950 border border-sky-800 text-sky-400"
                      : "bg-emerald-950 border border-emerald-800 text-emerald-400"
                  }`}
                >
                  {line.stream}
                </span>

                {/* Content */}
                <div className="flex-1 whitespace-pre-wrap break-all select-text font-mono">
                  {line.content}
                </div>
              </div>
            );
          })
        )}
        <div ref={terminalEndRef} />
      </div>

      {/* Floating Scroll to Bottom pill */}
      {userScrolledUp && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-6 px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg flex items-center gap-1.5 text-xs font-sans animate-bounce cursor-pointer z-10"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          <span>Cuộn xuống mới nhất</span>
        </button>
      )}
    </div>
  );
}
