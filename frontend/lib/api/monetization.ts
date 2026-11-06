import { apiClient } from "./client";

export interface TreasuryMetrics {
  total_revenue_vnd: number;
  total_revenue_usd: number;
  total_settled_to_bank_vnd: number;
  total_settled_to_bank_usd: number;
  pending_revenue_vnd: number;
  paid_orders_count: number;
  pending_orders_count: number;
  bank_account_number: string;
  bank_name: string;
  bank_holder: string;
  specialist_leaderboard: Array<{
    agent_id: string;
    agent_name: string;
    department: string;
    completed_orders: number;
    revenue_vnd: number;
  }>;
}

export interface CommercialOrder {
  order_id: string;
  order_code: string;
  title: string;
  deliverable_type: string;
  price_vnd: number;
  price_usd: number;
  description: string;
  client_name: string;
  assigned_agent_id: string;
  assigned_agent_name: string;
  department: string;
  status: "pending_payment" | "paid" | "delivered";
  vietqr_url: string;
  bank_info: {
    bank_id: string;
    bank_name: string;
    account_number: string;
    account_name: string;
  };
  deliverable_preview_url: string;
  created_at: string;
  paid_at: string | null;
  transaction_ref?: string | null;
}

export interface BankPayoutConfig {
  bank_id: string;
  bank_name: string;
  bank_bin: string;
  account_number: string;
  account_name: string;
  auto_payout_enabled: boolean;
  payout_note: string;
}

export interface CreateOrderPayload {
  title: string;
  deliverable_type?: string;
  price_vnd: number;
  description?: string;
  client_name?: string;
  assigned_agent_id?: string;
  assigned_agent_name?: string;
  department?: string;
}

export const monetizationApi = {
  getTreasuryOverview: async (): Promise<TreasuryMetrics> => {
    return apiClient<TreasuryMetrics>("/api/v1/monetization/treasury");
  },

  listOrders: async (): Promise<CommercialOrder[]> => {
    return apiClient<CommercialOrder[]>("/api/v1/monetization/orders");
  },

  createOrder: async (payload: CreateOrderPayload): Promise<CommercialOrder> => {
    return apiClient<CommercialOrder>("/api/v1/monetization/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getPayoutConfig: async (): Promise<BankPayoutConfig> => {
    return apiClient<BankPayoutConfig>("/api/v1/monetization/config");
  },

  updatePayoutConfig: async (config: Partial<BankPayoutConfig>): Promise<BankPayoutConfig> => {
    return apiClient<BankPayoutConfig>("/api/v1/monetization/config", {
      method: "POST",
      body: JSON.stringify(config),
    });
  },

  simulatePayment: async (orderId?: string): Promise<{ status: string; order: CommercialOrder; message: string }> => {
    return apiClient<{ status: string; order: CommercialOrder; message: string }>("/api/v1/monetization/simulate-payment", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId }),
    });
  },
};

