// Couverture d'assurance santé : catalogue des assureurs + couvertures du patient.
import { del, get, post } from './client';

export interface InsuranceProvider {
  id: string;
  name: string;
  code: string;
  coverageTypes: string[];
}

export type CoverageStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';

export interface Coverage {
  id: string;
  memberNumber: string;
  status: CoverageStatus;
  expiresAt: string | null;
  insurance: InsuranceProvider;
}

/** Lève si la mutation a été mise en file hors-ligne (déclaration = réseau requis). */
function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

export const insuranceApi = {
  providers: () => get<InsuranceProvider[]>('/insurance/providers'),
  mine: () => get<Coverage[]>('/insurance/me'),
  add: (body: { insuranceId: string; memberNumber: string; expiresAt?: string }) =>
    post<Coverage>('/insurance/me', body).then(online),
  remove: (id: string) => del<{ id: string; deleted: boolean }>(`/insurance/me/${id}`).then(online),
};
