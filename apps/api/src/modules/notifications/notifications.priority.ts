// ─────────────────────────────────────────────────────────────
// Priorité de dispatch (pur, testable). SOS et alertes critiques d'abord.
// ─────────────────────────────────────────────────────────────
import type { NotificationType } from '@digisante/shared';

/** Plus le poids est élevé, plus la notification est prioritaire. */
const PRIORITY: Record<NotificationType, number> = {
  SOS_ALERT: 100,
  LAB_RESULT: 90,
  CONSULTATION_START: 70,
  PAYMENT_CONFIRMED: 50,
  PRESCRIPTION_READY: 40,
  APPOINTMENT_REMINDER: 30,
  SYSTEM: 10,
};

export function priorityOf(type: NotificationType): number {
  return PRIORITY[type] ?? 0;
}

/** Trie des notifications par priorité décroissante (SOS en tête). */
export function sortByPriority<T extends { type: NotificationType }>(items: T[]): T[] {
  return [...items].sort((a, b) => priorityOf(b.type) - priorityOf(a.type));
}
