// Médecin : réception et interprétation des résultats d'analyse prescrits.
import { get, post } from './client';

export interface DoctorLabResult {
  id: string;
  testType: string;
  patient: { firstName: string; lastName: string } | null;
  values: Record<string, number | string>;
  reportUrl: string | null;
  critical: { key: string; value: number; reason: 'LOW' | 'HIGH' }[];
  interpretation: string | null;
  interpretedAt: string | null;
  resultAt: string;
}

function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

export const labResultsApi = {
  list: () => get<DoctorLabResult[]>('/lab/results'),
  interpret: (orderId: string, interpretation: string) =>
    post<{ id: string; interpretation: string; interpretedAt: string }>(`/lab/orders/${orderId}/interpret`, { interpretation }).then(online),
};
