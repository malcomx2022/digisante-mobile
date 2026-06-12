// ─────────────────────────────────────────────────────────────
// Règles pures de téléconsultation (testables).
// Bascule réseau faible : VIDEO → AUDIO → CHAT (jamais en arrière).
// ─────────────────────────────────────────────────────────────
import type { ConsultationMode } from '@digisante/shared';

export const MODE_CHAIN: readonly ConsultationMode[] = ['VIDEO', 'AUDIO', 'CHAT'];

/** Mode dégradé suivant (s'arrête à CHAT). */
export function nextMode(current: ConsultationMode): ConsultationMode {
  const i = MODE_CHAIN.indexOf(current);
  return i >= 0 && i < MODE_CHAIN.length - 1 ? MODE_CHAIN[i + 1]! : 'CHAT';
}
