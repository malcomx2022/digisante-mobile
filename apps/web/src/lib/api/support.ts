// Admin : console Support / OTP (lookup compte, verrou, activité, notes). §4 : aucun médical.
import { get, post } from './client';

export interface SupportNote {
  id: string;
  userId: string;
  authorId: string;
  body: string;
  createdAt: string;
}
export interface SupportActivity {
  id: string;
  action: string;
  ip: string | null;
  createdAt: string;
}
export interface SupportAccount {
  user: {
    id: string;
    phone: string;
    email?: string | null;
    role: string;
    status: string;
    lang?: string | null;
    createdAt: string;
    profile: { firstName: string; lastName: string } | null;
  };
  lockout: { locked: boolean; attempts: number };
  notes: SupportNote[];
  activity: SupportActivity[];
}

export const supportApi = {
  account: (id: string) => get<SupportAccount>(`/admin/support/account/${id}`),
  unlock: (id: string) => post<{ unlocked: boolean }>(`/admin/support/account/${id}/unlock`),
  addNote: (id: string, body: string) => post<SupportNote>(`/admin/support/account/${id}/notes`, { body }),
};
