// ─────────────────────────────────────────────────────────────
// SOS — doit fonctionner HORS-LIGNE (CLAUDE.md §3/§4). En ligne : appel API.
// Hors-ligne : repli SMS direct vers le numéro d'urgence (lien sms:).
// ─────────────────────────────────────────────────────────────
import { isOnline } from '@/lib/offline/online';

/** Numéro d'urgence (à configurer via NEXT_PUBLIC_SOS_NUMBER). */
export const SOS_NUMBER = process.env.NEXT_PUBLIC_SOS_NUMBER ?? '+22900000000';

/** Construit un lien SMS pré-rempli (repli hors-ligne). */
export function buildSosSmsLink(opts: { latitude?: number; longitude?: number; message?: string } = {}): string {
  const parts = [opts.message ?? 'URGENCE DigiSanté — besoin d’aide.'];
  if (opts.latitude != null && opts.longitude != null) {
    parts.push(`Position: ${opts.latitude.toFixed(5)},${opts.longitude.toFixed(5)}`);
  }
  const body = encodeURIComponent(parts.join(' '));
  return `sms:${SOS_NUMBER}?body=${body}`;
}

/** Indique le canal SOS à utiliser selon l'état réseau. */
export function sosChannel(): 'API' | 'SMS' {
  return isOnline() ? 'API' : 'SMS';
}
