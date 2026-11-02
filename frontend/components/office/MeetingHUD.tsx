"use client";

import React, { useState, useEffect } from "react";
import { useMeetingStore } from "@/store/meetingStore";
import {
  Users,
  MessageSquare,
  Vote,
  Play,
  Pause,
  ChevronRight,
  ChevronDown,
  X,
  Compass,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Lightbulb,
  ShieldAlert,
  FastForward,
  LogOut,
  FolderOpen,
} from "lucide-react";
import {
  startMeeting,
  pauseMeeting,
  resumeMeeting,
  completeMeeting,
  executeMeetingTurn,
  castMeetingVote,
  resolveMeetingDecision,
} from "@/lib/api/meetings";

interface MeetingHUDProps {
  organizationId?: string;
  onExitMeetingView?: () => void;
  onFocusParticipant?: (agentId: string) => void;
  onFocusDisplay?: () => void;
  onOpenDiscovery?: () => void;
}

export default function MeetingHUD({
  organizationId = "org_default_company",
  onExitMeetingView,
  onFocusParticipant,
  onFocusDisplay,
  onOpenDiscovery,
}: MeetingHUDProps) {
  const activeMeeting = useMeetingStore((s) => s.activeMeeting);
  const isMeetingHUDOpen = useMeetingStore((s) => s.isMeetingHUDOpen);
  const toggleMeetingHUD = useMeetingStore((s) => s.toggleMeetingHUD);
  const participants = useMeetingStore((s) => s.participants);
  const messages = useMeetingStore((s) => s.messages);
  const decisions = useMeetingStore((s) => s.decisions);
  const actionItems = useMeetingStore((s) => s.actionItems);
  const currentSpeakerId = useMeetingStore((s) => s.currentSpeakerId);
  const deliberationStage = useMeetingStore((s) => s.deliberationStage);
  const selectedParticipantId = useMeetingStore((s) => s.selectedParticipantId);
  const setSelectedParticipantId = useMeetingStore((s) => s.setSelectedParticipantId);

  const [activeTab, setActiveTab] = useState<"discussion" | "participants" | "decisions" | "actions">("discussion");
  const [isExecutingTurn, setIsExecutingTurn] = useState(false);
  const [isPausingOrResuming, setIsPausingOrResuming] = useState(false);
  const [userVote, setUserVote] = useState<"YES" | "NO" | "ABSTAIN" | null>(null);

  // Compute active decision
  const activeDecision = Object.values(decisions).length > 0
    ? Object.values(decisions)[Object.values(decisions).length - 1]
    : null;

  // Real-time Meeting Duration Tracker
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  useEffect(() => {
    if (!activeMeeting?.started_at || activeMeeting.status !== "IN_PROGRESS") return;
    const startMs = new Date(activeMeeting.started_at).getTime();
    const interval = setInterval(() => {
      const now = Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((now - startMs) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeMeeting?.started_at, activeMeeting?.status]);

  const formatDuration = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Actions
  const handleTogglePause = async () => {
    if (!activeMeeting) return;
    setIsPausingOrResuming(true);
    try {
      if (activeMeeting.status === "IN_PROGRESS") {
        await pauseMeeting(activeMeeting.id, "Tạm dừng bởi điều phối viên", { organizationId });
      } else if (activeMeeting.status === "PAUSED" || activeMeeting.status === "WAITING_APPROVAL") {
        await resumeMeeting(activeMeeting.id, { organizationId });
      }
    } catch (err) {
      console.error("Error toggling pause state:", err);
    } finally {
      setIsPausingOrResuming(false);
    }
  };

  const handleAdvanceTurn = async () => {
    if (!activeMeeting) return;
    setIsExecutingTurn(true);
    try {
      await executeMeetingTurn(activeMeeting.id, { organizationId });
    } catch (err) {
      console.error("Error executing speaking turn:", err);
    } finally {
      setIsExecutingTurn(false);
    }
  };

  const handleCastVote = async (vote: "YES" | "NO" | "ABSTAIN") => {
    if (!activeMeeting || !activeDecision) return;
    setUserVote(vote);
    try {
      // Find moderator or first participant to represent operator vote
      const agentId = activeMeeting.moderator_agent_id || Object.keys(participants)[0];
      if (agentId) {
        await castMeetingVote(
          activeMeeting.id,
          activeDecision.id,
          { agent_id: agentId, vote, reasoning: "Biểu quyết từ điều phối viên con người" },
          { organizationId }
        );
      }
    } catch (err) {
      console.error("Error casting vote:", err);
    }
  };

  const handleResolveDecision = async (status: "APPROVED" | "REJECTED") => {
    if (!activeMeeting || !activeDecision) return;
    try {
      await resolveMeetingDecision(activeMeeting.id, activeDecision.id, status, { organizationId });
    } catch (err) {
      console.error("Error resolving decision:", err);
    }
  };

  if (!isMeetingHUDOpen) {
    return (
      <button
        onClick={toggleMeetingHUD}
        className="fixed bottom-6 left-6 z-30 pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900/90 border border-slate-700/80 shadow-2xl text-xs font-bold text-slate-100 hover:border-sky-400 hover:bg-slate-800 backdrop-blur-md transition-all"
      >
        <MessageSquare className="w-4 h-4 text-sky-400" />
        <span>Mở Bảng Điều Khiển Cuộc Họp</span>
      </button>
    );
  }

  return (
    <aside className="fixed top-20 right-6 bottom-6 w-[430px] z-30 pointer-events-auto flex flex-col rounded-3xl bg-slate-950/92 border border-slate-800/90 shadow-2xl backdrop-blur-xl overflow-hidden text-slate-100 select-none animate-in fade-in slide-in-from-right-4 duration-200">
      {/* 1. Header with Stage Tracker & Meeting Metadata */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-900/60">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 overflow-hidden">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                activeMeeting?.status === "IN_PROGRESS"
                  ? "bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse"
                  : activeMeeting?.status === "PAUSED"
                  ? "bg-amber-400"
                  : activeMeeting?.status === "WAITING_APPROVAL"
                  ? "bg-orange-400 animate-pulse"
                  : "bg-slate-500"
              }`}
            />
            <h2 className="text-xs font-bold text-slate-100 uppercase tracking-wider truncate">
              {activeMeeting ? activeMeeting.title : "Chưa chọn cuộc họp"}
            </h2>
          </div>

          <div className="flex items-center gap-1">
            {onOpenDiscovery && (
              <button
                onClick={onOpenDiscovery}
                title="Danh sách cuộc họp"
                className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={toggleMeetingHUD}
              className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stage Progress Tracker */}
        <div className="flex items-center gap-1.5 py-1 text-[10px] font-mono font-semibold">
          <span className="text-slate-400">Giai đoạn:</span>
          <span className="px-2 py-0.5 rounded-md bg-sky-950 text-sky-300 border border-sky-800/80">
            {deliberationStage}
          </span>
          <span className="ml-auto text-slate-400">
            ⏱ {formatDuration(elapsedSeconds)}
          </span>
        </div>

        {/* Objective Preview */}
        {activeMeeting?.objective && (
          <p className="text-[11px] text-slate-400 line-clamp-2 mt-1">
            {activeMeeting.objective}
          </p>
        )}
      </div>

      {/* 2. Navigation Tabs */}
      <div className="flex items-center border-b border-slate-800/80 bg-slate-900/30 px-3 text-xs">
        <button
          onClick={() => setActiveTab("discussion")}
          className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 font-semibold transition-all ${
            activeTab === "discussion"
              ? "border-sky-400 text-sky-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Thảo luận ({messages.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("participants")}
          className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 font-semibold transition-all ${
            activeTab === "participants"
              ? "border-sky-400 text-sky-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Đặc vụ ({Object.keys(participants).length})</span>
        </button>

        <button
          onClick={() => setActiveTab("decisions")}
          className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 font-semibold transition-all ${
            activeTab === "decisions"
              ? "border-sky-400 text-sky-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Vote className="w-3.5 h-3.5" />
          <span>Biểu quyết ({Object.keys(decisions).length})</span>
        </button>
      </div>

      {/* 3. Tab Body Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 font-sans text-xs">
        {/* A. DISCUSSION STREAM */}
        {activeTab === "discussion" && (
          <div className="space-y-3">
            {messages.length === 0 ? (
              <div className="text-center py-10 text-slate-500">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>Chưa có phát biểu nào được ghi nhận.</p>
                <p className="text-[11px] mt-1">Bấm "Tiến Lượt" bên dưới để kích hoạt phát biểu đầu tiên.</p>
              </div>
            ) : (
              messages.map((msg) => {
                const part = msg.agent_id ? participants[msg.agent_id] : null;
                const isSpeaker = currentSpeakerId === msg.agent_id;

                return (
                  <div
                    key={msg.id}
                    className={`p-3.5 rounded-2xl border transition-all ${
                      isSpeaker
                        ? "bg-sky-950/40 border-sky-500/50 shadow-md ring-1 ring-sky-500/20"
                        : "bg-slate-900/60 border-slate-800/80"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-200">
                          {msg.agent_name || part?.agent_name || "Đặc vụ"}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-slate-800 text-slate-300">
                          {part?.role || "SPECIALIST"}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800/90 text-sky-400 border border-slate-700/60">
                        {msg.message_type}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                      {msg.content}
                    </p>

                    {/* Structured Metadata Badges if present */}
                    {msg.metadata_json && (
                      <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                        {msg.metadata_json.confidence && (
                          <span className="text-sky-300">
                            Độ tin cậy: {(Number(msg.metadata_json.confidence) * 100).toFixed(0)}%
                          </span>
                        )}
                        {msg.metadata_json.risks && (
                          <span className="text-rose-300 flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3" /> Cảnh báo rủi ro
                          </span>
                        )}
                        {msg.metadata_json.proposed_actions?.length > 0 && (
                          <span className="text-emerald-300">
                            +{msg.metadata_json.proposed_actions.length} hành động
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* B. PARTICIPANTS LIST */}
        {activeTab === "participants" && (
          <div className="space-y-2">
            {Object.values(participants).map((p) => {
              const isSpeaking = currentSpeakerId === p.agent_id;
              const isSelected = selectedParticipantId === p.agent_id;

              return (
                <div
                  key={p.id}
                  onClick={() => {
                    setSelectedParticipantId(p.agent_id);
                    onFocusParticipant?.(p.agent_id);
                  }}
                  className={`p-3 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                    isSelected
                      ? "bg-sky-950/60 border-sky-400 ring-2 ring-sky-400/20"
                      : isSpeaking
                      ? "bg-slate-900 border-sky-500/50"
                      : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 border border-slate-600 flex items-center justify-center font-bold text-xs text-sky-400">
                      {p.agent_name?.[0] || p.role[0]}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100">{p.agent_name || p.agent_id}</span>
                        {isSpeaking && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 animate-pulse">
                            ĐANG PHÁT BIỂU
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {p.role} • Thứ tự: #{p.speaking_order} • Lượt: {p.contribution_count}
                      </span>
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-slate-500" />
                </div>
              );
            })}
          </div>
        )}

        {/* C. DECISIONS & VOTING */}
        {activeTab === "decisions" && (
          <div className="space-y-3">
            {Object.values(decisions).length === 0 ? (
              <div className="text-center py-10 text-slate-500">
                <Vote className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>Chưa có quyết định nào được đề xuất.</p>
              </div>
            ) : (
              Object.values(decisions).map((dec) => {
                const yesCount = (dec.votes || []).filter((v) => v.vote === "YES").length;
                const noCount = (dec.votes || []).filter((v) => v.vote === "NO").length;

                return (
                  <div key={dec.id} className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-sky-400">
                        {dec.decision_type}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                          dec.status === "APPROVED"
                            ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                            : dec.status === "REJECTED"
                            ? "bg-rose-950 text-rose-400 border border-rose-800"
                            : dec.status === "REQUIRES_HUMAN_APPROVAL"
                            ? "bg-orange-950 text-orange-400 border border-orange-800 animate-pulse"
                            : "bg-amber-950 text-amber-400 border border-amber-800"
                        }`}
                      >
                        {dec.status}
                      </span>
                    </div>

                    <h4 className="text-xs font-bold text-slate-100">{dec.title}</h4>
                    <p className="text-[11px] text-slate-300 leading-relaxed">{dec.description}</p>

                    <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                      <span className="text-emerald-400 font-semibold">✓ {yesCount} Đồng ý</span>
                      <span className="text-rose-400 font-semibold">✗ {noCount} Bác bỏ</span>
                      <span className="text-slate-400 font-mono">Tổng: {dec.votes?.length || 0}</span>
                    </div>

                    {/* Operator Decision Actions if WAITING_APPROVAL */}
                    {dec.status === "REQUIRES_HUMAN_APPROVAL" && (
                      <div className="pt-2 flex items-center gap-2">
                        <button
                          onClick={() => handleResolveDecision("APPROVED")}
                          className="flex-1 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] transition-colors"
                        >
                          Phê duyệt phương án
                        </button>
                        <button
                          onClick={() => handleResolveDecision("REJECTED")}
                          className="flex-1 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[11px] transition-colors"
                        >
                          Từ chối
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 4. Operator Human Control Footer */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-900/80 space-y-2.5">
        {/* Active Decision Quick Voting Bar */}
        {activeDecision && (activeDecision.status === "PROPOSED" || activeDecision.status === "VOTING") && (
          <div className="flex items-center gap-2 pb-1">
            <span className="text-[11px] text-slate-400 shrink-0">Biểu quyết:</span>
            <button
              onClick={() => handleCastVote("YES")}
              className={`flex-1 py-1 rounded-xl text-[11px] font-bold border transition-colors ${
                userVote === "YES"
                  ? "bg-emerald-600 border-emerald-400 text-white"
                  : "bg-slate-800 border-slate-700 hover:border-emerald-500 text-slate-200"
              }`}
            >
              Đồng ý (YES)
            </button>
            <button
              onClick={() => handleCastVote("NO")}
              className={`flex-1 py-1 rounded-xl text-[11px] font-bold border transition-colors ${
                userVote === "NO"
                  ? "bg-rose-600 border-rose-400 text-white"
                  : "bg-slate-800 border-slate-700 hover:border-rose-500 text-slate-200"
              }`}
            >
              Bác bỏ (NO)
            </button>
          </div>
        )}

        {/* Primary Controls Row */}
        <div className="flex items-center gap-2">
          {/* Pause / Resume Button */}
          <button
            onClick={handleTogglePause}
            disabled={isPausingOrResuming || !activeMeeting}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-bold transition-all ${
              activeMeeting?.status === "PAUSED"
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg"
                : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            }`}
          >
            {activeMeeting?.status === "PAUSED" ? (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Tiếp tục</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Tạm dừng</span>
              </>
            )}
          </button>

          {/* Advance Turn Button */}
          <button
            onClick={handleAdvanceTurn}
            disabled={isExecutingTurn || activeMeeting?.status !== "IN_PROGRESS"}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-sky-900/30 transition-all disabled:opacity-50"
          >
            <FastForward className="w-4 h-4" />
            <span>{isExecutingTurn ? "Đang xử lý..." : "Tiến Lượt Tiếp Theo"}</span>
          </button>

          {/* Exit View Button */}
          {onExitMeetingView && (
            <button
              onClick={onExitMeetingView}
              title="Rời góc nhìn phòng họp"
              className="p-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors border border-slate-700"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

