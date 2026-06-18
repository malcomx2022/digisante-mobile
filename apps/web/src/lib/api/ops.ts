// Admin : santé système / monitoring (LECTURE SEULE). §4 : aucun médical.
import { get } from './client';

export interface OpsHealth {
  infra: { redis: 'up' | 'down'; db: 'up' | 'down'; uptimeSeconds: number; fedapayConfigured: boolean };
  notifications: {
    byStatus: { status: string; count: number }[];
    pending: number;
    failed: number;
    sentLast24h: number;
  };
  jobs: {
    reconciliationBacklog: number;
    medicationLastGeneratedAt: string | null;
    appointmentLastReminderAt: string | null;
  };
  events24h: { action: string; count: number }[];
}

export const opsApi = {
  health: () => get<OpsHealth>('/admin/ops/health'),
};
