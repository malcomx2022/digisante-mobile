// Pharmacie : scan d'ordonnance, délivrance granulaire, journal de dispensation.
import { get, post } from './client';

export type LineStatus = 'DISPENSED' | 'PARTIALLY_DISPENSED' | 'UNAVAILABLE';

export interface ScanItem {
  id: string;
  medicationName: string;
  dosage?: string;
  status: string;
  genericSuggestion: string | null;
}

export interface ScanResult {
  authentic: boolean;
  id: string;
  expired: boolean;
  patient: { firstName: string; lastName: string } | null;
  items: ScanItem[];
}

export interface Dispensation {
  id: string;
  status: string;
  lines: { medicationName: string; status: LineStatus }[];
  dispensedAt: string;
  patient: { firstName: string; lastName: string } | null;
}

function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

export const pharmacyApi = {
  scan: (qrCode: string) => post<ScanResult>('/pharmacy/scan', { qrCode }).then(online),
  dispense: (prescriptionId: string, items: { itemId: string; status: LineStatus }[]) =>
    post<{ prescriptionId: string; status: string }>(`/pharmacy/prescriptions/${prescriptionId}/dispense`, { items }).then(online),
  dispensations: () => get<Dispensation[]>('/pharmacy/dispensations'),
};
