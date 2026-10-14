// Pharmacie : scan d'ordonnance, délivrance granulaire, journal de dispensation,
// stock & disponibilité (« médicament près de moi »).
import { get, delNow, postNow } from './client';

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

export type StockStatus = 'IN_STOCK' | 'LOW' | 'OUT';

export interface StockItem {
  id: string;
  displayName: string;
  status: StockStatus;
  price: number | null;
  updatedAt: string;
}
export interface AvailabilityItem {
  id: string;
  displayName: string;
  status: StockStatus;
  price: number | null;
  updatedAt: string;
  pharmacy: { id: string; name: string; address: string; phone: string };
  distanceKm: number | null;
}

export const pharmacyApi = {
  scan: (qrCode: string) => postNow<ScanResult>('/pharmacy/scan', { qrCode }).then(online),
  dispense: (prescriptionId: string, items: { itemId: string; status: LineStatus }[], qrCode: string) =>
    postNow<{ prescriptionId: string; status: string }>(`/pharmacy/prescriptions/${prescriptionId}/dispense`, { items, qrCode }).then(online),
  dispensations: () => get<Dispensation[]>('/pharmacy/dispensations'),
  // Stock (pharmacie) + disponibilité (patient).
  listStock: () => get<StockItem[]>('/pharmacy/stock'),
  saveStock: (body: { displayName: string; status?: StockStatus; price?: number | null }) => postNow<StockItem>('/pharmacy/stock', body).then(online),
  removeStock: (id: string) => delNow<{ removed: boolean }>(`/pharmacy/stock/${id}`).then(online),
  availability: (q: string, pos?: { lat: number; lng: number }) => {
    const params = new URLSearchParams({ q });
    if (pos) {
      params.set('lat', String(pos.lat));
      params.set('lng', String(pos.lng));
    }
    return get<{ items: AvailabilityItem[] }>(`/pharmacy/availability?${params.toString()}`);
  },
};
