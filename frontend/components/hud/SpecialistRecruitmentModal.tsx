"use client";

import React, { useState, useEffect, useMemo } from "react";
import confetti from "canvas-confetti";
import {
  X,
  Search,
  Users,
  Shield,
  Briefcase,
  Layers,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  ArrowRightLeft,
  Sparkles,
  ExternalLink,
  DollarSign,
  UserCheck,
} from "lucide-react";
import { useWorldStore } from "@/store/worldStore";
import {
  fetchSpecialists,
  fetchSpecialistDetail,
  fetchDivisions,
  recruitSpecialist,
  compareCandidates,
  SpecialistSummary,
  SpecialistDetail,
  DivisionSummary,
} from "@/lib/api/recruitment";
import { getAgents } from "@/lib/api/agents";

const MANAGERS = [
  { id: "agent-exec-ceo", name: "Victoria Vance", role: "CEO", dept: "Executive" },
  { id: "agent-eng-lead", name: "David Chen", role: "Principal Architect", dept: "Engineering" },
  { id: "agent-research-ai", name: "Dr. Elena Rostova", role: "AI Research Lead", dept: "AI Research" },
  { id: "agent-mkt-growth", name: "Sophia Martinez", role: "Growth & Brand Lead", dept: "Marketing" },
  { id: "agent-sales-director", name: "Marcus Reynolds", role: "Sales Director", dept: "Sales" },
  { id: "agent-fin-controller", name: "Julian Thorne", role: "CFO & Treasury", dept: "Finance" },
  { id: "agent-ops-recruiter", name: "Amara Okafor", role: "Head of Operations", dept: "Operations" },
  { id: "agent-support-lead", name: "Liam O'Connor", role: "Customer Success", dept: "Customer Success" },
];

