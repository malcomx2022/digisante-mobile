// Rendez-vous de l'utilisateur courant (vue patient).
import { get, postNow } from './client';

export interface PatientAppointment {
  id: string;
  type: 'PHYSICAL' | 'TELECONSULTATION';
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
  scheduledAt: string;
  doctorName: string;
  speciality: string;
  patientName: string;
  consultationId: string | null;
  consultationStatus: string | null;
  fee: number;
  paid: boolean;
  paymentStatus: string | null;
}

function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

export const appointmentsApi = {
  listMine: () => get<PatientAppointment[]>('/appointments?pageSize=50'),
  cancel: (id: string, reason: string) =>
    postNow<{ status: string }>(`/appointments/${id}/cancel`, { reason }).then(online),
};
