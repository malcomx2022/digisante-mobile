// Annuaire des médecins (liste filtrable + fiche détaillée + avis).
import { get, patch, post } from './client';

export interface DoctorProfile {
  firstName: string;
  lastName: string;
  spokenLangs: string[];
  avatarUrl: string | null;
}

export interface RatingSummary {
  average: number | null;
  count: number;
}

export interface DoctorListItem {
  id: string;
  speciality: string;
  consultFee: string | number;
  isVerified: boolean;
  profile: DoctorProfile | null;
  rating: RatingSummary;
}

export interface DoctorDetail extends DoctorListItem {
  bio: string | null;
  lang: string;
  canReview: boolean;
}

export interface DoctorReview {
  rating: number;
  comment: string | null;
  name: string;
  at: string;
}

export interface ReviewsResponse {
  summary: RatingSummary;
  reviews: DoctorReview[];
}

interface Paginated<T> {
  data: T[];
  total: number;
}

function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

/** Champs de sa PROPRE fiche qu'un médecin peut modifier (PATCH /professionals/me).
 *  `licenseNumber` et `verifiedAt` en sont volontairement exclus : ils relèvent du
 *  KYC, pas de l'auto-déclaration. */
export interface UpdateProBody {
  speciality?: string;
  slotDuration?: number;
  consultFee?: number;
  bio?: string;
}

export const professionalsApi = {
  /** Met à jour sa propre fiche professionnelle (MEDECIN) — écart D4.
   *  ⚠️ `consultFee` est le montant IMPOSÉ PAR LE SERVEUR au paiement d'une
   *  consultation : le figer revenait à figer le tarif du médecin à vie. */
  updateMe: (body: UpdateProBody) =>
    patch<{ id: string; speciality: string; slotDuration: number; consultFee: string | number; bio: string | null }>(
      '/professionals/me',
      body,
    ).then(online),

  list: (params: { q?: string; lang?: string }) => {
    const qs = new URLSearchParams({ pageSize: '20' });
    if (params.q) qs.set('q', params.q);
    if (params.lang) qs.set('lang', params.lang);
    return get<Paginated<DoctorListItem>>(`/professionals?${qs.toString()}`);
  },
  getOne: (id: string) => get<DoctorDetail>(`/professionals/${id}`),
  reviews: (id: string) => get<ReviewsResponse>(`/professionals/${id}/reviews`),
  addReview: (id: string, body: { rating: number; comment?: string }) =>
    post<{ id: string; rating: number }>(`/professionals/${id}/reviews`, body).then(online),
};
