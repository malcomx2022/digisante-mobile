// Messagerie patient ↔ médecin (module chat backend).
import { get, post } from './client';

export interface ChatCounterpart {
  role: 'PATIENT' | 'MEDECIN';
  name: string;
  speciality?: string;
}

export interface ChatThread {
  id: string;
  lastMessageAt: string | null;
  counterpart: ChatCounterpart;
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  body: string;
  mine: boolean;
  readAt: string | null;
  createdAt: string;
}

/** Lève si la mutation a été mise en file hors-ligne (action exigeant le réseau). */
function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

export const chatApi = {
  listThreads: () => get<ChatThread[]>('/chat/threads'),
  /** counterpartId = id Doctor (côté patient) ou id Patient (côté médecin). */
  openThread: (counterpartId: string) =>
    post<ChatThread>('/chat/threads', { counterpartId }).then(online),
  listMessages: (threadId: string) => get<ChatMessage[]>(`/chat/threads/${threadId}/messages`),
  /** Envoi : hors-ligne → mis en file (retourne { queued: true }), rejoué au retour réseau. */
  sendMessage: (threadId: string, body: string) =>
    post<ChatMessage>(`/chat/threads/${threadId}/messages`, { body }),
  markRead: (threadId: string) => post<{ updated: number }>(`/chat/threads/${threadId}/read`),
};
