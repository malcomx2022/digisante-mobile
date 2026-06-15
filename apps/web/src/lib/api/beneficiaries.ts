// Diaspora : carnet des proches au Bénin (au-dessus de la logique de paiement gelée).
import { del, get, patch, post } from './client';

export interface Beneficiary {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  languagesSpoken: string[];
  notes: string | null;
  createdAt: string;
}

export interface BeneficiaryInput {
  name: string;
  relationship?: string;
  phone?: string;
  languagesSpoken?: string[];
  notes?: string;
}

function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

export const beneficiariesApi = {
  list: () => get<Beneficiary[]>('/beneficiaries'),
  add: (body: BeneficiaryInput) => post<Beneficiary>('/beneficiaries', body).then(online),
  update: (id: string, body: BeneficiaryInput) => patch<Beneficiary>(`/beneficiaries/${id}`, body).then(online),
  remove: (id: string) => del<{ id: string; deleted: boolean }>(`/beneficiaries/${id}`).then(online),
};
