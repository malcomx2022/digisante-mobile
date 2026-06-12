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
