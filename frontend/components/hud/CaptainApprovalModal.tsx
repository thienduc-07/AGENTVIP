"use client";

import React from "react";
import { AlertTriangle, CheckCircle, XCircle, Code, ShieldAlert } from "lucide-react";
import { PendingAction } from "@/types";

interface CaptainApprovalModalProps {
  pendingAction: PendingAction | null;
  onDecide: (actionId: string, decision: "APPROVE" | "REJECT") => void;
  isDeciding: boolean;
}

export default function CaptainApprovalModal({
  pendingAction,
  onDecide,
  isDeciding,
}: CaptainApprovalModalProps) {
  if (!pendingAction) return null;

  const codeSnippet =
    pendingAction.tool_args.code ||
    (pendingAction.tool_args.command
      ? pendingAction.tool_args.command
      : JSON.stringify(pendingAction.tool_args, null, 2));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-xl rounded-2xl border-2 border-red-500/80 bg-slate-950/95 shadow-2xl shadow-red-500/20 p-6 flex flex-col gap-4 approval-pulse">
        {/* Header Warning */}
        <div className="flex items-center gap-3 border-b border-red-900/60 pb-3">
          <div className="p-2 rounded-xl bg-red-950 border border-red-500/50 text-red-400">
            <AlertTriangle className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <h2 className="text-base font-bold text-red-200 flex items-center gap-2">
              EXECUTIVE BOARD AUTHORIZATION REQUIRED
              <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 uppercase">
                High Risk Sandbox Action
              </span>
            </h2>
            <p className="text-xs text-red-400/80">
              Agent paused execution. Action requires Executive Leadership sign-off before proceeding.
            </p>
          </div>
        </div>

        {/* Action Details */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
            <span className="text-slate-400 block mb-1">Target Station / Agent</span>
            <span className="font-semibold text-slate-200">
              {pendingAction.agent_name || "Specialist Agent"}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
            <span className="text-slate-400 block mb-1">Tool Request</span>
            <span className="font-mono font-bold text-amber-400">
              {pendingAction.tool_name}()
            </span>
          </div>
        </div>

        {/* Security Justification */}
        <div className="p-3 rounded-xl bg-red-950/40 border border-red-900/60 text-xs flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-red-300 block mb-0.5">Security Notice:</span>
            <p className="text-red-200/90">{pendingAction.risk_reason}</p>
          </div>
        </div>

        {/* Code / Argument Inspector */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span className="flex items-center gap-1.5">
              <Code className="w-3.5 h-3.5 text-cyan-400" />
              Payload Inspector:
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              {pendingAction.tool_args.filename || "Execution Payload"}
            </span>
          </div>
          <div className="max-h-52 overflow-y-auto rounded-xl bg-slate-900 border border-slate-800 p-3 font-mono text-xs text-emerald-400 leading-relaxed whitespace-pre-wrap select-text">
            {codeSnippet}
          </div>
        </div>

        {/* Authorization Decisions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
          <button
            disabled={isDeciding}
            onClick={() => onDecide(pendingAction.id, "REJECT")}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-rose-300 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-500/40 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <XCircle className="w-4 h-4" />
            VETO / DENY
          </button>
          <button
            disabled={isDeciding}
            onClick={() => onDecide(pendingAction.id, "APPROVE")}
            className="px-5 py-2 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 shadow-lg shadow-amber-500/30 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <CheckCircle className="w-4 h-4" />
            AUTHORIZE & EXECUTE
          </button>
        </div>
      </div>
    </div>
  );
}
