// ─────────────────────────────────────────────────────────────
// Formats de dates / heures / nombres dans la LANGUE COURANTE de l'interface.
// Remplace les `toLocaleDateString('fr-FR')` codés en dur (les dates restaient
// françaises en mode EN/FON/YOR). La langue est synchronisée par le
// LocaleProvider (singleton module : les composants re-rendent déjà via le
// contexte au changement de langue, le helper lit donc toujours la valeur à
// jour au moment du rendu). Offline-first : Intl natif, zéro dépendance.
// ─────────────────────────────────────────────────────────────
import { DEFAULT_LANG, type Lang } from '@digisante/shared';

// Lang applicative → locales BCP-47 (avec repli : le fon n'a pas de données
// CLDR répandues → fr-FR ; le yorùbá tente yo-NG puis retombe sur fr-FR).
const BCP47: Record<Lang, string[]> = {
  FR: ['fr-FR'],
  EN: ['en-GB', 'fr-FR'],
  FON: ['fr-FR'],
  YOR: ['yo-NG', 'fr-FR'],
};

let currentLang: Lang = DEFAULT_LANG;

/** Synchronisé par le LocaleProvider — ne pas appeler ailleurs. */
export function setFormatLang(lang: Lang): void {
  currentLang = lang;
}

const locales = () => BCP47[currentLang] ?? BCP47[DEFAULT_LANG];
const toDate = (v: Date | string | number) => (v instanceof Date ? v : new Date(v));

/** Date seule (ex. 12/05/2026 · 5/12/2026 en EN). */
export function formatDate(v: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  return toDate(v).toLocaleDateString(locales(), opts);
}

/** Date + heure (par défaut : dateStyle/timeStyle du site d'appel). */
export function formatDateTime(v: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  return toDate(v).toLocaleString(locales(), opts);
}

/** Heure seule. */
export function formatTime(v: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  return toDate(v).toLocaleTimeString(locales(), opts);
}

/** Nombre (montants XOF, compteurs) — séparateurs de milliers localisés. */
export function formatNumber(v: number | string, opts?: Intl.NumberFormatOptions): string {
  return Number(v).toLocaleString(locales(), opts);
}
