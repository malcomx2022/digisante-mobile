// Agent de Santé Communautaire : roster + observations + signalement médecin.
import { get, delNow, postNow } from './client';

export interface AscBeneficiary {
  id: string;
  name: string;
  phone: string | null;
  village: string | null;
  birthDate: string | null;
  notes: string | null;
  createdAt: string;
}
export interface AscObservation {
  id: string;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  temperature: number | null;
  weight: number | null;
  triageOutcome: string | null;
  note: string | null;
  createdAt: string;
}
export interface AscBeneficiaryDetail extends AscBeneficiary {
  observations: AscObservation[];
}

function online<T>(r: T | { queued: true }): T {
  if (r && typeof r === 'object' && 'queued' in r) throw new Error('Connexion requise');
  return r as T;
}

export const ascApi = {
  list: () => get<AscBeneficiary[]>('/asc/beneficiaries'),
  add: (body: { name: string; phone?: string; village?: string; birthDate?: string; notes?: string }) =>
    postNow<AscBeneficiary>('/asc/beneficiaries', body).then(online),
  get: (id: string) => get<AscBeneficiaryDetail>(`/asc/beneficiaries/${id}`),
  remove: (id: string) => delNow<{ removed: boolean }>(`/asc/beneficiaries/${id}`).then(online),
  addObservation: (id: string, body: Partial<Omit<AscObservation, 'id' | 'createdAt'>>) =>
    postNow<AscObservation>(`/asc/beneficiaries/${id}/observations`, body).then(online),
  relay: (id: string, doctorId: string, message: string) =>
    postNow<{ relayed: boolean }>(`/asc/beneficiaries/${id}/relay`, { doctorId, message }).then(online),
};
