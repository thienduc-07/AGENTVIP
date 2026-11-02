"use client";

import React from "react";
import { Users, Building2, PlusCircle, RefreshCw } from "lucide-react";

interface EmptyOfficeStateProps {
  organizationId: string;
  onRefresh?: () => void;
  onOpenRecruitment?: () => void;
}

export default function EmptyOfficeState({
  organizationId,
  onRefresh,
  onOpenRecruitment,
}: EmptyOfficeStateProps) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="pointer-events-auto max-w-md w-full p-6 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-2xl text-center flex flex-col items-center">
        <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-sky-400 mb-4 shadow-inner">
          <Building2 className="w-7 h-7" />
        </div>

        <h3 className="text-lg font-bold text-slate-100 mb-1">
          Văn Phòng Chưa Có Nhân Sự
        </h3>
        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
          Tổ chức <span className="font-mono text-sky-400 font-semibold">{organizationId}</span> hiện chưa có phòng ban hoặc đặc vụ AI nào được kích hoạt. Không gian văn phòng 3D đang ở trạng thái chờ khởi tạo.
        </p>

        <div className="flex items-center gap-3 w-full">
          {onOpenRecruitment && (
            <button
              onClick={onOpenRecruitment}
              className="flex-1 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              Tuyển Dụng Đặc Vụ Mới
            </button>
          )}

          {onRefresh && (
            <button
              onClick={onRefresh}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition-all border border-slate-700 flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Tải Lại Dữ Liệu
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

