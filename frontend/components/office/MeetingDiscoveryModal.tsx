"use client";

import React, { useEffect, useState } from "react";
import { useMeetingStore } from "@/store/meetingStore";
import { getMeetings, createMeeting } from "@/lib/api/meetings";
import { ApiMeeting, MeetingStatusType } from "@/types/meeting";
import {
  X,
  Plus,
  Play,
  Calendar,
  Users,
  Building2,
  Clock,
  CheckCircle2,
  ArrowRight,
  FolderOpen,
} from "lucide-react";

interface MeetingDiscoveryModalProps {
  organizationId?: string;
  isOpen: boolean;
  onClose: () => void;
  onSelectMeeting?: (meetingId: string) => void;
}

export default function MeetingDiscoveryModal({
  organizationId = "org_default_company",
  isOpen,
  onClose,
  onSelectMeeting,
}: MeetingDiscoveryModalProps) {
  const activeMeeting = useMeetingStore((s) => s.activeMeeting);
  const meetingsList = useMeetingStore((s) => s.meetingsList);
  const loadMeetingDetail = useMeetingStore((s) => s.loadMeetingDetail);
  const refreshMeetingsList = useMeetingStore((s) => s.refreshMeetingsList);

  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newObjective, setNewObjective] = useState("");
  const [newMeetingType, setNewMeetingType] = useState("STRUCTURED_DEBATE");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      refreshMeetingsList(organizationId);
    }
  }, [isOpen, organizationId, refreshMeetingsList]);

  if (!isOpen) return null;

  const filteredMeetings = meetingsList.filter((m) => {
    if (filterStatus === "ALL") return true;
    return m.status === filterStatus;
  });

  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setIsSubmitting(true);
    try {
      const created = await createMeeting(
        {
          title: newTitle.trim(),
          objective: newObjective.trim() || undefined,
          meeting_type: newMeetingType,
        },
        { organizationId }
      );
      await refreshMeetingsList(organizationId);
      await loadMeetingDetail(created.id, organizationId);
      onSelectMeeting?.(created.id);
      setIsCreatingNew(false);
      setNewTitle("");
      setNewObjective("");
      onClose();
    } catch (err) {
      console.error("Error creating meeting:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelect = async (meetingId: string) => {
    await loadMeetingDetail(meetingId, organizationId);
    onSelectMeeting?.(meetingId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md select-none font-sans text-slate-100">
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow-md">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 tracking-wide uppercase">
                Hội Nghị & Cuộc Họp Đa Đặc Vụ
              </h2>
              <p className="text-xs text-slate-400">
                Tổ chức: <span className="text-slate-300 font-mono">{organizationId}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-2xl hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Quick Actions Row */}
          <div className="flex items-center justify-between gap-3">
            {/* Status Filter Pills */}
            <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-semibold">
              {["ALL", "IN_PROGRESS", "PAUSED", "COMPLETED"].map((st) => (
                <button
                  key={st}
                  onClick={() => setFilterStatus(st)}
                  className={`px-3 py-1 rounded-xl transition-all ${
                    filterStatus === st
                      ? "bg-sky-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {st === "ALL" ? "Tất cả" : st === "IN_PROGRESS" ? "Đang diễn ra" : st === "PAUSED" ? "Tạm dừng" : "Đã xong"}
                </button>
              ))}
            </div>

            {/* Create New Meeting Toggle */}
            <button
              onClick={() => setIsCreatingNew((prev) => !prev)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-xs shadow-md transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>{isCreatingNew ? "Đóng Tạo Mới" : "Tạo Cuộc Họp"}</span>
            </button>
          </div>

          {/* New Meeting Form Accordion */}
          {isCreatingNew && (
            <form onSubmit={handleCreateMeeting} className="p-4 rounded-2xl bg-slate-950 border border-sky-500/30 space-y-3">
              <h3 className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                Khởi tạo phiên họp mới
              </h3>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Chủ đề cuộc họp</label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Phân tích kiến trúc vi mô & Tối ưu chịu tải..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Mục tiêu thảo luận</label>
                <textarea
                  rows={2}
                  placeholder="Xác định mục tiêu cần đạt được và phương án bàn giao..."
                  value={newObjective}
                  onChange={(e) => setNewObjective(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <select
                  value={newMeetingType}
                  onChange={(e) => setNewMeetingType(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-sky-400"
                >
                  <option value="STRUCTURED_DEBATE">Tranh luận có cấu trúc (5 giai đoạn)</option>
                  <option value="STRATEGY_SESSION">Phiên định hướng chiến lược</option>
                  <option value="STANDUP">Họp giao ban hằng ngày</option>
                </select>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-xs shadow transition-all disabled:opacity-50"
                >
                  {isSubmitting ? "Đang tạo..." : "Xác nhận tạo"}
                </button>
              </div>
            </form>
          )}

          {/* Meetings List */}
          <div className="space-y-2.5">
            {filteredMeetings.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Calendar className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p>Không tìm thấy cuộc họp nào phù hợp.</p>
              </div>
            ) : (
              filteredMeetings.map((m) => {
                const isActive = activeMeeting?.id === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => handleSelect(m.id)}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                      isActive
                        ? "bg-sky-950/40 border-sky-400 ring-2 ring-sky-400/20"
                        : "bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-950/90"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            m.status === "IN_PROGRESS"
                              ? "bg-emerald-400 animate-pulse"
                              : m.status === "PAUSED"
                              ? "bg-amber-400"
                              : m.status === "COMPLETED"
                              ? "bg-sky-400"
                              : "bg-slate-500"
                          }`}
                        />
                        <h4 className="text-xs font-bold text-slate-100">{m.title}</h4>
                        <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-300">
                          {m.meeting_type}
                        </span>
                      </div>

                      {m.objective && (
                        <p className="text-[11px] text-slate-400 line-clamp-1">{m.objective}</p>
                      )}

                      <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono pt-1">
                        <span>Đặc vụ: {m.participants?.length || 0}</span>
                        <span>Quyết định: {m.decisions_count || 0}</span>
                        <span>Nhiệm vụ: {m.action_items_count || 0}</span>
                      </div>
                    </div>

                    <ArrowRight className="w-4 h-4 text-slate-500" />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

