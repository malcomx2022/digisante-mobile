// Laboratoire : pool de demandes anonymisé, prise en charge, transitions, résultat.
import { get, postNow } from './client';

export interface AvailableOrder {
  id: string;
  testType: string;
  scheduledAt: string | null;
  createdAt: string;
}

export interface IncomingOrder {
  id: string;
  testType: string;
  status: 'SAMPLE_COLLECTED' | 'PROCESSING' | 'COMPLETED';
  scheduledAt: string | null;
  hasResult: boolean;
  patient: { firstName: string; lastName: string } | null;
  prescribedBy: { firstName: string; lastName: string } | null;
}

export interface CriticalValue {
  key: string;
  reason: string;
}

export interface SubmitResult {
  critical: CriticalValue[];
}

function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

export const labApi = {
  available: () => get<AvailableOrder[]>('/lab/orders/available'),
  incoming: () => get<IncomingOrder[]>('/lab/orders/incoming'),
  claim: (id: string) => postNow<{ id: string; status: string }>(`/lab/orders/${id}/claim`).then(online),
  advance: (id: string) => postNow<{ id: string; status: string }>(`/lab/orders/${id}/advance`).then(online),
  submitResult: (orderId: string, values: Record<string, number | string>) =>
    postNow<SubmitResult>(`/lab/orders/${orderId}/result`, { values }).then(online),
};
