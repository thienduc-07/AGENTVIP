"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useMeetingStore } from "@/store/meetingStore";
import {
  Monitor,
  Activity,
  Vote,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lightbulb,
  ShieldAlert,
  Flame,
  Award,
} from "lucide-react";

interface MeetingPresentationScreenProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  width?: number;
  height?: number;
  onSelect?: () => void;
}

export default function MeetingPresentationScreen({
  position = [0, 1.85, 0.4],
  rotation = [0, 0, 0], // Faces South towards attendees (+Z)
  width = 4.2,
  height = 2.3,
  onSelect,
}: MeetingPresentationScreenProps) {
  const activeMeeting = useMeetingStore((s) => s.activeMeeting);
  const presentationMode = useMeetingStore((s) => s.presentationMode);
  const currentSpeakerId = useMeetingStore((s) => s.currentSpeakerId);
  const participants = useMeetingStore((s) => s.participants);
  const messages = useMeetingStore((s) => s.messages);
  const decisions = useMeetingStore((s) => s.decisions);
  const actionItems = useMeetingStore((s) => s.actionItems);
  const deliberationStage = useMeetingStore((s) => s.deliberationStage);

  const speaker = currentSpeakerId ? participants[currentSpeakerId] : null;
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  // Find latest or active decision
  const activeDecision = useMemo(() => {
    const list = Object.values(decisions);
    if (list.length === 0) return null;
    return list[list.length - 1];
  }, [decisions]);

  // Compute vote tallies if in voting mode
  const voteTallies = useMemo(() => {
    if (!activeDecision) return { yes: 0, no: 0, abstain: 0, total: 0 };
    const votes = activeDecision.votes || [];
    const yes = votes.filter((v) => v.vote === "YES").length;
    const no = votes.filter((v) => v.vote === "NO").length;
    const abstain = votes.filter((v) => v.vote === "ABSTAIN").length;
    return { yes, no, abstain, total: votes.length };
  }, [activeDecision]);

  return (
    <group position={position} rotation={rotation} onClick={onSelect}>
      {/* 1. Heavy Metal Industrial Bezel / Housing */}
      <mesh castShadow receiveShadow position={[0, 0, -0.04]}>
        <boxGeometry args={[width + 0.16, height + 0.16, 0.08]} />
        <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.8} />
      </mesh>

      {/* Screen Frame Border Accent (Subtle glowing trim) */}
      <mesh position={[0, 0, -0.005]}>
        <boxGeometry args={[width + 0.04, height + 0.04, 0.02]} />
        <meshStandardMaterial
          color={
            presentationMode === "VOTING"
              ? "#f59e0b"
              : presentationMode === "DECISION"
              ? "#10b981"
              : presentationMode === "CRITIQUE"
              ? "#f43f5e"
              : "#0284c7"
          }
          emissive={
            presentationMode === "VOTING"
              ? "#f59e0b"
              : presentationMode === "DECISION"
              ? "#10b981"
              : presentationMode === "CRITIQUE"
              ? "#f43f5e"
              : "#0284c7"
          }
          emissiveIntensity={0.25}
        />
      </mesh>

      {/* 2. Glass Display Surface (OLED Backdrop) */}
      <mesh position={[0, 0, 0.005]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color="#020617" roughness={0.1} metalness={0.9} />
      </mesh>

      {/* 3. High-Fidelity Interactive Screen Content */}
      <Html
        transform
        occlude="blending"
        position={[0, 0, 0.02]}
        distanceFactor={2.4}
        className="w-[840px] h-[460px] select-none pointer-events-auto rounded-lg overflow-hidden bg-slate-950/95 border border-slate-800 text-slate-100 flex flex-col justify-between p-6 shadow-2xl font-sans"
      >
        {/* Screen Top Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400">
              <Monitor className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
                {activeMeeting ? activeMeeting.title : "Corporate Executive Briefing"}
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-sky-950 text-sky-400 border border-sky-800">
                  {deliberationStage}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                {activeMeeting?.objective || "Phân tích, tranh luận & biểu quyết giải pháp vận hành"}
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full animate-pulse ${
                activeMeeting?.status === "IN_PROGRESS"
                  ? "bg-emerald-400"
                  : activeMeeting?.status === "PAUSED"
                  ? "bg-amber-400"
                  : activeMeeting?.status === "WAITING_APPROVAL"
                  ? "bg-orange-400"
                  : "bg-slate-400"
              }`}
            />
            <span className="text-xs font-mono font-semibold uppercase text-slate-300">
              {activeMeeting?.status || "STANDBY"}
            </span>
          </div>
        </div>

        {/* Screen Body Content Based on Mode */}
        <div className="flex-1 flex flex-col justify-center py-4">
          {/* A. STANDBY MODE */}
          {presentationMode === "STANDBY" && (
            <div className="flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 shadow-inner">
                <Activity className="w-8 h-8 text-sky-400 animate-pulse" />
              </div>
              <h3 className="text-base font-bold text-slate-200">Phòng họp sẵn sàng</h3>
              <p className="text-xs text-slate-400 max-w-md">
                Chưa có phiên thảo luận nào đang diễn ra. Khởi tạo cuộc họp từ bảng điều khiển để kích hoạt trao đổi đa đặc vụ.
              </p>
            </div>
          )}

          {/* B. DISCUSSION MODE */}
          {presentationMode === "DISCUSSION" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow">
                  {speaker ? speaker.agent_name?.[0] || speaker.role[0] : "A"}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-sky-300">
                      {speaker ? speaker.agent_name || speaker.agent_id : "Đặc vụ phát biểu"}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-300">
                      {speaker?.role || "SPECIALIST"}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">Đang trình bày luận điểm và số liệu minh chứng</p>
                </div>
              </div>

              {lastMessage && (
                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800/80 max-h-[160px] overflow-hidden">
                  <p className="text-xs leading-relaxed text-slate-200 line-clamp-4 italic">
                    "{lastMessage.content}"
                  </p>
                </div>
              )}
            </div>
          )}

          {/* C. PROPOSAL MODE */}
          {presentationMode === "PROPOSAL" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sky-400 text-xs font-bold uppercase tracking-wider">
                <Lightbulb className="w-4 h-4" /> Đề xuất giải pháp
              </div>
              <div className="bg-sky-950/40 border border-sky-800/60 p-4 rounded-xl">
                <h4 className="text-sm font-bold text-sky-200 mb-1">
                  {lastMessage?.metadata_json?.position || "Phương án triển khai phân tầng"}
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed mb-3">
                  {lastMessage?.content || "Chi tiết phương án được đề xuất cho hội đồng xem xét."}
                </p>
                <div className="flex items-center gap-4 text-[11px] text-sky-300">
                  <span>Độ tin cậy: {(Number(lastMessage?.metadata_json?.confidence || 0.9) * 100).toFixed(0)}%</span>
                  <span>Hành động: {lastMessage?.metadata_json?.proposed_actions?.length || 1} mục tiêu</span>
                </div>
              </div>
            </div>
          )}

          {/* D. CRITIQUE MODE */}
          {presentationMode === "CRITIQUE" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-rose-400 text-xs font-bold uppercase tracking-wider">
                <ShieldAlert className="w-4 h-4" /> Phản biện & Đánh giá rủi ro
              </div>
              <div className="bg-rose-950/40 border border-rose-800/60 p-4 rounded-xl">
                <h4 className="text-sm font-bold text-rose-200 mb-1">
                  Cảnh báo điểm nghẽn & rủi ro phụ thuộc
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed mb-3">
                  {lastMessage?.metadata_json?.risks || lastMessage?.content || "Cần cơ chế rollback tự động trước khi triển khai."}
                </p>
                <div className="flex items-center gap-4 text-[11px] text-rose-300">
                  <span>Mức độ nghiêm trọng: Cao</span>
                  <span>Kiến nghị: Thiết lập Circuit Breaker</span>
                </div>
              </div>
            </div>
          )}

          {/* E. VOTING MODE */}
          {presentationMode === "VOTING" && activeDecision && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
                  <Vote className="w-4 h-4" /> Phiên biểu quyết quyết định
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  Quy tắc: {activeDecision.metadata_json?.voting_policy || "Đa số"}
                </span>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl space-y-3">
                <h4 className="text-sm font-bold text-slate-100">{activeDecision.title}</h4>
                <p className="text-xs text-slate-400 line-clamp-2">{activeDecision.description}</p>

                {/* Voting Bars */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Đồng ý (YES)
                    </span>
                    <span className="font-mono text-emerald-300">{voteTallies.yes} phiếu</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${voteTallies.total > 0 ? (voteTallies.yes / voteTallies.total) * 100 : 0}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="text-rose-400 font-semibold flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> Bác bỏ (NO)
                    </span>
                    <span className="font-mono text-rose-300">{voteTallies.no} phiếu</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-rose-500 transition-all duration-500"
                      style={{ width: `${voteTallies.total > 0 ? (voteTallies.no / voteTallies.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* F. DECISION MODE */}
          {presentationMode === "DECISION" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                <Award className="w-4 h-4" /> Nghị quyết được thông qua
              </div>
              <div className="bg-emerald-950/40 border border-emerald-800/60 p-4 rounded-xl space-y-2">
                <h4 className="text-sm font-bold text-emerald-200">
                  {activeDecision?.title || "Chính thức phê duyệt phương án"}
                </h4>
                <p className="text-xs text-slate-300">
                  {activeDecision?.description || "Các nhiệm vụ thực thi đã được phân bổ cho các phòng ban liên quan."}
                </p>

                {actionItems.length > 0 && (
                  <div className="pt-2 border-t border-emerald-800/40 text-[11px] text-emerald-300 flex items-center justify-between">
                    <span>Nhiệm vụ phát sinh: {actionItems.length} đầu việc</span>
                    <span className="font-mono bg-emerald-950 px-2 py-0.5 rounded text-emerald-400 border border-emerald-800">
                      Đã gán TaskModel
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Screen Bottom Telemetry Footer */}
        <div className="border-t border-slate-800/80 pt-2.5 flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <div className="flex items-center gap-3">
            <span>Đặc vụ: {Object.keys(participants).length}</span>
            <span>Tin nhắn: {messages.length}</span>
            <span>Quyết định: {Object.keys(decisions).length}</span>
          </div>
          <span className="text-sky-400 font-semibold cursor-pointer hover:underline">
            PROVIPAGENT • Spatial Visual Runtime
          </span>
        </div>
      </Html>
    </group>
  );
}

