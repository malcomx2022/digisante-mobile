// ─────────────────────────────────────────────────────────────
// Gouvernance des traductions i18n (pur, testable).
// Les namespaces critiques (sos/labo/payments) exigent une DOUBLE validation
// (au moins 2 valideurs distincts) avant publication — cf. CLAUDE.md §6 / DT-3.
// Les fichiers de traduction d'UI eux-mêmes vivent côté frontend (P5.2).
// ─────────────────────────────────────────────────────────────
import { CRITICAL_NAMESPACES, type Namespace } from '@digisante/shared';

/** Le namespace est-il critique (double validation requise) ? */
export function isCriticalNamespace(ns: string): boolean {
  return (CRITICAL_NAMESPACES as readonly string[]).includes(ns);
}

/** Nombre de validations requises pour un namespace. */
export function requiredValidations(ns: Namespace | string): number {
  return isCriticalNamespace(ns) ? 2 : 1;
}

/** Une clé est-elle approuvée compte tenu de ses valideurs (distincts) ? */
export function isTranslationApproved(ns: Namespace | string, validators: string[]): boolean {
  return new Set(validators.filter(Boolean)).size >= requiredValidations(ns);
}
