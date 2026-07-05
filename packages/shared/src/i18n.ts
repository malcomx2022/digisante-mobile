// ─────────────────────────────────────────────────────────────
// Internationalisation — structure des clés et métadonnées de langues.
// 4 langues — FR · EN · FON · YOR (CLAUDE.md §1/§8, alignées sur l'enum Lang du schéma Prisma).
// Règle d'or : AUCUNE chaîne d'UI en dur ailleurs que dans les fichiers
// de traduction. Les clés suivent le format `namespace.key`.
// ─────────────────────────────────────────────────────────────
import type { Lang } from './enums.js';

/** Namespaces i18n. Un fichier de traduction par namespace et par langue. */
export const NAMESPACES = [
  'common',
  'onboarding',
  'auth',
  'dashboard',
  'profile',
  'dmp',
  'appointments',
  'consultation',
  'prescriptions',
  'pharmacy',
  'labo',
  'payments',
  'wallet',
  'sos',
  'notifications',
  'education',
  'admin',
  'errors',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

/**
 * Namespaces à DOUBLE VALIDATION des clés critiques (cf. CLAUDE.md §6, vue DT-3) :
 * une erreur de traduction y est potentiellement dangereuse (urgence, résultats,
 * argent). Toute clé de ces namespaces doit être relue par un second valideur.
 */
export const CRITICAL_NAMESPACES = ['sos', 'labo', 'payments'] as const;
export type CriticalNamespace = (typeof CRITICAL_NAMESPACES)[number];

/** Langue par défaut de l'application. */
export const DEFAULT_LANG: Lang = 'FR';

export interface LanguageMeta {
  /** Code de l'enum Lang. */
  code: Lang;
  /** Nom de la langue en français (pour les listes administratives). */
  name: string;
  /** Endonyme (nom de la langue dans la langue elle-même). */
  nativeName: string;
  /** Sens d'écriture. */
  dir: 'ltr' | 'rtl';
  /** Contenus audio disponibles (oralité — ex. Fɔ̀ngbè, cf. CLAUDE.md §5). */
  hasAudio: boolean;
}

/**
 * Métadonnées des langues pour le sélecteur (pill `FR ▾`) et l'admin.
 * Les libellés d'interface eux-mêmes restent dans les fichiers de traduction ;
 * ici on ne stocke que des noms propres de langues (endonymes), non traduisibles.
 */
export const LANGUAGE_META: Record<Lang, LanguageMeta> = {
  FR: { code: 'FR', name: 'Français', nativeName: 'Français', dir: 'ltr', hasAudio: false },
  EN: { code: 'EN', name: 'Anglais', nativeName: 'English', dir: 'ltr', hasAudio: false },
  FON: { code: 'FON', name: 'Fon', nativeName: 'Fɔ̀ngbè', dir: 'ltr', hasAudio: true },
  YOR: { code: 'YOR', name: 'Yoruba', nativeName: 'Yorùbá', dir: 'ltr', hasAudio: false },
};

/** Liste ordonnée des langues pour l'affichage du sélecteur. */
export const LANGUAGE_LIST: readonly LanguageMeta[] = Object.values(LANGUAGE_META);

/** Construit une clé i18n typée `namespace.key`. */
export function tKey(namespace: Namespace, key: string): string {
  return `${namespace}.${key}`;
}
