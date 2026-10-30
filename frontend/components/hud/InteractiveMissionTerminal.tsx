"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Terminal,
  Download,
  ExternalLink,
  Layers,
  Sparkles,
  Zap,
  CheckCircle2,
  Clock,
  Play,
  FileText,
  Table,
  Code2,
  Video,
  X,
  Compass,
  ChevronRight,
  Shield,
  FileSpreadsheet,
} from "lucide-react";
import confetti from "canvas-confetti";
import { useWorldStore, QueueStep, DeliverableArtifact } from "@/store/worldStore";

const QUICK_PROMPTS = [
  {
    icon: "📄",
    title: "Tạo tài liệu PRD .docx",
    prompt: "Soạn thảo tài liệu đặc tả kỹ thuật PRD định dạng .docx bằng Anthropic docx skill cho hệ thống Multi-Agent Grand Line.",
  },
  {
    icon: "📊",
    title: "Mô hình tài chính .xlsx",
    prompt: "Phân tích tài chính và tạo bảng tính Excel .xlsx tự động bằng Anthropic xlsx skill cho kho báu và chi phí vận hành tàu Sunny.",
  },
  {
    icon: "🎨",
    title: "Landing Page WebGL 3D",
    prompt: "Thiết kế giao diện Landing Page WebGL 3D tương tác cao cấp phong cách Glassmorphism cho băng Mũ Rơm.",
  },
  {
    icon: "🚀",
    title: "MCP Server & Playwright",
    prompt: "Xây dựng MCP Server chuẩn Anthropic và kiểm thử tự động End-to-End với Playwright (webapp-testing skill).",
  },
];

