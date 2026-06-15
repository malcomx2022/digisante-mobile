// Rappels horaires de traitement (observance).
import { del, get, post } from './client';

export interface MedicationReminder {
  id: string;
  itemId: string | null;
  medicationName: string;
  time: string; // "HH:mm"
}

function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

export const remindersApi = {
  listMedication: () => get<MedicationReminder[]>('/reminders/medication'),
  addMedication: (body: { medicationName: string; time: string; itemId?: string }) =>
    post<MedicationReminder>('/reminders/medication', body).then(online),
  removeMedication: (id: string) => del<{ removed: boolean }>(`/reminders/medication/${id}`).then(online),
};
