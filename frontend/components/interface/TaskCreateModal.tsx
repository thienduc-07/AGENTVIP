"use client";

import React, { useState } from "react";
import { useWorldStore } from "@/store/worldStore";
import { createTask } from "@/lib/api/tasks";
import { ApiTask, TaskPriority } from "@/types/api";

interface TaskCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAgentId?: string | null;
  onTaskCreated?: (task: ApiTask) => void;
}

export default function TaskCreateModal({
  isOpen,
  onClose,
  defaultAgentId,
  onTaskCreated,
}: TaskCreateModalProps) {
  const agents = useWorldStore((s) => s.agents);

  const [agentId, setAgentId] = useState<string>(
    defaultAgentId || Object.keys(agents)[0] || "agent-exec-ceo"
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [successTask, setSuccessTask] = useState<ApiTask | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMessage("Tiêu đề nhiệm vụ không được để trống.");
      setErrorCode("VALIDATION_ERROR");
      return;
    }
    if (!description.trim()) {
      setErrorMessage("Mô tả nhiệm vụ không được để trống.");
      setErrorCode("VALIDATION_ERROR");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setErrorCode(null);
    setSuccessTask(null);

    try {
      const created = await createTask({
        title: title.trim(),
        description: description.trim(),
        assigned_agent_id: agentId,
        priority: priority,
      });

      setSuccessTask(created);
      if (onTaskCreated) {
        onTaskCreated(created);
      }

      // Trigger Corporate Task Handoff VFX from CEO to assigned agent
      if (created.assigned_agent_id && created.assigned_agent_id !== "agent-exec-ceo") {
        useWorldStore
          .getState()
          .triggerTaskHandoff(
            "agent-exec-ceo",
            created.assigned_agent_id,
            "Executive Governance & Strategy",
            created.title
          );
      }

      // Reset form on success
      setTimeout(() => {
        setTitle("");
        setDescription("");
      }, 500);
    } catch (err: any) {
      setErrorCode(err.code || "REQUEST_FAILED");
      setErrorMessage(err.message || "Giao nhiệm vụ thất bại. Vui lòng thử lại.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    setErrorMessage(null);
    setErrorCode(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl bg-gradient-to-b from-slate-900/95 to-slate-950/95 border border-amber-500/30 shadow-2xl shadow-amber-500/10 p-6 overflow-hidden">
        {/* Header Ambient Glow */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-sky-400 to-amber-500" />

        {/* Modal Title & Close Button */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-xl">📜</span>
            <div>
              <h2 className="text-lg font-bold tracking-wider text-slate-100 uppercase font-mono">
                Ban Bố Nhiệm Vụ Mới
              </h2>
              <p className="text-xs text-amber-400/80">FastAPI & SQLite Transaction Engine</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Success State */}
        {successTask && (
          <div className="mb-4 p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-sm animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between font-semibold mb-1">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span>✓</span> Nhiệm vụ đã được lưu thành công!
              </span>
              <span className="px-2 py-0.5 rounded text-xs uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {successTask.status}
              </span>
            </div>
            <p className="text-xs text-emerald-300/80 mb-2">
              ID: <code className="bg-black/30 px-1 py-0.5 rounded">{successTask.id}</code>
            </p>
            <p className="text-xs text-slate-300">
              Agent <strong className="text-amber-300">{agents[successTask.assigned_agent_id]?.name || successTask.assigned_agent_id}</strong> đã ghi nhận lệnh vào hàng đợi (queued).
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setSuccessTask(null)}
                className="px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
              >
                Tạo thêm nhiệm vụ
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1 text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        )}

        {/* Error Alert with Retry */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-rose-950/50 border border-rose-500/50 text-rose-200 text-xs">
            <div className="flex items-center justify-between font-semibold mb-1">
              <span className="text-rose-400">Lỗi: {errorCode}</span>
              <button
                onClick={handleRetry}
                className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-[10px] uppercase font-bold"
              >
                Thử lại
              </button>
            </div>
            <p className="text-rose-200/90">{errorMessage}</p>
          </div>
        )}

        {/* Task Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Agent Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Chỉ định AI Agent
            </label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500/80 transition-colors"
            >
              {Object.values(agents).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.role})
                </option>
              ))}
            </select>
          </div>

          {/* Task Title */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Tiêu đề nhiệm vụ
              </label>
              <span className="text-[10px] text-slate-500">{title.length}/120</span>
            </div>
            <input
              type="text"
              maxLength={120}
              placeholder="VD: Kiểm tra phòng thủ cầu cảng hoặc tính toán lộ trình..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/80 transition-colors"
            />
          </div>

          {/* Task Description */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Chi tiết chỉ thị (Description)
              </label>
              <span className="text-[10px] text-slate-500">{description.length}/4000</span>
            </div>
            <textarea
              rows={3}
              maxLength={4000}
              placeholder="Nhập hướng dẫn chi tiết cho Agent thực hiện trong runtime..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/80 transition-colors resize-none"
            />
          </div>

          {/* Priority Pills */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Độ ưu tiên (Priority)
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(["low", "normal", "high", "urgent"] as TaskPriority[]).map((p) => {
                const isSelected = priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`py-1.5 text-xs font-bold rounded-lg uppercase tracking-wider border transition-all ${
                      isSelected
                        ? p === "urgent"
                          ? "bg-rose-500/20 border-rose-500 text-rose-300 shadow-sm shadow-rose-500/30"
                          : p === "high"
                          ? "bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm shadow-amber-500/30"
                          : "bg-sky-500/20 border-sky-500 text-sky-300 shadow-sm shadow-sky-500/30"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Submit Actions */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-xl transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2 text-xs font-bold uppercase tracking-wider text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 rounded-xl shadow-lg shadow-amber-500/25 transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              {isLoading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  Đang xử lý...
                </>
              ) : (
                <>
                  <span>⚔️</span> Ban Bố Lệnh
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
