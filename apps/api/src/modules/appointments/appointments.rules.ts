// ─────────────────────────────────────────────────────────────
// Règles pures de réservation (testables sans I/O).
// ─────────────────────────────────────────────────────────────

/** Deux créneaux [start, start+durée) se chevauchent-ils ? (millisecondes) */
export function overlaps(aStartMs: number, aDurationMin: number, bStartMs: number, bDurationMin: number): boolean {
  const aEnd = aStartMs + aDurationMin * 60_000;
  const bEnd = bStartMs + bDurationMin * 60_000;
  return aStartMs < bEnd && bStartMs < aEnd;
}

/** Un RDV ne peut être posé que dans le futur. */
export function isFuture(scheduledAtMs: number, nowMs: number): boolean {
  return scheduledAtMs > nowMs;
}

// Bénin (Africa/Porto-Novo) : UTC+1 toute l'année, sans heure d'été.
export const BENIN_UTC_OFFSET_MIN = 60;
// Plage d'ouverture par défaut (aucun modèle de disponibilités médecin en v1) :
// identique à celle que proposait l'écran de réservation (8 h – 17 h, heure locale).
export const DEFAULT_OPEN_MIN = 8 * 60;
export const DEFAULT_CLOSE_MIN = 17 * 60;

/** Début (UTC, ms) du jour local béninois AAAA-MM-JJ, ou null si la date est invalide. */
export function beninDayStartMs(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const check = new Date(utc);
  if (check.getUTCFullYear() !== Number(m[1]) || check.getUTCMonth() !== Number(m[2]) - 1 || check.getUTCDate() !== Number(m[3])) return null;
  return utc - BENIN_UTC_OFFSET_MIN * 60_000;
}

/**
 * Créneaux LIBRES d'une journée : pas de `slotDuration` minutes entre ouverture
 * et fermeture (le créneau doit finir avant la fermeture), futurs, et sans
 * chevauchement avec un RDV actif (même règle `overlaps` que la réservation).
 */
export function freeSlots(opts: {
  dayStartMs: number;
  slotDurationMin: number;
  busyStartsMs: number[];
  nowMs: number;
  openMin?: number;
  closeMin?: number;
}): number[] {
  const open = opts.openMin ?? DEFAULT_OPEN_MIN;
  const close = opts.closeMin ?? DEFAULT_CLOSE_MIN;
  const step = opts.slotDurationMin;
  if (!Number.isInteger(step) || step <= 0) return [];
  const slots: number[] = [];
  for (let min = open; min + step <= close; min += step) {
    const start = opts.dayStartMs + min * 60_000;
    if (!isFuture(start, opts.nowMs)) continue;
    if (opts.busyStartsMs.some((b) => overlaps(start, step, b, step))) continue;
    slots.push(start);
  }
  return slots;
}

/** Une consultation présentielle se clôt après son début, jamais à l'avance. */
export function hasStarted(scheduledAtMs: number, nowMs: number): boolean {
  return scheduledAtMs <= nowMs;
}
