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
  // Agent de santé communautaire
  zone?: string;
}

export const authApi = {
  register: (body: RegisterBody) =>
    api.postNow<{ user?: AuthUser; otp: OtpInfo }>('/auth/register', body).then(online),
  requestOtp: (body: { phone: string; channel?: 'SMS' | 'VOICE' }) =>
    api.postNow<OtpInfo>('/auth/otp/request', body).then(online),
  // Le refresh token n'est plus dans le corps : il est posé en cookie HttpOnly (C6).
  verifyOtp: (body: { phone: string; code: string }) =>
    api.postNow<{ user: AuthUser; accessToken: string }>('/auth/otp/verify', body).then(online),
  // Rotation via le cookie HttpOnly (aucun corps) → { accessToken, user }.
  refresh: () => api.postNow<{ accessToken: string; user: AuthUser }>('/auth/refresh').then(online),
  me: () => get<AuthUser & { profile?: { firstName: string; lastName: string } | null }>('/auth/me'),
  /** Révocation côté serveur du refresh (cookie) — best-effort avant purge locale. */
  logout: () => post<void>('/auth/logout'),
  /** Enregistre le token push FCM de l'appareil courant. */
  registerDevice: (body: { fcmToken: string }) => post<unknown>('/users/me/device', body),
};
