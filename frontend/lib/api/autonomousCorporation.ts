import { apiClient } from "./client";

export interface UnverifiedPipeline {
  potential_usd: number;
  potential_vnd: number;
  quoted_usd: number;
  quoted_vnd: number;
  contracted_usd: number;
  contracted_vnd: number;
  earned_usd: number;
  earned_vnd: number;
  pending_payments_usd: number;
  pending_payments_vnd: number;
}

export interface VerifiedRealFunds {
  verified_received_usd: number;
  verified_received_vnd: number;
  bank_confirmed_usd: number;
  bank_confirmed_vnd: number;
  platform_fees_usd: number;
  operating_expenses_usd: number;
  tax_liabilities_usd: number;
  tax_liabilities_vnd: number;
  net_profit_usd: number;
  net_profit_vnd: number;
}

export interface RevenueDepartmentInfo {
  department_id: string;
  name: string;
  floor_code: string;
  head_specialist_id: string;
  head_specialist_name: string;
  responsibilities: string[];
  active_projects_count: number;
  total_revenue_contributed_usd: number;
}

export interface ControlCenterSummary {
  unverified_pipeline: UnverifiedPipeline;
  verified_real_funds: VerifiedRealFunds;
  breakdowns: {
    by_department: Record<string, number>;
    by_platform: Record<string, number>;
    by_specialist: Record<string, number>;
  };
  total_transactions_count: number;
  ledger_integrity: {
    hash_valid: boolean;
    last_hash: string;
  };
  beneficiary_account: {
    bank: string;
    account_number: string;
    account_name: string;
  };
  ranked_opportunities_count: number;
  departments: RevenueDepartmentInfo[];
}

export interface BusinessOpportunityItem {
  opportunity_id: string;
  source_platform: string;
  customer_or_business: string;
  title: string;
  description: string;
  required_skills: string[];
  estimated_revenue_usd: number;
  platform_fee_rate: number;
  estimated_costs_usd: number;
  risk_score: number;
  legal_compliance_status: string;
  execution_status: string;
  assigned_specialist_name: string;
  department: string;
  expected_net_profit_usd: number;
  ranking_score: number;
  deliverable_hash?: string;
  created_at: string;
}

export interface LegalRegulation {
  legislation_code: string;
  official_source: string;
  effective_date: string;
  applicable_business_activity: string;
  required_documentation: string[];
  compliance_status: string;
  last_verified_date: string;
  notes: string;
}

export const autonomousCorporationApi = {
  getControlCenter: async (): Promise<ControlCenterSummary> => {
    return apiClient<ControlCenterSummary>("/api/v1/autonomous/control-center");
  },

  getRankedOpportunities: async (): Promise<BusinessOpportunityItem[]> => {
    return apiClient<BusinessOpportunityItem[]>("/api/v1/autonomous/opportunities");
  },

  scanFreshOpportunities: async (): Promise<{
    status: string;
    newly_discovered_count: number;
    total_active_opportunities: number;
    new_opportunities: BusinessOpportunityItem[];
  }> => {
    return apiClient("/api/v1/autonomous/scan-opportunities", { method: "POST" });
  },

  getDepartments: async (): Promise<RevenueDepartmentInfo[]> => {
    return apiClient<RevenueDepartmentInfo[]>("/api/v1/autonomous/departments");
  },

  getCompliance: async (): Promise<{
    registry: LegalRegulation[];
    beneficiary_account: string;
    tax_authority_compliance: string;
  }> => {
    return apiClient("/api/v1/autonomous/compliance");
  },

  executeControlledPilot: async (ownerKey: string = "OWNER-PILOT-AUTH-999"): Promise<{
    status: string;
    pilot_summary: any;
    financial_summary: ControlCenterSummary;
  }> => {
    return apiClient(`/api/v1/autonomous/execute-pilot?owner_auth_key=${encodeURIComponent(ownerKey)}`, {
      method: "POST",
    });
  },

  getExportCsvUrl: (): string => {
    return "/api/v1/autonomous/financial-ledger/export-csv";
  },
};
