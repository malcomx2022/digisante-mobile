// Observance médicamenteuse (« j'ai pris », streak, % sur 7 jours).
import { get, postNow } from './client';

export interface Treatment {
  itemId: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  takenToday: boolean;
}

export interface AdherenceSummary {
  streak: number;
  adherence7: number;
  daysActive: number;
}

export interface AdherenceToday {
  treatments: Treatment[];
  summary: AdherenceSummary;
}

/** Lève si la mutation a été mise en file hors-ligne (déclaration de prise = réseau requis). */
function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

export const adherenceApi = {
  today: () => get<AdherenceToday>('/adherence/today'),
  take: (itemId: string, medicationName: string) =>
    postNow<{ id: string; alreadyTaken: boolean }>('/adherence/intake', { itemId, medicationName }).then(online),
};
