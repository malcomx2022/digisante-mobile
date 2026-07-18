// Patient : carnet de vaccination PEV (soi + proches) + marquage des doses.
import { del, get, post } from './client';

export type VaccinationStatus = 'SCHEDULED' | 'DONE';

export interface Vaccination {
  id: string;
  vaccineCode: string;
  doseLabel: string;
  dueDate: string;
  administeredAt: string | null;
  status: VaccinationStatus;
}
export interface VaccinationSubject {
  id: string;
  name: string;
  birthDate: string;
  isSelf: boolean;
  vaccinations: Vaccination[];
}

export const vaccinationsApi = {
  list: () => get<VaccinationSubject[]>('/vaccinations'),
  addSubject: (body: { name: string; birthDate: string; isSelf: boolean }) =>
    post<VaccinationSubject>('/vaccinations/subjects', body),
  removeSubject: (id: string) => del<{ removed: boolean }>(`/vaccinations/subjects/${id}`),
  setAdministered: (id: string, done: boolean) =>
    post<{ id: string; status: VaccinationStatus; administeredAt: string | null }>(`/vaccinations/${id}/administered`, { done }),
};
