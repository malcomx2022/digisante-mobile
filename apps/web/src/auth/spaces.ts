import type { Role } from '@digisante/shared';

/** Chaque rôle est redirigé vers son espace dédié (thème distinct). */
export const SPACE_PATH: Record<Role, string> = {
  PATIENT: '/patient',
  MEDECIN: '/pro',
  PHARMACIE: '/pharmacie',
  LABORATOIRE: '/labo',
  DIASPORA: '/diaspora',
  ADMIN: '/admin',
};

export function spaceFor(role: Role): string {
  return SPACE_PATH[role] ?? '/patient';
}
