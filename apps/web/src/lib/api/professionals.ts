// Annuaire des médecins (liste filtrable + fiche détaillée).
import { get } from './client';

export interface DoctorProfile {
  firstName: string;
  lastName: string;
  spokenLangs: string[];
  avatarUrl: string | null;
}

export interface DoctorListItem {
  id: string;
  speciality: string;
  consultFee: string | number;
  isVerified: boolean;
  profile: DoctorProfile | null;
}

export interface DoctorDetail extends DoctorListItem {
  bio: string | null;
  lang: string;
}

interface Paginated<T> {
  data: T[];
  total: number;
}

export const professionalsApi = {
  list: (params: { q?: string; lang?: string }) => {
    const qs = new URLSearchParams({ pageSize: '20' });
    if (params.q) qs.set('q', params.q);
    if (params.lang) qs.set('lang', params.lang);
    return get<Paginated<DoctorListItem>>(`/professionals?${qs.toString()}`);
  },
  getOne: (id: string) => get<DoctorDetail>(`/professionals/${id}`),
};
