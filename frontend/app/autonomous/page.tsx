"use client";

import React, { useEffect, useState } from "react";

interface FinancialSummary {
  owner_budget_deposits_usd: number;
  estimated_revenue_usd: number;
  pending_revenue_usd: number;
  actual_received_revenue_usd: number;
  net_revenue_usd: number;
  operating_expenses_usd: number;
  realized_profit_usd: number;
  available_cash_usd: number;
}

interface AgentTelemetry {
  agent_id: string;
  name: string;
  role: string;
  department: string;
  status: string;
  x: number;
  z: number;
}

export default function AutonomousCompanyCommandCenter() {
  const [instruction, setInstruction] = useState(
    "Find a market with real demand, identify an opportunity, develop a digital product, launch it, acquire customers, and generate revenue with an initial budget of $100."
  );
  const [budget, setBudget] = useState<number>(100);
  const [loading, setLoading] = useState<boolean>(false);
  const [hqState, setHqState] = useState<{
    headquarters_name: string;
    executives_count: number;
    active_specialists_count: number;
    agents: AgentTelemetry[];
    financial_snapshot: FinancialSummary;
  } | null>(null);
  const [executionResult, setExecutionResult] = useState<Record<string, unknown> | null>(null);

  const API_BASE =
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    (typeof window !== "undefined" ? "" : (process.env.BACKEND_URL || "http://localhost:8000"));

  const fetchTelemetry = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/autonomous/hq-telemetry`);
      if (res.ok) {
        const data = await res.json();
        setHqState(data);
      }
    } catch {
      // Backend offline fallback handled gracefully
    }
  };

  useEffect(() => {
    fetchTelemetry();
  }, []);

  const handleExecuteDirective = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/autonomous/ceo-directive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction,
          authorized_budget_usd: budget,
          owner_preapprove_launch: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setExecutionResult(data);
        await fetchTelemetry();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="border-b border-slate-800 pb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <span className="text-xs uppercase tracking-widest text-emerald-400 font-semibold">
              PROVIPAGENT • Autonomous AI Company OS
            </span>
            <h1 className="text-3xl font-bold mt-1">
              CEO Victoria Vance — Executive Command Center
            </h1>
          </div>
          <div className="flex gap-3 text-sm">
            <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-lg">
              Executives: <strong className="text-emerald-400">{hqState?.executives_count ?? 8}</strong>
            </div>
            <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-lg">
              Active Specialists:{" "}
              <strong className="text-cyan-400">{hqState?.active_specialists_count ?? 0}</strong>
            </div>
          </div>
        </header>

        <section className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">
            Issue High-Level Owner Objective (End-to-End Autonomous Execution)
          </h2>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-slate-100 focus:outline-none focus:border-emerald-500"
          />
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm text-slate-300 flex items-center gap-2">
              Authorized Budget ($ USD):
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="bg-slate-950 border border-slate-700 rounded px-3 py-1.5 w-28 text-white"
              />
            </label>
            <button
              onClick={handleExecuteDirective}
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-6 py-2 rounded-lg transition"
            >
              {loading ? "Executing Autonomous Pipeline..." : "Execute CEO Directive"}
            </button>
          </div>
        </section>

        {hqState?.financial_snapshot && (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
              <div className="text-xs text-slate-400">Available Cash</div>
              <div className="text-2xl font-bold text-emerald-400 mt-1">
                ${hqState.financial_snapshot.available_cash_usd.toFixed(2)}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
              <div className="text-xs text-slate-400">Actual Verified Revenue</div>
              <div className="text-2xl font-bold text-white mt-1">
                ${hqState.financial_snapshot.actual_received_revenue_usd.toFixed(2)}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
              <div className="text-xs text-slate-400">Pending CRM Pipeline</div>
              <div className="text-2xl font-bold text-amber-400 mt-1">
                ${hqState.financial_snapshot.pending_revenue_usd.toFixed(2)}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
              <div className="text-xs text-slate-400">Operating Expenses</div>
              <div className="text-2xl font-bold text-rose-400 mt-1">
                ${hqState.financial_snapshot.operating_expenses_usd.toFixed(2)}
              </div>
            </div>
          </section>
        )}

        {executionResult && (
          <section className="bg-slate-900 border border-emerald-800/60 rounded-xl p-6 space-y-3">
            <h3 className="text-lg font-semibold text-emerald-400">
              Latest Autonomous Execution Trace (Verified)
            </h3>
            <pre className="text-xs bg-slate-950 p-4 rounded-lg overflow-x-auto text-slate-300">
              {JSON.stringify(executionResult, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
