// Types, enums et schémas zod partagés entre web et api.
export const LANGUAGES = ['FR', 'FON', 'YO', 'BAATONUM', 'DENDI'] as const;
export type Language = (typeof LANGUAGES)[number];

export const USER_ROLES = [
  'PATIENT',
  'MEDECIN',
  'PHARMACIE',
  'LABORATOIRE',
  'DIASPORA',
  'ADMIN',
] as const;
export type UserRole = (typeof USER_ROLES)[number];
