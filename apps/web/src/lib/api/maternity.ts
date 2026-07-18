// Patiente : suivi de grossesse + consultations prénatales (CPN).
import { get, post } from './client';

export interface AntenatalVisit {
  id: string;
  contactNumber: number;
  dueDate: string;
  doneAt: string | null;
}
export interface Pregnancy {
  id: string;
  lmpDate: string;
  dueDate: string;
  endedAt: string | null;
  visits: AntenatalVisit[];
}

export const maternityApi = {
  getActive: () => get<Pregnancy | null>('/maternity'),
  start: (lmpDate: string) => post<Pregnancy>('/maternity', { lmpDate }),
  end: () => post<{ ended: boolean }>('/maternity/end'),
  setVisitDone: (id: string, done: boolean) => post<{ id: string; doneAt: string | null }>(`/maternity/visits/${id}/done`, { done }),
};
