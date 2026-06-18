// Admin : tableau de bord Finances. Consultation + remboursement (§5, finance:write).
import { get, post } from './client';

export interface PaymentBucket {
  status?: string;
  method?: string;
  count: number;
  volume: string | number;
}
export interface ReconItem {
  id: string;
  amount: string | number;
  method: string;
  type: string;
  fedapayId: string | null;
  createdAt: string;
}
export interface WalletMove {
  id: string;
  type: string;
  amount: string | number;
  reference: string | null;
  createdAt: string;
}
export interface CompletedPayment {
  id: string;
  amount: string | number;
  method: string;
  type: string;
  createdAt: string;
}
export interface FinanceOverview {
  periodDays: number;
  currency: string;
  payments: {
    byStatus: PaymentBucket[];
    byMethod: PaymentBucket[];
    recentCompleted: CompletedPayment[];
  };
  reconciliation: { backlog: number; oldest: ReconItem[] };
  wallets: { totalBalance: string | number; count: number; active: number; recentMovements: WalletMove[] };
}

export interface WebhookEntry {
  id: string;
  action: string;
  outcome: 'accepted' | 'rejected';
  source: string | null;
  fedapayId: string | null;
  ip: string | null;
  createdAt: string;
}
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const financeApi = {
  overview: (days = 30) => get<FinanceOverview>(`/admin/finance/overview?days=${days}`),
  webhooks: (page = 1, pageSize = 20) => get<Paginated<WebhookEntry>>(`/admin/finance/webhooks?page=${page}&pageSize=${pageSize}`),
  refund: (id: string, reason?: string) => post<{ status: string }>(`/admin/finance/payments/${id}/refund`, { reason }),
};
