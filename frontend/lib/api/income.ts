import { apiClient } from "./client";

export interface IncomeOverview {
  payout_account_number: string;
  payout_account_name: string;
  payout_bank_name: string;
  payout_bank_id: string;
  total_lifetime_earned_vnd: number;
  total_lifetime_earned_usd: number;
  settled_to_bank_vnd: number;
  settled_to_bank_usd: number;
  pending_settlement_vnd: number;
  pending_settlement_usd: number;
  active_bids_count: number;
  completed_contracts_count: number;
  legal_compliance_guarantee: string;
  active_affiliate_count: number;
  updated_at: string;
}

export interface FreelanceJobItem {
  id: string;
  platform: string;
  title: string;
  client_name: string;
  client_country: string;
  budget_usd: number;
  budget_vnd: number;
  required_skills: string[];
  assigned_specialist_id: string;
  assigned_specialist_name: string;
  department: string;
  status: "DISCOVERED" | "PROPOSAL_SENT" | "CONTRACT_ACCEPTED" | "DELIVERED_AND_SETTLED";
  proposal_text: string;
  deliverable_preview_url: string;
  legal_contract_id: string;
  payout_tx_ref?: string | null;
  created_at: string;
  settled_at?: string | null;
}

export interface AffiliateCampaignItem {
  id: string;
  name: string;
  network: string;
  category: string;
  commission_rate: string;
  clicks: number;
  conversions: number;
  earned_vnd: number;
  earned_usd: number;
  landing_url: string;
  status: string;
}

export const incomeApi = {
  getOverview: async (): Promise<IncomeOverview> => {
    return apiClient<IncomeOverview>("/api/v1/income/overview");
  },

  listJobs: async (): Promise<FreelanceJobItem[]> => {
    return apiClient<FreelanceJobItem[]>("/api/v1/income/jobs");
  },

  scanJobs: async (): Promise<FreelanceJobItem[]> => {
    return apiClient<FreelanceJobItem[]>("/api/v1/income/scan-jobs", {
      method: "POST",
    });
  },

  settleContract: async (jobId?: string): Promise<{
    status: string;
    message: string;
    job: FreelanceJobItem;
    payout_transfer: {
      bank: string;
      account_number: string;
      account_name: string;
      amount_vnd: number;
      amount_usd: number;
      tx_ref: string;
      legal_compliance: string;
    };
  }> => {
    return apiClient<{
      status: string;
      message: string;
      job: FreelanceJobItem;
      payout_transfer: any;
    }>("/api/v1/income/settle-contract", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId }),
    });
  },

  listAffiliateCampaigns: async (): Promise<AffiliateCampaignItem[]> => {
    return apiClient<AffiliateCampaignItem[]>("/api/v1/income/affiliate");
  },
};

