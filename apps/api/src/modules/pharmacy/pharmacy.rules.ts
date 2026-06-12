// ─────────────────────────────────────────────────────────────
// Règles pures de délivrance (testables).
// ─────────────────────────────────────────────────────────────
import type { PrescriptionItemStatus, PrescriptionStatus } from '@digisante/shared';

/** Statut global de l'ordonnance déduit des statuts de ses lignes. */
export function computeDispenseStatus(itemStatuses: PrescriptionItemStatus[]): PrescriptionStatus {
  if (itemStatuses.length > 0 && itemStatuses.every((s) => s === 'DISPENSED')) {
    return 'FULLY_DISPENSED';
  }
  if (itemStatuses.some((s) => s === 'DISPENSED' || s === 'PARTIALLY_DISPENSED')) {
    return 'PARTIALLY_DISPENSED';
  }
  return 'ACTIVE';
}
