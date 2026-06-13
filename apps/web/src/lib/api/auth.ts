// Appels API d'authentification typés (consomment le module auth backend P2.2).
import type { Lang, Role } from '@digisante/shared';

import { api, get, post } from './client';

export interface AuthUser {
  id: string;
  phone: string;
  email: string | null;
  role: Role;
  status: string;
  lang: Lang;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface OtpInfo {
  channel: string;
  expiresInSec: number;
  devCode?: string;
}

/** Lève si la requête a été mise en file hors-ligne (l'auth exige le réseau). */
function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

/** Corps d'inscription : base + champs spécifiques par rôle (optionnels). */
export interface RegisterBody {
  phone: string;
  email?: string;
  role: Role;
  lang: Lang;
  firstName: string;
  lastName: string;
  // Médecin
  speciality?: string;
  licenseNumber?: string;
  consultFee?: number;
  // Pharmacie / Laboratoire
  establishmentName?: string;
  address?: string;
}

export const authApi = {
  register: (body: RegisterBody) =>
    api.post<{ user: AuthUser; otp: OtpInfo }>('/auth/register', body).then(online),
  requestOtp: (body: { phone: string; channel?: 'SMS' | 'VOICE' }) =>
    api.post<OtpInfo>('/auth/otp/request', body).then(online),
  verifyOtp: (body: { phone: string; code: string }) =>
    api.post<{ user: AuthUser } & AuthTokens>('/auth/otp/verify', body).then(online),
  refresh: (body: { refreshToken: string }) => api.post<AuthTokens>('/auth/refresh', body).then(online),
  me: () => get<AuthUser & { profile?: { firstName: string; lastName: string } | null }>('/auth/me'),
  /** Révocation côté serveur du refresh token (best-effort avant purge locale). */
  logout: (body: { refreshToken: string }) => post<void>('/auth/logout', body),
  /** Enregistre le token push FCM de l'appareil courant. */
  registerDevice: (body: { fcmToken: string }) => post<unknown>('/users/me/device', body),
};
