// Annuaire des médecins (liste filtrable + fiche détaillée + avis).
import { get, post } from './client';

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

export const professionalsApi = {
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