export default function SpecialistRecruitmentModal() {
  const isOpen = useWorldStore((s) => s.isSpecialistRecruitmentOpen);
  const onClose = () => useWorldStore.getState().setIsSpecialistRecruitmentOpen(false);
  const syncAgentsFromBackend = useWorldStore((s) => s.syncAgentsFromBackend);

  // Catalog State
  const [specialists, setSpecialists] = useState<SpecialistSummary[]>([]);
  const [divisions, setDivisions] = useState<DivisionSummary[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [selectedDivision, setSelectedDivision] = useState<string>("all");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Inspection & Recruitment Drawer
  const [inspectingSpecialist, setInspectingSpecialist] = useState<SpecialistDetail | null>(null);
  const [selectedManagerId, setSelectedManagerId] = useState<string>("agent-eng-lead");
  const [budgetLimit, setBudgetLimit] = useState<number>(50);
  const [customName, setCustomName] = useState<string>("");
  const [isRecruiting, setIsRecruiting] = useState<boolean>(false);
  const [recruitmentSuccess, setRecruitmentSuccess] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Comparison State
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [comparisonData, setComparisonData] = useState<any[]>([]);

  // Initial Data Load
  useEffect(() => {
    if (!isOpen) return;
    loadDivisions();
    loadCatalog();
  }, [isOpen, selectedDivision, selectedDepartment, searchQuery]);

  const loadDivisions = async () => {
    try {
      const data = await fetchDivisions();
      setDivisions(data);
    } catch (e) {
      console.warn("Failed to load divisions:", e);
    }
  };

  const loadCatalog = async () => {
    setIsLoading(true);
    try {
      const res = await fetchSpecialists({
        division: selectedDivision !== "all" ? selectedDivision : undefined,
        department: selectedDepartment !== "all" ? selectedDepartment : undefined,
        search: searchQuery.trim() || undefined,
        limit: 100,
      });
      setSpecialists(res.items);
      setTotalCount(res.total);
    } catch (e) {
      console.error("Failed to load specialists:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInspect = async (id: string) => {
    setErrorMessage(null);
    setRecruitmentSuccess(null);
    try {
      const detail = await fetchSpecialistDetail(id);
      setInspectingSpecialist(detail);
      // Auto-select department manager
      const mgr = MANAGERS.find((m) => m.dept === detail.department);
      if (mgr) setSelectedManagerId(mgr.id);
      else setSelectedManagerId("agent-exec-ceo");
      setCustomName("");
    } catch (e: any) {
      setErrorMessage(e.message || "Failed to load specialist details");
    }
  };

  const handleRecruitSubmit = async () => {
    if (!inspectingSpecialist) return;
    setIsRecruiting(true);
    setErrorMessage(null);

    try {
      const res = await recruitSpecialist({
        specialist_id: inspectingSpecialist.id,
        manager_agent_id: selectedManagerId,
        department: inspectingSpecialist.department,
        custom_name: customName.trim() || undefined,
        budget_limit_usd: budgetLimit,
        notes: `Recruited via Autonomous Recruitment Hub`,
      });

      setRecruitmentSuccess(`Successfully recruited ${res.name} to ${res.department}!`);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#3b82f6", "#60a5fa", "#10b981", "#f59e0b"],
      });

      // Refresh live agents in 3D world
      const updatedAgents = await getAgents();
      syncAgentsFromBackend(updatedAgents);

      // Refresh catalog state
      loadCatalog();
    } catch (e: any) {
      setErrorMessage(e.message || "Recruitment transaction failed");
    } finally {
      setIsRecruiting(false);
    }
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const handleOpenComparison = async () => {
    if (compareIds.length === 0) return;
    try {
      const data = await compareCandidates(compareIds);
      setComparisonData(data);
      setIsComparing(true);
    } catch (e) {
      console.error("Comparison load error:", e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-7xl h-[90vh] bg-slate-950/95 border border-slate-700/80 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Specialist Recruitment & Talent Hub
                <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-xs font-mono border border-blue-500/30">
                  {totalCount} Specialists in Library
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Browse, compare, and onboard specialized autonomous AI agents into corporate departments
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {compareIds.length > 0 && (
              <button
                onClick={handleOpenComparison}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                Compare ({compareIds.length}/3)
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="px-6 py-3 border-b border-slate-800/60 bg-slate-900/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, role, capability (e.g. backend, rag, security)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900/90 border border-slate-700/80 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Department Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Department:</span>
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="all">All Departments</option>
              <option value="Engineering">Engineering</option>
              <option value="AI Research">AI Research</option>
              <option value="Marketing">Marketing</option>
              <option value="Sales">Sales</option>
              <option value="Finance">Finance</option>
              <option value="Operations">Operations</option>
              <option value="Customer Success">Customer Success</option>
            </select>
          </div>
        </div>

        {/* 18 Divisions Pill Bar */}
        <div className="px-6 py-2.5 border-b border-slate-800/40 bg-slate-950/60 overflow-x-auto no-scrollbar flex items-center gap-1.5">
          <button
            onClick={() => setSelectedDivision("all")}
            className={`px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              selectedDivision === "all"
                ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                : "bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800"
            }`}
          >
            All Divisions ({totalCount})
          </button>
          {divisions.map((d) => (
            <button
              key={d.division}
              onClick={() => setSelectedDivision(d.division)}
              className={`px-3 py-1 rounded-xl text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                selectedDivision === d.division
                  ? "bg-blue-600 text-white font-semibold shadow-md shadow-blue-600/20"
                  : "bg-slate-900/60 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800/80"
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
              {d.division} ({d.agent_count})
            </button>
          ))}
        </div>

        {/* Main Content: Specialists Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
              <span className="animate-pulse">Loading specialist library catalog...</span>
            </div>
          ) : specialists.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500">
              <Users className="w-12 h-12 stroke-[1.5] mb-2 text-slate-600" />
              <p className="text-sm">No specialists found matching your search criteria.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {specialists.map((spec) => {
                const isCompared = compareIds.includes(spec.id);
                return (
                  <div
                    key={spec.id}
                    className="p-5 rounded-2xl bg-slate-900/60 hover:bg-slate-900/90 border border-slate-800/80 hover:border-slate-700 transition-all flex flex-col justify-between shadow-lg group"
                  >
                    <div>
                      {/* Top Row: Emoji, Name, Division Badge */}
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl p-2 rounded-2xl bg-slate-800/80 border border-slate-700/60">
                            {spec.emoji}
                          </span>
                          <div>
                            <h3 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">
                              {spec.name}
                            </h3>
                            <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                              {spec.department}
                            </span>
                          </div>
                        </div>

                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase border"
                          style={{
                            borderColor: `${spec.color}40`,
                            backgroundColor: `${spec.color}15`,
                            color: spec.color,
                          }}
                        >
                          {spec.division}
                        </span>
                      </div>

                      {/* Role and Description */}
                      <p className="text-xs text-slate-300 font-medium mb-1 line-clamp-1">
                        {spec.role}
                      </p>
                      <p className="text-[11px] text-slate-400 line-clamp-2 mb-3">
                        {spec.description}
                      </p>

                      {/* Capabilities chips */}
                      {spec.capabilities && spec.capabilities.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {spec.capabilities.slice(0, 3).map((cap, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded-md bg-slate-800/90 text-[10px] text-slate-300 border border-slate-700/50"
                            >
                              {cap}
                            </span>
                          ))}
                          {spec.capabilities.length > 3 && (
                            <span className="px-1.5 py-0.5 rounded-md bg-slate-800 text-[10px] text-slate-500">
                              +{spec.capabilities.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Bottom Action Bar */}
                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                      <button
                        onClick={() => toggleCompare(spec.id)}
                        className={`px-2.5 py-1.5 rounded-xl text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                          isCompared
                            ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/50 font-bold"
                            : "bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        <ArrowRightLeft className="w-3 h-3" />
                        {isCompared ? "In Compare" : "Compare"}
                      </button>

                      <button
                        onClick={() => handleInspect(spec.id)}
                        className="px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white text-xs font-semibold border border-blue-500/40 hover:border-transparent transition-all cursor-pointer flex items-center gap-1 shadow-md shadow-blue-600/10"
                      >
                        Inspect & Recruit
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Side-by-Side Comparison Modal */}
        {isComparing && (
          <div className="absolute inset-0 z-30 bg-slate-950/98 p-6 flex flex-col animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Candidate Comparison Matrix</h3>
              </div>
              <button
                onClick={() => setIsComparing(false)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-x-auto py-6">
              <div className="grid grid-cols-3 gap-6 min-w-[750px]">
                {comparisonData.map((c) => (
                  <div key={c.id} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-3xl">{c.emoji}</span>
                        <div>
                          <h4 className="text-sm font-bold text-white">{c.name}</h4>
                          <span className="text-xs text-blue-400">{c.department} • {c.division}</span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 font-semibold mb-3">{c.role}</p>

                      <div className="space-y-3 text-xs text-slate-400">
                        <div>
                          <span className="font-bold text-slate-300 block mb-1">Capabilities:</span>
                          <ul className="list-disc pl-4 space-y-0.5">
                            {c.capabilities.slice(0, 4).map((cap: string, i: number) => (
                              <li key={i}>{cap}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <span className="font-bold text-slate-300 block mb-1">Assigned Safe Tools:</span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {c.assigned_tools.slice(0, 5).join(", ")}...
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setIsComparing(false);
                        handleInspect(c.id);
                      }}
                      className="mt-6 w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors cursor-pointer"
                    >
                      Recruit This Specialist
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Detailed Inspection & Recruitment Drawer */}
        {inspectingSpecialist && (
          <div className="absolute inset-y-0 right-0 w-full sm:w-[540px] bg-slate-950 border-l border-slate-800 shadow-2xl z-20 flex flex-col animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-6 border-b border-slate-800 flex items-start justify-between bg-slate-900/60">
              <div className="flex items-center gap-3">
                <span className="text-4xl p-2.5 rounded-2xl bg-slate-800 border border-slate-700">
                  {inspectingSpecialist.emoji}
                </span>
                <div>
                  <h3 className="text-base font-bold text-white">{inspectingSpecialist.name}</h3>
                  <p className="text-xs text-blue-400 font-semibold">
                    {inspectingSpecialist.department} • {inspectingSpecialist.division}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectingSpecialist(null)}
                className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Notification / Error Banners */}
            {recruitmentSuccess && (
              <div className="m-4 p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{recruitmentSuccess}</span>
              </div>
            )}
            {errorMessage && (
              <div className="m-4 p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {/* Mission & Identity */}
              <div>
                <h4 className="font-bold text-slate-200 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-blue-400" />
                  Primary Role & Mission
                </h4>
                <p className="text-slate-300 bg-slate-900/80 p-3 rounded-xl border border-slate-800 leading-relaxed">
                  {inspectingSpecialist.description}
                </p>
              </div>

              {/* Capabilities */}
              {inspectingSpecialist.capabilities && inspectingSpecialist.capabilities.length > 0 && (
                <div>
                  <h4 className="font-bold text-slate-200 uppercase tracking-wider mb-1.5">
                    Verified Capabilities
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {inspectingSpecialist.capabilities.map((cap, i) => (
                      <span key={i} className="px-2.5 py-1 rounded-lg bg-slate-900 text-slate-300 border border-slate-800">
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Safety & Permissions Profile */}
              <div>
                <h4 className="font-bold text-slate-200 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  Security Clearance & Tools
                </h4>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Clearance Level:</span>
                    <span className="font-bold text-emerald-400">
                      {inspectingSpecialist.permission_level === 0 ? "Level 0: Read Only" : "Level 1: Workspace Sandbox Write"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-1">Whitelisted Safe Tools:</span>
                    <div className="flex flex-wrap gap-1">
                      {inspectingSpecialist.assigned_tools.map((t, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded bg-slate-800 font-mono text-[10px] text-slate-300">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Recruitment Onboarding Form */}
              <div className="pt-4 border-t border-slate-800 space-y-4">
                <h4 className="font-bold text-white text-sm flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-blue-400" />
                  Onboarding & Department Placement
                </h4>

                {/* Manager Selection */}
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">
                    Direct Reporting Manager:
                  </label>
                  <select
                    value={selectedManagerId}
                    onChange={(e) => setSelectedManagerId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    {MANAGERS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.role} • {m.dept})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Monthly Token Budget */}
                <div>
                  <div className="flex items-center justify-between mb-1 font-semibold">
                    <label className="text-slate-400">Monthly Resource Budget:</label>
                    <span className="text-emerald-400 font-mono font-bold">${budgetLimit} USD</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="500"
                    step="10"
                    value={budgetLimit}
                    onChange={(e) => setBudgetLimit(Number(e.target.value))}
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>

                {/* Optional Custom Name */}
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">
                    Custom Operational Call-sign (Optional):
                  </label>
                  <input
                    type="text"
                    placeholder={`e.g. ${inspectingSpecialist.name} Alpha`}
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Drawer Footer Action */}
            <div className="p-6 border-t border-slate-800 bg-slate-900/60 flex items-center justify-end gap-3">
              <button
                onClick={() => setInspectingSpecialist(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={handleRecruitSubmit}
                disabled={isRecruiting}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold shadow-lg shadow-blue-500/25 transition-all cursor-pointer flex items-center gap-2"
              >
                {isRecruiting ? (
                  <span className="animate-pulse">Deploying Specialist...</span>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Recruit & Deploy to Department
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
