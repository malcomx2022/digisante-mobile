// ─────────────────────────────────────────────────────────────
// Internationalisation — structure des clés et métadonnées de langues.
// 4 langues — FR · EN · FON · YOR (CLAUDE.md §1/§8, alignées sur l'enum Lang du schéma Prisma).
// Règle d'or : AUCUNE chaîne d'UI en dur ailleurs que dans les fichiers
// de traduction. Les clés suivent le format `namespace.key`.
// ─────────────────────────────────────────────────────────────
import type { Lang } from './enums.js';

// (supprimés en août 2026, lot 11) `NAMESPACES`, `Namespace`, `CRITICAL_NAMESPACES`,
// `CriticalNamespace` et `tKey` vivaient ici pour le module API `translations`, lui-même
// supprimé faute de consommateur. `NAMESPACES` était de surcroît PÉRIMÉ : il listait
// 18 namespaces alors que l'UI utilise un dictionnaire PLAT (`apps/web/src/i18n/messages.ts`)
// dont les préfixes réels sont bien plus nombreux (teleconsult., referrals., edureview.,
// triage., maternity., campaigns., integrations.…).
//
// ⚠️ La règle §6 des namespaces CRITIQUES (`sos.` / `labo.` / `payments.` = double
// validation) n'est pas perdue : elle est appliquée par `scripts/i18n/check-coverage.mjs`,
// qui en est désormais la SEULE définition (il marque ces clés `CRITIQUE` dans les CSV de
// relecture). Ne pas réintroduire une seconde liste ici : deux définitions divergent.

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
