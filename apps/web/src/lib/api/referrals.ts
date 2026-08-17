// Référencement entre médecins : orienter un patient vers un confrère et répondre.
import { get, post } from './client';

export type ReferralStatus = 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED';
export type ReferralAction = 'ACCEPT' | 'COMPLETE' | 'CANCEL';

export interface Referral {
  id: string;
  reason: string;
  status: ReferralStatus;
  createdAt: string;
  /** SENT = j'ai orienté · RECEIVED = on m'a orienté un patient. */
  direction: 'SENT' | 'RECEIVED';
  patientId: string;
  patientName: string;
  fromDoctorName: string;
  fromSpeciality: string;
  toDoctorName: string;
  toSpeciality: string;
}

/**
 * Orienter est un acte en ligne : la file hors-ligne renverrait `{ queued: true }`
 * sans jamais notifier le confrère, ce qui donnerait une fausse impression d'envoi.
 */
function online<T>(r: T | { queued: true }): T {
  if (r && typeof r === 'object' && 'queued' in r) throw new Error('Connexion requise');
  return r as T;
}

export const referralsApi = {
  list: () => get<Referral[]>('/referrals'),
  create: (body: { toDoctorId: string; patientId: string; reason: string }) =>
    post<{ id: string; status: ReferralStatus }>('/referrals', body).then(online),
  respond: (id: string, action: ReferralAction) =>
    post<{ id: string; status: ReferralStatus }>(`/referrals/${id}/respond`, { action }).then(online),
};
