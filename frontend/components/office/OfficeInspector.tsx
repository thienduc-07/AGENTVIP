"use client";

import React from "react";
import { X, User, Monitor, Building2, Activity, CheckCircle2, AlertCircle, Clock, ArrowRight } from "lucide-react";
import { OfficeSelection, CANONICAL_STATE_CONFIGS } from "@/types/office";
import { AgentAvatarData } from "./AgentAvatar";
import { WorkstationData } from "./Workstation";
import { DepartmentZoneData } from "./DepartmentZone";

interface OfficeInspectorProps {
  selection: OfficeSelection;
  agents: Record<string, AgentAvatarData>;
  workstations: Record<string, WorkstationData>;
  departments: Record<string, DepartmentZoneData>;
  onClose: () => void;
  onFocusAgent?: (agentId: string) => void;
  onFocusDepartment?: (deptName: string) => void;
}

export default function OfficeInspector({
  selection,
  agents,
  workstations,
  departments,
  onClose,
  onFocusAgent,
  onFocusDepartment,
}: OfficeInspectorProps) {
  if (selection.type === "none") return null;

  return (
    <div className="absolute right-4 top-20 bottom-6 w-84 z-30 pointer-events-auto">
      <div className="w-full h-full rounded-2xl bg-slate-900/95 border border-slate-800 shadow-2xl backdrop-blur-md flex flex-col overflow-hidden animate-in slide-in-from-right-4 duration-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {selection.type === "agent" && (
              <>
                <User className="w-4 h-4 text-sky-400" />
                <span>Chi Tiết Đặc Vụ AI</span>
              </>
            )}
            {selection.type === "workstation" && (
              <>
                <Monitor className="w-4 h-4 text-emerald-400" />
                <span>Bàn Làm Việc 3D</span>
              </>
            )}
            {selection.type === "department" && (
              <>
                <Building2 className="w-4 h-4 text-purple-400" />
                <span>Phân Khu Phòng Ban</span>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-slate-300">
          {/* A. AGENT INSPECTOR */}
          {selection.type === "agent" && (() => {
            const agent = agents[selection.id];
            if (!agent) {
              return (
                <div className="p-4 text-center text-slate-400">
                  Không tìm thấy thông tin đặc vụ ({selection.id})
                </div>
              );
            }
            const stateConfig = CANONICAL_STATE_CONFIGS[agent.behavioralState] || CANONICAL_STATE_CONFIGS.IDLE;

            return (
              <>
                {/* Agent Header Profile */}
                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0"
                    style={{
                      backgroundColor: `${agent.color || "#38bdf8"}22`,
                      color: agent.color || "#38bdf8",
                      border: `1px solid ${agent.color || "#38bdf8"}44`,
                    }}
                  >
                    {agent.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-sm text-slate-100 truncate">{agent.name}</h4>
                    <p className="text-[11px] text-slate-400 truncate">{agent.role}</p>
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                      {agent.department}
                    </span>
                  </div>
                </div>

                {/* Canonical Status Badge */}
                <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/40 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    Trạng Thái Hành Vi Tự Trị
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: stateConfig.beaconColor,
                        boxShadow: `0 0 8px ${stateConfig.beaconColor}`,
                      }}
                    />
                    <span className="font-semibold text-slate-200">{stateConfig.label}</span>
                    <span className="text-[10px] text-slate-500 font-mono">({agent.behavioralState})</span>
                  </div>
                </div>

                {/* Active Task */}
                <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/40 space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    Nhiệm Vụ Đang Thực Thi
                  </div>
                  {agent.currentTaskTitle ? (
                    <div className="flex items-start gap-2 p-2 rounded-lg bg-blue-950/40 border border-blue-800/40 text-blue-200">
                      <Activity className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                      <span className="text-xs leading-relaxed">{agent.currentTaskTitle}</span>
                    </div>
                  ) : (
                    <div className="text-slate-500 italic">Hiện không có nhiệm vụ active</div>
                  )}
                </div>

                {/* Workstation & Spatial Pos */}
                <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/40 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    Vị Trí & Bàn Làm Việc
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">Bàn</span>
                      <span className="font-mono text-slate-200 font-semibold truncate block">
                        {agent.assignedWorkstation || "Tự do / Chưa gán"}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">Tọa Độ (X, Z)</span>
                      <span className="font-mono text-slate-200">
                        {agent.position[0].toFixed(1)}, {agent.position[2].toFixed(1)}m
                      </span>
                    </div>
                  </div>
                </div>
              </>
            );
          })()}

          {/* B. WORKSTATION INSPECTOR */}
          {selection.type === "workstation" && (() => {
            const ws = workstations[selection.id];
            if (!ws) {
              return (
                <div className="p-4 text-center text-slate-400">
                  Không tìm thấy thông tin bàn làm việc ({selection.id})
                </div>
              );
            }

            return (
              <>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
                  <h4 className="font-bold text-sm text-slate-100">{ws.label || ws.workstation_id}</h4>
                  <p className="text-[11px] text-slate-400">Khu vực: {ws.zone} ({ws.department})</p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/40 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    Tình Trạng Chiếm Chỗ
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        ws.assigned_employee ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-slate-500"
                      }`}
                    />
                    <span className="font-semibold text-slate-200">
                      {ws.assigned_employee ? "Đang sử dụng (Occupied)" : "Còn trống (Vacant)"}
                    </span>
                  </div>
                  {ws.assigned_employee_name && (
                    <div className="mt-2 p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                      <div>
                        <span className="font-medium text-slate-200 block text-xs">{ws.assigned_employee_name}</span>
                        <span className="text-[10px] text-slate-400">{ws.assigned_employee_role}</span>
                      </div>
                      {onFocusAgent && ws.assigned_employee && (
                        <button
                          onClick={() => onFocusAgent(ws.assigned_employee!)}
                          className="px-2 py-1 rounded bg-sky-950 text-sky-400 text-[10px] border border-sky-800 hover:bg-sky-900 transition-colors cursor-pointer"
                        >
                          Xem Đặc Vụ
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/40 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    Thông Số Kỹ Thuật
                  </div>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Mã Bàn:</span>
                      <span className="font-mono text-slate-200">{ws.workstation_id}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Số Thứ Tự:</span>
                      <span className="text-slate-200">{ws.desk_number ?? "N/A"}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Loại Bàn:</span>
                      <span className="text-slate-200">{ws.is_virtual ? "Bàn Ảo (Remote Overflow)" : "Bàn Vật Lý (Physical 3D)"}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Vị Trí (X, Y, Z):</span>
                      <span className="font-mono text-slate-200">
                        {ws.pos_x.toFixed(1)}, {ws.pos_y.toFixed(1)}, {ws.pos_z.toFixed(1)}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            );
          })()}

          {/* C. DEPARTMENT INSPECTOR */}
          {selection.type === "department" && (() => {
            const dept = departments[selection.id];
            if (!dept) {
              return (
                <div className="p-4 text-center text-slate-400">
                  Không tìm thấy thông tin phòng ban ({selection.id})
                </div>
              );
            }

            const occupiedCount = dept.workstations.filter((w) => w.assigned_employee).length;

            return (
              <>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
                  <h4 className="font-bold text-sm text-slate-100">{dept.department}</h4>
                  <p className="text-[11px] text-slate-400">Zone định danh: {dept.zone}</p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/40 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    Sức Chứa & Tải Làm Việc
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Tỷ lệ chiếm chỗ bàn:</span>
                    <span className="font-bold text-slate-200">
                      {occupiedCount} / {dept.max_physical_desks} ({((occupiedCount / Math.max(1, dept.max_physical_desks)) * 100).toFixed(0)}%)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded-full transition-all"
                      style={{ width: `${(occupiedCount / Math.max(1, dept.max_physical_desks)) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/40 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    Danh Sách Bàn Thuộc Phòng Ban ({dept.workstations.length})
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {dept.workstations.map((w) => (
                      <div
                        key={w.workstation_id}
                        className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between text-[11px]"
                      >
                        <span className="font-mono text-slate-300">{w.label || w.workstation_id}</span>
                        <span className={w.assigned_employee ? "text-emerald-400" : "text-slate-500"}>
                          {w.assigned_employee_name || "Trống"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

