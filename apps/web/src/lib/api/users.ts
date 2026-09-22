// Profil utilisateur courant (module users backend) — formulaire profil/paramètres.
import type { Lang, Role } from '@digisante/shared';

import { get, patchNow } from './client';

/** Fiche médicale d'urgence du patient (vitale pour le SOS). */
export interface MedicalInfo {
  bloodGroup: string | null;
  allergies: string[];
  chronicDiseases: string[];
  insuranceNumber: string | null;
  emergencyContact: string | null;
}

export interface UpdateMedicalBody {
  bloodGroup?: string;
  allergies?: string[];
  chronicDiseases?: string[];
  insuranceNumber?: string;
  emergencyContact?: string;
}

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
  doctor?: {
    id: string;
    speciality: string | null;
    verifiedAt: string | null;
    /** Decimal Prisma → sérialisé en chaîne. */
    consultFee?: string | number | null;
    slotDuration?: number | null;
    bio?: string | null;
  } | null;
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
  update: (body: UpdateMeBody) => patchNow<MeFull>('/users/me', body).then(online),
  medical: () => get<MedicalInfo>('/users/me/medical'),
  updateMedical: (body: UpdateMedicalBody) => patchNow<MedicalInfo>('/users/me/medical', body).then(online),
};
