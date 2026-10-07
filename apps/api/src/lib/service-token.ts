// ─────────────────────────────────────────────────────────────
// Jeton de service des tâches internes (cron : générateurs, dispatch). Comparaison
// en TEMPS CONSTANT ; refus si le jeton n'est pas configuré (fail-closed).
// Réutilisé aussi par la réconciliation FedaPay (revue §5 L8).
// ─────────────────────────────────────────────────────────────
import { createHash, timingSafeEqual } from 'node:crypto';

import { env } from './env.js';

/** Vrai si `provided` égale le jeton de service configuré (temps constant). */
export function isValidServiceToken(provided: unknown, expected: string | undefined = env.RECONCILE_TOKEN): boolean {
  if (!expected || typeof provided !== 'string' || provided.length === 0) return false;
  // Empreintes de longueur fixe : timingSafeEqual exige des tailles égales.
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
