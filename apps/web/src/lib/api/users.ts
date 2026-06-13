// Profil utilisateur courant (module users backend) — formulaire profil/paramètres.
import type { Lang, Role } from '@digisante/shared';

import { get, patch } from './client';

export interface UserProfile {
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
  gender?: string | null;
  address?: string | null;
  emergencyContact?: string | null;
  avatarUrl?: string | null;
  spokenLangs?: Lang[] | null;
}

export interface MeFull {
  id: string;
  phone: string;
  email: string | null;
  role: Role;
  status: string;
  lang: Lang;
  profile: UserProfile | null;
  patient?: { id: string; bloodGroup: string | null } | null;
  doctor?: { id: string; speciality: string | null; verifiedAt: string | null } | null;
}

/** Champs acceptés par PATCH /users/me. */
export interface UpdateMeBody {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: string;
  emergencyContact?: string;
  avatarUrl?: string;
  spokenLangs?: Lang[];
  lang?: Lang;
}

/** Lève si la mutation a été mise en file hors-ligne (le profil exige le réseau). */
function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

export const usersApi = {
  me: () => get<MeFull>('/users/me'),
  update: (body: UpdateMeBody) => patch<MeFull>('/users/me', body).then(online),
};
