// Centre de notifications de l'utilisateur courant.
import { get, post } from './client';

export interface AppNotification {
  id: string;
  type: string;
  channel: string;
  title: string;
  body: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationsApi = {
  list: () => get<AppNotification[]>('/notifications'),
  markRead: (id: string) => post<unknown>(`/notifications/${id}/read`),
};
