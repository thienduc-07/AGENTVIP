"use client";

import React, { useState, useRef, useEffect } from "react";
import { KNOWN_AGENTS, routeUserPrompt, AgentCandidate } from "@/lib/ai/agentRouter";
import { EventEnvelope } from "@/types/events";

export interface ChatMessage {
  id: string;
  sender: "user" | "agent" | "system";
  agentInfo?: AgentCandidate;
  text: string;
  timestamp: string;
  taskId?: string;
  status?: "pending" | "executing" | "waiting_approval" | "completed" | "error";
  routingReason?: string;
  toolCalls?: Array<{ name: string; args?: any; result?: any }>;
  approvalData?: {
    actionId: string;
    toolName: string;
    params: any;
  };
}

interface AgentChatCommandCenterProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitTask: (agentId: string, promptText: string) => Promise<void>;
  onSubmitWorkflow: (title: string, description: string) => Promise<void>;
  onApprovalDecision?: (actionId: string, decision: "APPROVE" | "REJECT") => Promise<void>;
  pendingAction?: any;
}

export default function AgentChatCommandCenter({
  isOpen,
  onClose,
  onSubmitTask,
  onSubmitWorkflow,
  onApprovalDecision,
  pendingAction,
}: AgentChatCommandCenterProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>("auto");
  const [inputText, setInputText] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome-msg",
      sender: "system",
      text: "Xin chào! Đây là Trung Tâm Điều Hành AI Agent City 5.0. Bạn có thể gửi yêu cầu bằng ngôn ngữ tự nhiên. Hệ thống sẽ tự động phân tích và điều phối chuyên viên phù hợp nhất hoặc phối hợp đa phòng ban.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSubmitting]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isSubmitting) return;

    // 1. Analyze and route prompt
    const route = routeUserPrompt(text, selectedAgentId);

    const userMsgId = `user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: "user",
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const agentMsgId = `agent-${Date.now()}`;
    const agentPendingMsg: ChatMessage = {
      id: agentMsgId,
      sender: "agent",
      agentInfo: route.selectedAgent,
      text: "Đang tiếp nhận chỉ thị, khởi tạo tiến trình thực thi trên máy chủ...",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      status: "executing",
      routingReason: route.reasoning,
    };

    setMessages((prev) => [...prev, userMsg, agentPendingMsg]);
    setInputText("");
    setIsSubmitting(true);

    try {
      if (route.isMultiAgentWorkflow) {
        await onSubmitWorkflow(text.slice(0, 80), text);
      } else {
        await onSubmitTask(route.selectedAgent.id, text);
      }

      // Update agent message once dispatched
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? {
                ...m,
                text: `Chỉ thị đã được chuyển giao thành công cho ${route.selectedAgent.name} (${route.selectedAgent.role}). Chuyên viên đang làm việc tại Bàn làm việc ở Tầng ${route.selectedAgent.floor}. Quá trình thực thi đang được đồng bộ trực tiếp lên văn phòng 3D.`,
                status: "completed",
              }
            : m
        )
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? {
                ...m,
                text: `Lỗi khởi tạo nhiệm vụ: ${err?.message || "Không thể kết nối backend"}`,
                status: "error",
              }
            : m
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-slate-950/95 backdrop-blur-2xl border-l border-slate-800 shadow-2xl flex flex-col text-slate-100 font-sans transition-all animate-in slide-in-from-right duration-200">
      {/* Top Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80 bg-slate-900/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center font-black text-slate-950 text-base shadow-lg shadow-amber-500/30">
            AI
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm text-slate-100 tracking-wide uppercase">
                AI COMMAND CENTER
              </span>
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <span className="text-[11px] text-slate-400">
              Điều phối chuyên viên & thực thi tự động
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              setMessages([
                {
                  id: "welcome-reset",
                  sender: "system",
                  text: "Đã tạo phiên hội thoại mới. Mời bạn nhập yêu cầu hoặc câu hỏi.",
                  timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                },
              ])
            }
            title="Đoạn chat mới"
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs transition-colors"
          >
            + Mới
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white text-xs transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Agent Selector Toolbar */}
      <div className="px-5 py-2.5 bg-slate-900/30 border-b border-slate-800/60 flex items-center justify-between gap-3 text-xs">
        <span className="text-slate-400 font-medium whitespace-nowrap">Chuyên Viên:</span>
        <select
          value={selectedAgentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
          className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs font-semibold focus:outline-none focus:border-amber-400 transition-colors"
        >
          <option value="auto">⚡ Tự động phân tích (Khuyên dùng)</option>
          {KNOWN_AGENTS.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} — {agent.role} (Tầng {agent.floor})
            </option>
          ))}
        </select>
      </div>

      {/* Chat Messages Feed */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.sender === "user"
                ? "items-end"
                : msg.sender === "system"
                ? "items-center"
                : "items-start"
            }`}
          >
            {msg.sender === "system" ? (
              <div className="px-3.5 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-slate-400 text-xs text-center max-w-[90%] leading-relaxed">
                {msg.text}
              </div>
            ) : msg.sender === "user" ? (
              <div className="max-w-[85%] flex flex-col items-end">
                <div className="px-4 py-2.5 rounded-2xl rounded-tr-sm bg-amber-500 text-slate-950 font-medium text-sm leading-relaxed shadow-lg shadow-amber-500/20">
                  {msg.text}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 mr-1">{msg.timestamp}</span>
              </div>
            ) : (
              <div className="max-w-[90%] flex flex-col items-start gap-1">
                {/* Agent Header Tag */}
                {msg.agentInfo && (
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-amber-400 text-xs">
                      {msg.agentInfo.name.charAt(0)}
                    </div>
                    <span className="font-bold text-xs text-slate-200">{msg.agentInfo.name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                      Tầng {msg.agentInfo.floor}
                    </span>
                  </div>
                )}

                {/* Routing Badge */}
                {msg.routingReason && (
                  <div className="text-[11px] px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-center gap-1.5 mb-1">
                    <span>🧭</span>
                    <span>{msg.routingReason}</span>
                  </div>
                )}

                {/* Bubble Body */}
                <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-slate-900 border border-slate-800 text-slate-200 text-sm leading-relaxed shadow-lg">
                  {msg.text}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 ml-1">{msg.timestamp}</span>
              </div>
            )}
          </div>
        ))}

        {/* Pending Approval Widget in Chat if action requires user confirmation */}
        {pendingAction && (
          <div className="p-4 rounded-xl bg-amber-950/80 border border-amber-500/60 shadow-xl space-y-2 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
              <span>⚠️ CẦN BẠN DUYỆT THỰC THI</span>
            </div>
            <div className="text-xs text-slate-200">
              Công cụ: <code className="text-amber-300 font-mono">{pendingAction.tool_name || pendingAction.action}</code>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => onApprovalDecision?.(pendingAction.id, "APPROVE")}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors shadow-md shadow-emerald-600/30"
              >
                ✓ Phê Duyệt
              </button>
              <button
                onClick={() => onApprovalDecision?.(pendingAction.id, "REJECT")}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors shadow-md shadow-rose-600/30"
              >
                ✕ Từ Chối
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion Prompts */}
      <div className="px-5 py-2 flex items-center gap-2 overflow-x-auto border-t border-slate-800/40 bg-slate-950/60">
        {[
          "Viết API xác thực người dùng",
          "Phân tích dữ liệu chi phí",
          "Kiểm tra bảo mật backend",
          "Kế hoạch SEO & Marketing",
        ].map((sug, idx) => (
          <button
            key={idx}
            onClick={() => setInputText(sug)}
            className="px-2.5 py-1 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 whitespace-nowrap transition-colors"
          >
            {sug}
          </button>
        ))}
      </div>

      {/* Bottom Textarea Input Box */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-900/60 flex items-end gap-3">
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nhập yêu cầu hoặc câu hỏi... (Enter gửi, Shift+Enter xuống dòng)"
          rows={2}
          className="flex-1 p-3 rounded-xl bg-slate-900 border border-slate-700/80 text-slate-100 text-sm focus:outline-none focus:border-amber-400 placeholder:text-slate-500 resize-none transition-colors"
        />
        <button
          onClick={handleSend}
          disabled={!inputText.trim() || isSubmitting}
          className={`h-11 px-4 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center transition-all ${
            inputText.trim() && !isSubmitting
              ? "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/30"
              : "bg-slate-800 text-slate-500 cursor-not-allowed"
          }`}
        >
          {isSubmitting ? "..." : "Gửi"}
        </button>
      </div>
    </div>
  );
}

