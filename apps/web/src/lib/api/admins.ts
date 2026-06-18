// Admin : gestion des administrateurs (RBAC — profilage par scopes).
import type { AdminPreset, AdminScope } from '@digisante/shared';

import { get, patch, post } from './client';

export interface AdminProfileItem {
  id: string;
  scopes: string[];
  preset: string | null;
  suspendedAt: string | null;
  createdAt: string;
  user: { id: string; phone: string; status: string; profile: { firstName: string; lastName: string } | null };
}
interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const adminsApi = {
  /** Scopes de l'admin courant (pour le gating de la navigation). */
  me: () => get<{ scopes: AdminScope[]; suspended: boolean }>('/admin/me'),
  list: (page = 1, pageSize = 20) => get<Paginated<AdminProfileItem>>(`/admin/admins?page=${page}&pageSize=${pageSize}`),
  create: (phone: string, preset: AdminPreset) => post<AdminProfileItem>('/admin/admins', { phone, preset }),
  update: (id: string, body: { preset?: AdminPreset; scopes?: AdminScope[] }) => patch<AdminProfileItem>(`/admin/admins/${id}`, body),
  suspend: (id: string) => post<AdminProfileItem>(`/admin/admins/${id}/suspend`),
  activate: (id: string) => post<AdminProfileItem>(`/admin/admins/${id}/activate`),
};
