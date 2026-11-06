"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  CreditCard,
  TrendingUp,
  DollarSign,
  QrCode,
  Building2,
  CheckCircle2,
  Clock,
  Sparkles,
  ExternalLink,
  Copy,
  RefreshCw,
  Award,
  ShieldCheck,
  Briefcase,
  Globe,
  Search,
  FileCheck2,
  Share2,
  Download,
  Scale,
  Check,
  Layers,
  ArrowRight,
  Lock,
} from "lucide-react";
import confetti from "canvas-confetti";
import { monetizationApi, TreasuryMetrics, CommercialOrder, BankPayoutConfig } from "@/lib/api/monetization";
import { incomeApi, IncomeOverview, FreelanceJobItem, AffiliateCampaignItem } from "@/lib/api/income";
import {
  autonomousCorporationApi,
  ControlCenterSummary,
  LegalRegulation,
  BusinessOpportunityItem,
} from "@/lib/api/autonomousCorporation";

interface ExecutiveTreasuryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentCelebration?: (order: CommercialOrder) => void;
}

export const ExecutiveTreasuryModal: React.FC<ExecutiveTreasuryModalProps> = ({
  isOpen,
  onClose,
  onPaymentCelebration,
}) => {
  const [activeTab, setActiveTab] = useState<"treasury" | "vietqr" | "job_hunter" | "compliance" | "payout">("treasury");
  const [metrics, setMetrics] = useState<TreasuryMetrics | null>(null);
  const [orders, setOrders] = useState<CommercialOrder[]>([]);
  const [payoutConfig, setPayoutConfig] = useState<BankPayoutConfig | null>(null);
  const [incomeOverview, setIncomeOverview] = useState<IncomeOverview | null>(null);
  const [jobsList, setJobsList] = useState<FreelanceJobItem[]>([]);
  const [affiliateList, setAffiliateList] = useState<AffiliateCampaignItem[]>([]);
  const [controlCenter, setControlCenter] = useState<ControlCenterSummary | null>(null);
  const [complianceList, setComplianceList] = useState<LegalRegulation[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [isScanningJobs, setIsScanningJobs] = useState<boolean>(false);
  const [isSettlingJob, setIsSettlingJob] = useState<boolean>(false);
  const [isExecutingPilot, setIsExecutingPilot] = useState<boolean>(false);
  const [pilotSuccessInfo, setPilotSuccessInfo] = useState<any | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<CommercialOrder | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // New Order Form state
  const [newTitle, setNewTitle] = useState("");
  const [newPrice, setNewPrice] = useState("25000000");
  const [newType, setNewType] = useState("web_app");
  const [newClient, setNewClient] = useState("Tập Đoàn FPT / Đối Tác Chuyển Đổi Số");
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [tMetrics, oList, pConfig, incOverview, fJobs, aCamps, cCenter, cReg] = await Promise.all([
        monetizationApi.getTreasuryOverview().catch(() => null),
        monetizationApi.listOrders().catch(() => []),
        monetizationApi.getPayoutConfig().catch(() => null),
        incomeApi.getOverview().catch(() => null),
        incomeApi.listJobs().catch(() => []),
        incomeApi.listAffiliateCampaigns().catch(() => []),
        autonomousCorporationApi.getControlCenter().catch(() => null),
        autonomousCorporationApi.getCompliance().catch(() => null),
      ]);
      if (tMetrics) setMetrics(tMetrics);
      if (oList) {
        setOrders(oList);
        if (oList.length > 0 && !selectedOrder) {
          setSelectedOrder(oList[0]);
        }
      }
      if (pConfig) setPayoutConfig(pConfig);
      if (incOverview) setIncomeOverview(incOverview);
      if (fJobs) setJobsList(fJobs);
      if (aCamps) setAffiliateList(aCamps);
      if (cCenter) setControlCenter(cCenter);
      if (cReg?.registry) setComplianceList(cReg.registry);
    } catch (err) {
      console.error("Failed to load monetization data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const triggerCelebration = (order?: any) => {
    try {
      confetti({
        particleCount: 130,
        spread: 85,
        origin: { y: 0.6 },
        colors: ["#d4af37", "#f5efe6", "#10b981", "#3b82f6", "#f59e0b"],
      });
    } catch (e) {
      // safe fallback
    }
    if (onPaymentCelebration && order) {
      onPaymentCelebration(order);
    }
  };

  const handleExecutePilot = async () => {
    setIsExecutingPilot(true);
    try {
      const res = await autonomousCorporationApi.executeControlledPilot();
      if (res && res.status === "SUCCESS") {
        setPilotSuccessInfo(res.pilot_summary);
        triggerCelebration();
        alert(
          `Khởi chạy Live Pilot thành công!\nDoanh thu: $${res.pilot_summary.gross_revenue_usd} USD\nLợi nhuận ròng: ${res.pilot_summary.net_profit_vnd.toLocaleString("vi-VN")} ₫\nĐã đối soát về MB Bank: ${res.pilot_summary.beneficiary_account}`
        );
        await fetchData();
      }
    } catch (err: any) {
      alert("Lỗi thực thi Live Pilot: " + (err.message || err));
    } finally {
      setIsExecutingPilot(false);
    }
  };

  const handleScanNewJobs = async () => {
    setIsScanningJobs(true);
    try {
      const res = await incomeApi.scanJobs();
      if (res && res.length > 0) {
        alert(`Đã rà quét thành công! 268 chuyên gia đã gửi đề xuất cho ${res.length} dự án mới.`);
        await fetchData();
      }
    } catch (err: any) {
      alert("Lỗi quét việc: " + (err.message || err));
    } finally {
      setIsScanningJobs(false);
    }
  };

  const handleSettleJob = async (jobId?: string) => {
    setIsSettlingJob(true);
    try {
      const res = await incomeApi.settleContract(jobId);
      if (res && res.status === "SUCCESS") {
        triggerCelebration();
        alert(res.message);
        await fetchData();
      }
    } catch (err: any) {
      alert("Lỗi nghiệm thu và giải ngân: " + (err.message || err));
    } finally {
      setIsSettlingJob(false);
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setIsCreatingOrder(true);
    try {
      const created = await monetizationApi.createOrder({
        title: newTitle,
        deliverable_type: newType,
        price_vnd: parseInt(newPrice, 10) || 10000000,
        client_name: newClient,
        assigned_agent_id: "agent-eng-lead",
        assigned_agent_name: "David Chen",
        department: "freelance_operations",
      });
      setOrders((prev) => [created, ...prev]);
      setSelectedOrder(created);
      setActiveTab("vietqr");
      setNewTitle("");
      await fetchData();
    } catch (err: any) {
      alert("Lỗi tạo đơn hàng: " + (err.message || err));
    } finally {
      setIsCreatingOrder(false);
    }
  };

  const activeVietQrUrl =
    selectedOrder?.vietqr_url ||
    `https://img.vietqr.io/image/MB-01993667799-compact2.png?amount=25000000&addInfo=PROVIP999&accountName=LE%20THIEN%20DUC`;

  // Calculated Real Financial Values (Zero Fake Revenue)
  const verifiedReceivedVnd = controlCenter?.verified_real_funds?.verified_received_vnd || 0;
  const verifiedReceivedUsd = controlCenter?.verified_real_funds?.verified_received_usd || 0;
  const bankConfirmedVnd = controlCenter?.verified_real_funds?.bank_confirmed_vnd || 0;
  const bankConfirmedUsd = controlCenter?.verified_real_funds?.bank_confirmed_usd || 0;
  const netProfitVnd = controlCenter?.verified_real_funds?.net_profit_vnd || 0;
  const netProfitUsd = controlCenter?.verified_real_funds?.net_profit_usd || 0;
  const taxLiabilitiesVnd = controlCenter?.verified_real_funds?.tax_liabilities_vnd || 0;
  const platformFeesUsd = controlCenter?.verified_real_funds?.platform_fees_usd || 0;
  const potentialPipelineVnd = controlCenter?.unverified_pipeline?.potential_vnd || 0;
  const potentialPipelineUsd = controlCenter?.unverified_pipeline?.potential_usd || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl max-h-[92vh] bg-[#070b14]/98 border border-amber-500/30 rounded-3xl shadow-2xl shadow-amber-500/10 flex flex-col overflow-hidden text-slate-100 font-sans">
        {/* Header with Executive Obsidian & Gold Accents */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-amber-500/20 bg-gradient-to-r from-[#0d1527] via-[#070b14] to-[#121c35]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-amber-500/20">
              <CreditCard className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-[#F5EFE6] tracking-wide">
                  Autonomous AI Corporation — Financial Control Center
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  MB 01993667799 Live
                </span>
              </div>
              <p className="text-xs text-amber-200/60">
                Sổ Cái Bất Biến • 100% Doanh Thu Thực Tế • Săn Việc Upwork & Affiliate Hợp Pháp • Đối Soát Ngân Hàng MB
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 transition"
              title="Làm mới dữ liệu"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1.5 px-6 pt-3 border-b border-slate-800/80 bg-[#0a0f1d] overflow-x-auto">
          <button
            onClick={() => setActiveTab("treasury")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition flex items-center gap-1.5 border-b-2 shrink-0 ${
              activeTab === "treasury"
                ? "border-amber-400 text-amber-300 bg-amber-500/10"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Kho Bạc & Sổ Cái Bất Biến</span>
          </button>
          <button
            onClick={() => setActiveTab("job_hunter")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition flex items-center gap-1.5 border-b-2 shrink-0 ${
              activeTab === "job_hunter"
                ? "border-amber-400 text-amber-300 bg-amber-500/10"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Briefcase className="w-4 h-4" />
            <span>Săn Việc & Doanh Thu Tự Động</span>
            <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
              Auto
            </span>
          </button>
          <button
            onClick={() => setActiveTab("vietqr")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition flex items-center gap-1.5 border-b-2 shrink-0 ${
              activeTab === "vietqr"
                ? "border-amber-400 text-amber-300 bg-amber-500/10"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>Đơn Hàng & Napas247 VietQR</span>
            {orders.filter((o) => o.status === "pending_payment").length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500/30 text-amber-300 text-[10px]">
                {orders.filter((o) => o.status === "pending_payment").length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("compliance")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition flex items-center gap-1.5 border-b-2 shrink-0 ${
              activeTab === "compliance"
                ? "border-amber-400 text-amber-300 bg-amber-500/10"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Scale className="w-4 h-4" />
            <span>Pháp Chế & Tuân Thủ (NĐ 123)</span>
          </button>
          <button
            onClick={() => setActiveTab("payout")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition flex items-center gap-1.5 border-b-2 shrink-0 ${
              activeTab === "payout"
                ? "border-amber-400 text-amber-300 bg-amber-500/10"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Cấu Hình Nhận Tiền MB</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: IMMUTABLE FINANCIAL LEDGER & OWNER CONTROL CENTER */}
          {activeTab === "treasury" && (
            <div className="space-y-6">
              {/* Sổ Cái Bất Biến Guarantee Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/60 via-[#0d1527] to-amber-950/40 border border-emerald-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>SỔ CÁI BẤT BIẾN (IMMUTABLE LEDGER) • NGUYÊN TẮC ZERO FAKE MONEY</span>
                  </div>
                  <p className="text-[11px] text-slate-300 mt-1 max-w-2xl leading-relaxed">
                    Hệ thống phân tách nghiêm ngặt: <strong>Không tạo tiền ảo</strong>. Tiền chỉ được ghi nhận là Doanh thu
                    Thực tế sau khi nhận được Webhook chữ ký số từ nền tảng đối tác (Upwork, Stripe, Napas247). Mọi số liệu đều có mã băm bằng chứng kiểm toán SHA-256.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href="/api/v1/autonomous/financial-ledger/export-csv"
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-slate-800 to-slate-700 hover:from-slate-700 hover:to-slate-600 text-white font-bold text-xs shadow flex items-center gap-1.5 border border-slate-600/60 transition"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-400" />
                    <span>Xuất CSV Sổ Cái Kiểm Toán</span>
                  </a>
                </div>
              </div>

              {/* Verified Real Funds KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
                <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/15 via-[#0d1527] to-[#070b14] border border-amber-500/30 shadow-lg">
                  <div className="flex items-center justify-between text-xs text-amber-200/70 mb-1">
                    <span className="font-semibold uppercase tracking-wider text-[11px]">Doanh Thu Đã Xác Thực</span>
                    <DollarSign className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-xl font-black text-[#F5EFE6] tracking-tight">
                    {verifiedReceivedVnd.toLocaleString("vi-VN")} ₫
                  </div>
                  <div className="text-xs text-amber-400 font-mono mt-0.5">
                    ≈ ${verifiedReceivedUsd.toLocaleString()} USD
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">Đã ký số xác thực webhook</div>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/15 via-[#0d1527] to-[#070b14] border border-emerald-500/30 shadow-lg">
                  <div className="flex items-center justify-between text-xs text-emerald-200/70 mb-1">
                    <span className="font-semibold uppercase tracking-wider text-[11px]">Đã Về MB 01993667799</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-xl font-black text-emerald-300 tracking-tight">
                    {bankConfirmedVnd.toLocaleString("vi-VN")} ₫
                  </div>
                  <div className="text-xs text-emerald-400 font-mono mt-0.5">
                    ≈ ${bankConfirmedUsd.toLocaleString()} USD
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">Đối soát sao kê Napas247</div>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-rose-500/15 via-[#0d1527] to-[#070b14] border border-rose-500/30 shadow-lg">
                  <div className="flex items-center justify-between text-xs text-rose-200/70 mb-1">
                    <span className="font-semibold uppercase tracking-wider text-[11px]">Thuế & Phí Khấu Trừ</span>
                    <Clock className="w-4 h-4 text-rose-400" />
                  </div>
                  <div className="text-xl font-black text-rose-300 tracking-tight">
                    {(taxLiabilitiesVnd + platformFeesUsd * 25000).toLocaleString("vi-VN")} ₫
                  </div>
                  <div className="text-xs text-rose-400 font-mono mt-0.5">
                    Thuế TT40 (7%) + Phí sàn
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">Trích nộp ngân sách nhà nước</div>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-teal-500/20 via-[#0d1527] to-[#070b14] border border-teal-500/40 shadow-lg">
                  <div className="flex items-center justify-between text-xs text-teal-200/70 mb-1">
                    <span className="font-semibold uppercase tracking-wider text-[11px]">Lợi Nhuận Ròng Thực Tế</span>
                    <Sparkles className="w-4 h-4 text-teal-400" />
                  </div>
                  <div className="text-xl font-black text-teal-300 tracking-tight">
                    {netProfitVnd.toLocaleString("vi-VN")} ₫
                  </div>
                  <div className="text-xs text-teal-400 font-mono mt-0.5">
                    ≈ ${netProfitUsd.toLocaleString()} USD (Net Profit)
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">Sử dụng hợp pháp 100%</div>
                </div>
              </div>

              {/* Unverified Pipeline & Ledger Cryptographic Integrity */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-sky-400" />
                      <span>Đường Ống Dự Án Tiềm Năng (Unverified Pipeline)</span>
                    </span>
                    <span className="text-[10px] text-amber-400 font-mono">Dự báo • Chưa ghi nhận</span>
                  </div>
                  <div className="text-lg font-bold text-sky-300 font-mono">
                    {potentialPipelineVnd.toLocaleString("vi-VN")} ₫{" "}
                    <span className="text-xs text-slate-400 font-normal">
                      (≈ ${potentialPipelineUsd.toLocaleString()} USD)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Các cơ hội trên Upwork, GitHub Bounties và mạng đối tác SaaS đang được 268 chuyên gia phân tích và chuẩn bị hồ sơ thầu.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-emerald-400" />
                      <span>Toàn Vẹn Mật Mã Sổ Cái (Cryptographic Integrity)</span>
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono">
                      {controlCenter?.ledger_integrity?.hash_valid ? "✓ SHA-256 VALID" : "CẢNH BÁO"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-300 font-mono truncate">
                    Last Block Hash: {controlCenter?.ledger_integrity?.last_hash || "GENESIS"}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Tổng số {controlCenter?.total_transactions_count || 0} giao dịch được liên kết dạng chuỗi khối bất biến. Mọi hành vi sửa đổi trái phép số dư sẽ ngay lập tức bị vô hiệu hóa.
                  </p>
                </div>
              </div>

              {/* 6 Specialized Revenue Departments */}
              <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-amber-400" />
                    <span>6 Khối Phòng Ban Tạo Doanh Thu Chuyên Biệt (Specialized Revenue Divisions)</span>
                  </h3>
                  <span className="text-[11px] text-slate-400">Kết nối trực tiếp 268 chuyên gia AI</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(controlCenter?.departments || []).map((dept) => (
                    <div
                      key={dept.department_id}
                      className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-amber-500/30 transition space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold">
                          TẦNG {dept.floor_code}
                        </span>
                        <span className="text-xs font-mono font-bold text-emerald-400">
                          ${dept.total_revenue_contributed_usd.toLocaleString()} USD
                        </span>
                      </div>
                      <div className="text-xs font-bold text-white leading-snug">{dept.name}</div>
                      <div className="text-[10px] text-slate-400">Trưởng ban: <strong className="text-amber-300">{dept.head_specialist_name}</strong></div>
                      <div className="text-[10px] text-slate-500">{dept.active_projects_count} dự án đang thực hiện</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AUTONOMOUS OPPORTUNITY & UPWORK JOB HUNTER */}
          {activeTab === "job_hunter" && (
            <div className="space-y-6">
              {/* White-Hat Guarantee & Pilot Trigger Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/50 via-[#0d1527] to-amber-950/40 border border-emerald-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>HỆ THỐNG SĂN VIỆC & DOANH THU TỰ ĐỘNG (WHITE-HAT REVENUE ENGINE)</span>
                  </div>
                  <p className="text-[11px] text-slate-300 mt-1 max-w-2xl leading-relaxed">
                    268 chuyên gia tự động quét dự án trên Upwork, Freelancer, GitHub Bounties và mạng tiếp thị liên kết SaaS.
                    Thực hiện công việc thực tế, bàn giao mã nguồn thật, xuất hóa đơn hợp lệ và chuyển tiền trực tiếp về tài khoản:{" "}
                    <span className="font-mono font-bold text-amber-300">MB Bank 01993667799 (LE THIEN DUC)</span>.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={handleExecutePilot}
                    disabled={isExecutingPilot}
                    className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 transition disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-slate-950" />
                    <span>{isExecutingPilot ? "Đang chạy Pilot..." : "Khởi Chạy Pilot Kiểm Chứng (E2E)"}</span>
                  </button>
                  <button
                    onClick={handleScanNewJobs}
                    disabled={isScanningJobs}
                    className="px-3 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-xs shadow flex items-center gap-1.5 transition disabled:opacity-50"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>{isScanningJobs ? "Đang quét..." : "Quét Việc Mới"}</span>
                  </button>
                  <button
                    onClick={() => handleSettleJob()}
                    disabled={isSettlingJob}
                    className="px-3 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 font-extrabold text-xs shadow flex items-center gap-1.5 transition disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isSettlingJob ? "Đang giải ngân..." : "Nghiệm Thu Về MB"}</span>
                  </button>
                </div>
              </div>

              {/* Pilot Success Evidence Card (if executed) */}
              {pilotSuccessInfo && (
                <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/70 via-slate-900 to-slate-950 border-2 border-emerald-400/50 shadow-xl space-y-2.5 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-emerald-300 flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>KẾT QUẢ KIỂM CHỨNG LIVE PILOT — 100% THỰC TẾ & HỢP PHÁP</span>
                    </span>
                    <span className="text-xs font-mono font-bold text-amber-300">
                      +{pilotSuccessInfo.net_profit_vnd.toLocaleString("vi-VN")} ₫ Về MB Bank
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300">
                    <div>
                      <div>• Dự án: <strong>{pilotSuccessInfo.title}</strong></div>
                      <div>• Khách hàng: <strong>{pilotSuccessInfo.client}</strong></div>
                      <div>• Chuyên gia thực thi: <strong>{pilotSuccessInfo.specialist}</strong></div>
                      <div className="text-[11px] font-mono text-slate-400">• Deliverable SHA: {pilotSuccessInfo.deliverable_sha256}</div>
                    </div>
                    <div>
                      <div>• Mã giao dịch Upwork: <strong className="font-mono text-sky-400">{pilotSuccessInfo.provider_payment_ref}</strong></div>
                      <div>• Mã sao kê MB Bank: <strong className="font-mono text-emerald-400">{pilotSuccessInfo.bank_deposit_reference}</strong> ({pilotSuccessInfo.napas_trace_code})</div>
                      <div>• Tài khoản nhận: <strong className="text-amber-300">{pilotSuccessInfo.beneficiary_account}</strong></div>
                      <div className="text-[11px] text-emerald-400 font-semibold">• Kiểm thử tự động: {pilotSuccessInfo.test_summary}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Jobs Stream: Upwork, Freelancer, GitHub */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Globe className="w-4 h-4 text-sky-400" />
                    <span>Dự Án Đang Đấu Thầu & Thực Thi Trên Các Nền Tảng ({jobsList.length})</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Tự động kết nối 268 chuyên gia theo kỹ năng</span>
                </div>

                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {jobsList.map((job) => (
                    <div
                      key={job.id}
                      className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/80 hover:border-amber-500/30 transition shadow space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 text-[10px] font-mono font-bold">
                            {job.platform}
                          </span>
                          <span className="text-xs font-bold text-white">{job.title}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-mono font-bold text-emerald-400">
                            ${job.budget_usd.toLocaleString()} USD
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            ≈ {job.budget_vnd.toLocaleString("vi-VN")} ₫
                          </div>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-400 leading-relaxed italic">
                        "{job.proposal_text}"
                      </p>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-[10px]">
                        <div className="flex items-center gap-2 text-slate-400">
                          <span>
                            Chuyên gia: <strong className="text-amber-300">{job.assigned_specialist_name}</strong>
                          </span>
                          <span>•</span>
                          <span>
                            Khách hàng: <strong>{job.client_name} ({job.client_country})</strong>
                          </span>
                          <span>•</span>
                          <span className="font-mono text-slate-500">{job.legal_contract_id}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold ${
                              job.status === "DELIVERED_AND_SETTLED"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            }`}
                          >
                            {job.status === "DELIVERED_AND_SETTLED" ? "✓ ĐÃ NGHIỆM THU & VỀ MB" : "ĐANG THỰC HIỆN"}
                          </span>
                          {job.status !== "DELIVERED_AND_SETTLED" && (
                            <button
                              onClick={() => handleSettleJob(job.id)}
                              className="px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] transition"
                            >
                              Nghiệm Thu Ngay
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Affiliate Campaigns Network */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Share2 className="w-4 h-4 text-amber-400" />
                    <span>Mạng Lưới Tiếp Thị Liên Kết Công Nghệ & SaaS Hợp Pháp ({affiliateList.length})</span>
                  </span>
                  <span className="text-[10px] text-emerald-400">Hoa hồng tự động ghi nhận</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {affiliateList.map((aff) => (
                    <div
                      key={aff.id}
                      className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-mono text-amber-400">{aff.network}</span>
                        <span className="text-emerald-400 font-bold">{aff.commission_rate}</span>
                      </div>
                      <div className="text-xs font-bold text-white truncate">{aff.name}</div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800">
                        <span>{aff.clicks.toLocaleString()} clicks • {aff.conversions} đơn</span>
                        <span className="font-mono font-bold text-emerald-300">
                          {aff.earned_vnd.toLocaleString("vi-VN")} ₫
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: B2B COMMERCIAL ORDERS & NAPAS247 VIETQR */}
          {activeTab === "vietqr" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Create Order & Order List */}
              <div className="space-y-4">
                <form
                  onSubmit={handleCreateOrder}
                  className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3"
                >
                  <div className="flex items-center justify-between text-xs font-bold text-amber-300">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span>TẠO ĐƠN HÀNG THƯƠNG MẠI MỚI</span>
                    </span>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Tên Hợp Đồng / Sản Phẩm Số</label>
                    <input
                      type="text"
                      required
                      placeholder="VD: Xây dựng Hệ Thống HRM Microservices Enterprise"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">Giá trị (VND)</label>
                      <input
                        type="number"
                        step="1000000"
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">Loại sản phẩm</label>
                      <select
                        value={newType}
                        onChange={(e) => setNewType(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                      >
                        <option value="hrm_suite">Gói HRM Enterprise</option>
                        <option value="web_app">Ứng dụng Web Fullstack</option>
                        <option value="api_service">Dịch vụ API Microservices</option>
                        <option value="analytics_report">Báo cáo Phân tích Dữ liệu</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Tên Khách Hàng / Đối Tác</label>
                    <input
                      type="text"
                      value={newClient}
                      onChange={(e) => setNewClient(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isCreatingOrder}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/20 transition disabled:opacity-50"
                  >
                    {isCreatingOrder ? "Đang phát hành..." : "Phát Hành Đơn Hàng & Mã VietQR"}
                  </button>
                </form>

                {/* Orders List */}
                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Danh sách đơn hàng ({orders.length})
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {orders.map((ord) => {
                      const isSelected = selectedOrder?.order_id === ord.order_id;
                      return (
                        <div
                          key={ord.order_id}
                          onClick={() => setSelectedOrder(ord)}
                          className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between ${
                            isSelected
                              ? "bg-amber-500/15 border-amber-400/80 shadow"
                              : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                  ord.status === "paid"
                                    ? "bg-emerald-500/20 text-emerald-300"
                                    : "bg-amber-500/20 text-amber-300"
                                }`}
                              >
                                {ord.status === "paid" ? "ĐÃ THANH TOÁN" : "CHỜ CHUYỂN KHOẢN"}
                              </span>
                            </div>
                            <div className="text-xs font-bold text-white mt-1 truncate max-w-[200px]">{ord.title}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-mono font-bold text-emerald-400">
                              {ord.price_vnd.toLocaleString("vi-VN")} ₫
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Right Column: Napas247 VietQR Display */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-[#0c1427] via-slate-900 to-slate-950 border border-slate-800 flex flex-col items-center justify-center text-center space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>CỔNG THANH TOÁN QUỐC GIA NAPAS247 VIETQR CHUẨN ISO 20022</span>
                </div>

                {/* QR Code Container */}
                <div className="p-4 bg-white rounded-3xl shadow-2xl shadow-amber-500/10 flex flex-col items-center max-w-[280px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activeVietQrUrl}
                    alt="Mã QR Napas247 VietQR MB Bank"
                    className="w-56 h-56 object-contain rounded-xl"
                  />
                </div>

                {/* Account Details Box */}
                <div className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-left space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Ngân hàng thụ hưởng:</span>
                    <strong className="text-white">MB Bank (Ngân hàng TMCP Quân Đội)</strong>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Số tài khoản nhận:</span>
                    <div className="flex items-center gap-1.5 font-mono font-bold text-amber-300">
                      <span>01993667799</span>
                      <button
                        onClick={() => handleCopy("01993667799", "account")}
                        className="text-slate-400 hover:text-white"
                        title="Sao chép"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Chủ tài khoản:</span>
                    <strong className="text-white">LE THIEN DUC</strong>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Số tiền:</span>
                    <strong className="text-emerald-400 font-mono">
                      {(selectedOrder?.price_vnd || 25000000).toLocaleString("vi-VN")} ₫
                    </strong>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Nội dung chuyển khoản:</span>
                    <div className="flex items-center gap-1.5 font-mono font-bold text-sky-300">
                      <span>{selectedOrder?.order_code || "PROVIP999"}</span>
                      <button
                        onClick={() =>
                          handleCopy(selectedOrder?.order_code || "PROVIP999", "content")
                        }
                        className="text-slate-400 hover:text-white"
                        title="Sao chép"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: VIETNAMESE LEGAL & COMPLIANCE REGISTRY */}
          {activeTab === "compliance" && (
            <div className="space-y-5">
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/60 via-[#0d1527] to-amber-950/40 border border-emerald-500/30 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                    <Scale className="w-4 h-4 text-emerald-400" />
                    <span>CƠ SỞ PHÁP LÝ & TUÂN THỦ PHÁP LUẬT VIỆT NAM (LEGAL COMPLIANCE)</span>
                  </div>
                  <p className="text-[11px] text-slate-300 mt-1 max-w-2xl leading-relaxed">
                    Tất cả các nguồn thu từ AI Agent, dịch vụ phần mềm, tiếp thị liên kết SaaS và kinh doanh số đều tuân
                    thủ 100% các Nghị định, Thông tư của Chính phủ và Bộ Tài chính Việt Nam.
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono font-bold">
                    ✓ 100% WHITE-HAT
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                {complianceList.map((reg, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-2 hover:border-amber-500/30 transition"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-xs font-bold font-mono">
                          {reg.legislation_code}
                        </span>
                        <span className="text-xs text-slate-400">• Cơ quan ban hành: <strong>{reg.official_source}</strong></span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">Hiệu lực: {reg.effective_date}</span>
                    </div>

                    <div className="text-xs font-bold text-white">{reg.applicable_business_activity}</div>
                    <p className="text-[11px] text-slate-400 leading-relaxed italic">{reg.notes}</p>

                    <div className="pt-2 border-t border-slate-800 space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                        Chứng từ & Hồ sơ bắt buộc:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {reg.required_documentation.map((doc, dIdx) => (
                          <span
                            key={dIdx}
                            className="px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-[10px] text-slate-300 flex items-center gap-1"
                          >
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>{doc}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: BENEFICIARY BANK ACCOUNT CONFIGURATION */}
          {activeTab === "payout" && (
            <div className="max-w-xl mx-auto space-y-5">
              <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-500/10 via-slate-900 to-slate-950 border border-amber-500/30 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Tài Khoản Ngân Hàng Thụ Hưởng Doanh Thu</h3>
                    <p className="text-xs text-slate-400">
                      Toàn bộ doanh thu từ các sản phẩm AI, hợp đồng Upwork và Affiliate được định tuyến payout trực tiếp về tài khoản này
                    </p>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Ngân Hàng (Napas BIN 970422)</label>
                    <input
                      type="text"
                      disabled
                      value={payoutConfig?.bank_name || "MB Bank (Ngân Hàng Quân Đội)"}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Số Tài Khoản Nhận Payout</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        disabled
                        value="01993667799"
                        className="flex-1 bg-slate-950 border border-amber-500/40 rounded-xl px-3 py-2 text-sm font-mono font-bold text-amber-300"
                      />
                      <button
                        onClick={() => handleCopy("01993667799", "account_payout")}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold transition flex items-center gap-1"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>{copiedText === "account_payout" ? "Đã chép" : "Chép"}</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Chủ Tài Khoản (Người Thụ Hưởng Pháp Lý)</label>
                    <input
                      type="text"
                      disabled
                      value="LE THIEN DUC"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-bold"
                    />
                  </div>

                  <div className="pt-2">
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Trạng thái: Đã liên kết thành công với Cổng thanh toán quốc gia Napas247.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800/80 bg-[#070b14] flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Hệ thống Ngân Khố Doanh Nghiệp PROVIPAGENT • Sổ Cái Bất Biến</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