export default function InteractiveMissionTerminal() {
  const isMissionTerminalOpen = useWorldStore((s) => s.isMissionTerminalOpen);
  const setIsMissionTerminalOpen = useWorldStore((s) => s.setIsMissionTerminalOpen);
  const chatMessages = useWorldStore((s) => s.chatMessages);
  const executionQueue = useWorldStore((s) => s.executionQueue);
  const activeDeliverables = useWorldStore((s) => s.activeDeliverables);
  const isExecutingMission = useWorldStore((s) => s.isExecutingMission);
  const executeMissionPipeline = useWorldStore((s) => s.executeMissionPipeline);

  const [activeTab, setActiveTab] = useState<"chat" | "queue" | "artifacts" | "skills">("chat");
  const [inputText, setInputText] = useState("");
  const [loadedSkills, setLoadedSkills] = useState<any[]>([]);
  const [activePreviewArtifact, setActivePreviewArtifact] = useState<DeliverableArtifact | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isExecutingMission]);

  // Fetch loaded Anthropic skills from backend API
  useEffect(() => {
    const fetchSkills = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/v1/skills");
        if (res.ok) {
          const data = await res.json();
          setLoadedSkills(data.skills || []);
        }
      } catch (err) {
        // Fallback demo skills
        setLoadedSkills([
          { name: "docx", description: "Create, read, and edit professional Word documents (.docx)" },
          { name: "xlsx", description: "Process and analyze Excel spreadsheets (.xlsx)" },
          { name: "pptx", description: "Design PowerPoint presentation slides (.pptx)" },
          { name: "pdf", description: "Extract, generate, and manipulate PDF files" },
          { name: "frontend-design", description: "Create modern web components with Tailwind/Vanilla CSS" },
          { name: "webapp-testing", description: "Automated browser testing and bug hunting with Playwright" },
          { name: "mcp-builder", description: "Scaffold and build Model Context Protocol (MCP) servers" },
          { name: "algorithmic-art", description: "Generate generative graphics, Canvas art, and audio SFX" },
        ]);
      }
    };
    fetchSkills();
  }, []);

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isExecutingMission) return;
    const p = inputText.trim();
    setInputText("");
    executeMissionPipeline(p);
  };

  const handleDownload = (artifact: DeliverableArtifact) => {
    // Generate real downloadable Blob
    const content = artifact.content || artifact.previewHtml || `Deliverable: ${artifact.title}`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = artifact.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.8 },
    });
  };

  if (!isMissionTerminalOpen) return null;

  return (
    <aside className="fixed top-16 right-4 bottom-4 w-[480px] max-w-[94vw] z-40 flex flex-col rounded-3xl bg-slate-950/85 backdrop-blur-2xl border border-blue-500/30 shadow-2xl shadow-black/80 overflow-hidden pointer-events-auto transition-all animate-in slide-in-from-right duration-300">
      {/* --- TERMINAL HEADER --- */}
      <div className="px-5 py-3.5 bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-950/90 border-b border-blue-500/20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-700 flex items-center justify-center shadow-md shadow-blue-500/30 text-white font-black text-sm">
            🏢
          </div>
          <div>
            <h2 className="text-xs font-black tracking-widest text-blue-300 uppercase flex items-center gap-2">
              <span>EXECUTIVE MISSION TERMINAL</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </h2>
            <p className="text-[10px] text-slate-400 font-mono">
              Autonomous Corporate Multi-Department Dispatcher
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isExecutingMission && (
            <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40 text-[10px] font-bold animate-pulse">
              ⚡ ĐANG THỰC THI
            </span>
          )}
          <button
            onClick={() => setIsMissionTerminalOpen(false)}
            className="w-7 h-7 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* --- NAVIGATION TABS --- */}
      <div className="flex px-3 pt-2 bg-slate-900/40 border-b border-slate-800/80 gap-1 text-xs">
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex-1 py-2 px-2.5 rounded-t-xl font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "chat"
              ? "bg-slate-900 text-amber-400 border-t border-x border-amber-500/40 shadow"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <span>💬 Trò Chuyện</span>
          <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300">
            {chatMessages.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("queue")}
          className={`flex-1 py-2 px-2.5 rounded-t-xl font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "queue"
              ? "bg-slate-900 text-cyan-400 border-t border-x border-cyan-500/40 shadow"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <span>⚡ Hàng Đợi</span>
          {executionQueue.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300">
              {executionQueue.filter((q) => q.status === "completed").length}/{executionQueue.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("artifacts")}
          className={`flex-1 py-2 px-2.5 rounded-t-xl font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "artifacts"
              ? "bg-slate-900 text-emerald-400 border-t border-x border-emerald-500/40 shadow"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <span>📦 Sản Phẩm</span>
          {activeDeliverables.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300">
              {activeDeliverables.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("skills")}
          className={`flex-1 py-2 px-2.5 rounded-t-xl font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "skills"
              ? "bg-slate-900 text-purple-400 border-t border-x border-purple-500/40 shadow"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <span>🛠️ 19 Skills</span>
        </button>
      </div>

      {/* --- TAB BODY CONTENT --- */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 no-scrollbar">
        {/* ========================================================
            TAB 1: INTERACTIVE CHAT & PROMPT DISPATCH
            ======================================================== */}
        {activeTab === "chat" && (
          <div className="flex flex-col gap-3 min-h-full justify-between">
            {/* Quick Action Suggestion Pills */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">
                Gợi ý lệnh nhanh (Anthropic Skills):
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {QUICK_PROMPTS.map((qp, idx) => (
                  <button
                    key={`qp-${idx}`}
                    onClick={() => {
                      setInputText(qp.prompt);
                    }}
                    disabled={isExecutingMission}
                    className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/40 text-left transition-all text-[11px] text-slate-300 hover:text-amber-200 flex items-center gap-1.5"
                  >
                    <span className="text-sm">{qp.icon}</span>
                    <span className="truncate font-medium">{qp.title}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Chat Message Stream - Strictly showing only user queries and final synthesized deliverables */}
            <div className="flex flex-col gap-2.5 my-2">
              {chatMessages
                .filter(
                  (msg) =>
                    msg.sender === "user" ||
                    msg.artifact !== undefined ||
                    msg.id.startsWith("final_") ||
                    msg.id.startsWith("init_") ||
                    msg.text.includes("NHIỆM VỤ ĐÃ HOÀN TẤT") ||
                    msg.text.includes("Chào mừng")
                )
                .map((msg) => {
                const isUser = msg.sender === "user";
                const isCEO = msg.sender === "ceo";

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[92%] ${
                      isUser ? "self-end" : "self-start"
                    }`}
                  >
                    {!isUser && (
                      <span className="text-[10px] font-bold text-blue-400 mb-0.5 flex items-center gap-1">
                        {isCEO ? "👑 Victoria Vance (CEO)" : msg.agentName || "Chuyên Viên Phòng Ban"}
                      </span>
                    )}

                    <div
                      className={`px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed shadow-lg ${
                        isUser
                          ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium rounded-tr-none"
                          : isCEO
                          ? "bg-slate-900/90 text-slate-100 border border-blue-500/40 rounded-tl-none"
                          : "bg-slate-900/80 text-slate-200 border border-slate-700/60 rounded-tl-none"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.text}</p>

                      {/* Attached Artifact Card inside chat */}
                      {msg.artifact && (
                        <div className="mt-2.5 p-2.5 rounded-xl bg-slate-950/80 border border-emerald-500/40 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">
                              {msg.artifact.type === "docx"
                                ? "📄"
                                : msg.artifact.type === "xlsx"
                                ? "📊"
                                : msg.artifact.type === "web"
                                ? "🌐"
                                : "📦"}
                            </span>
                            <div>
                              <p className="text-[11px] font-bold text-emerald-300">
                                {msg.artifact.filename}
                              </p>
                              <p className="text-[9px] text-slate-400">{msg.artifact.size}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {msg.artifact.previewHtml && (
                              <button
                                onClick={() => {
                                  setActivePreviewArtifact(msg.artifact || null);
                                  setActiveTab("artifacts");
                                }}
                                className="px-2 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-[10px] font-bold flex items-center gap-1"
                              >
                                <ExternalLink className="w-3 h-3" />
                                Xem
                              </button>
                            )}
                            <button
                              onClick={() => handleDownload(msg.artifact!)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[10px] font-black flex items-center gap-1 shadow-md shadow-emerald-500/20"
                            >
                              <Download className="w-3 h-3" />
                              Tải Về
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input Bar */}
            <form onSubmit={handleSendMessage} className="mt-auto pt-2 flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Nhập yêu cầu tác chiến (PRD docx, Excel xlsx, WebGL, Code...)"
                disabled={isExecutingMission}
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || isExecutingMission}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50 cursor-pointer"
              >
                {isExecutingMission ? (
                  <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Lệnh</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* ========================================================
            TAB 2: EXECUTION QUEUE & ANIME SKILLS STEPPER
            ======================================================== */}
        {activeTab === "queue" && (
          <div className="flex flex-col gap-3">
            <div className="p-3 rounded-2xl bg-slate-900/60 border border-cyan-500/30 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-cyan-300 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  HÀNG ĐỢI THỰC THI (SEQUENTIAL EXECUTION QUEUE)
                </h3>
                <p className="text-[11px] text-slate-400">
                  Chuỗi tác chiến vật lý và chuyển giao chiêu thức giữa các thành viên
                </p>
              </div>
            </div>

            {executionQueue.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs italic">
                Chưa có nhiệm vụ đang chạy. Hãy nhập mệnh lệnh vào tab Trò Chuyện để khởi động hạm đội!
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {executionQueue.map((step, idx) => {
                  const isDone = step.status === "completed";
                  const isFiring = step.status === "firing";
                  const isMoving = step.status === "moving";

                  return (
                    <div
                      key={step.id}
                      className={`p-3 rounded-2xl border transition-all flex flex-col gap-1.5 ${
                        isFiring
                          ? "bg-amber-950/40 border-amber-400 shadow-lg shadow-amber-500/10"
                          : isMoving
                          ? "bg-cyan-950/40 border-cyan-400 animate-pulse"
                          : isDone
                          ? "bg-slate-900/60 border-emerald-500/40"
                          : "bg-slate-900/40 border-slate-800 opacity-60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-slate-800 text-[11px] font-bold flex items-center justify-center text-slate-300">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-bold text-slate-200">
                            {step.agentName}
                          </span>
                        </div>

                        <span
                          className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-bold ${
                            isDone
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : isFiring
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-bounce"
                              : isMoving
                              ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                              : "bg-slate-800 text-slate-500"
                          }`}
                        >
                          {isDone ? "Hoàn thành" : isFiring ? "Tung chiêu VFX" : isMoving ? "Di chuyển" : "Chờ"}
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-300">{step.stepTitle}</p>

                      <div className="flex items-center gap-1.5 text-[10px] text-amber-300 font-medium">
                        <Sparkles className="w-3 h-3 text-amber-400" />
                        <span>Tuyệt kỹ: {step.vietnameseSkill}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            TAB 3: ARTIFACTS & LIVE DOWNLOADS
            ======================================================== */}
        {activeTab === "artifacts" && (
          <div className="flex flex-col gap-3">
            {activePreviewArtifact && (
              <div className="p-3 rounded-2xl bg-slate-900 border border-amber-500/40 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <span>Live Iframe Preview: {activePreviewArtifact.filename}</span>
                  </h4>
                  <button
                    onClick={() => setActivePreviewArtifact(null)}
                    className="text-slate-400 hover:text-white text-xs"
                  >
                    ✕ Đóng
                  </button>
                </div>
                <div
                  className="rounded-xl overflow-hidden border border-slate-800"
                  dangerouslySetInnerHTML={{
                    __html: activePreviewArtifact.previewHtml || "<div/>",
                  }}
                />
              </div>
            )}

            <div className="p-3 rounded-2xl bg-slate-900/60 border border-emerald-500/30 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-emerald-300 flex items-center gap-2">
                  <Download className="w-4 h-4 text-emerald-400" />
                  KHO SẢN PHẨM HOÀN THIỆN (DELIVERABLES)
                </h3>
                <p className="text-[11px] text-slate-400">
                  Tải về các tệp tin .docx, .xlsx, .pptx, .pdf, mã nguồn thực tế
                </p>
              </div>
            </div>

            {activeDeliverables.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs italic">
                Chưa có sản phẩm nào được tạo. Hãy chạy một nhiệm vụ trong Tab Trò Chuyện!
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {activeDeliverables.map((art) => (
                  <div
                    key={art.id}
                    className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-700/80 hover:border-emerald-500/40 transition-all flex flex-col gap-2 shadow-lg"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">
                          {art.type === "docx"
                            ? "📄"
                            : art.type === "xlsx"
                            ? "📊"
                            : art.type === "web"
                            ? "🌐"
                            : "⚙️"}
                        </span>
                        <div>
                          <h4 className="text-xs font-bold text-slate-100">{art.title}</h4>
                          <span className="text-[10px] font-mono text-emerald-400">
                            {art.filename} • {art.size}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleDownload(art)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/20 cursor-pointer transition-all"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Tải Về</span>
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {art.description}
                    </p>

                    {art.content && (
                      <pre className="p-2 rounded-xl bg-slate-950/90 border border-slate-800 text-[10px] font-mono text-slate-300 overflow-x-auto max-h-24">
                        {art.content}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            TAB 4: 19 ANTHROPIC SKILLS
            ======================================================== */}
        {activeTab === "skills" && (
          <div className="flex flex-col gap-2.5">
            <div className="p-3 rounded-2xl bg-slate-900/60 border border-purple-500/30 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-purple-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  KHO KỸ NĂNG ANTHROPIC SKILLS (19 SKILLS)
                </h3>
                <p className="text-[11px] text-slate-400">
                  Nạp trực tiếp từ ./agent-skills/skills/ vào 10 thành viên Mũ Rơm
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {loadedSkills.map((sk: any, idx: number) => (
                <div
                  key={`skill-card-${idx}`}
                  className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-purple-500/40 transition-all flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-300 font-mono">
                      {sk.name}
                    </span>
                    <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800">
                      Loaded
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {sk.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
