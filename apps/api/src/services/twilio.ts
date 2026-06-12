// ─────────────────────────────────────────────────────────────
// Service Twilio — envoi OTP par SMS ou appel vocal.
// STUB tant que les clés ne sont pas configurées (dev/local) : on journalise
// au lieu d'envoyer. L'intégration réelle est branchée en P4.2 (notifications).
// Piège Bénin (CLAUDE.md §8) : sender ID alphanumérique non garanti chez tous
// les opérateurs → prévoir le fallback numéro long lors de l'implémentation réelle.
// ─────────────────────────────────────────────────────────────
import type { FastifyBaseLogger } from 'fastify';

import { isTwilioConfigured } from '@/lib/env.js';

export type OtpChannel = 'SMS' | 'VOICE';

export interface SendOtpOptions {
  to: string;
  code: string;
  channel: OtpChannel;
  /** Langue du destinataire (les messages partent dans sa langue — CLAUDE.md §4). */
  lang: string;
  log: FastifyBaseLogger;
}

/** Envoie un OTP. En l'absence de configuration Twilio, fonctionne en stub. */
export async function sendOtp(opts: SendOtpOptions): Promise<{ delivered: boolean; stub: boolean }> {
  if (!isTwilioConfigured) {
    opts.log.warn(
      { to: opts.to, channel: opts.channel, lang: opts.lang },
      `[STUB Twilio] OTP ${opts.code} (Twilio non configuré — aucun envoi réel)`,
    );
    return { delivered: false, stub: true };
  }

  // TODO : appel réel à l'API Twilio (SMS via Messages, voix via Calls/TwiML),
  // gabarit dans la langue du destinataire, fallback numéro long.
  opts.log.info({ to: opts.to, channel: opts.channel, lang: opts.lang }, 'OTP envoyé via Twilio');
  return { delivered: true, stub: false };
}

/** Envoie un SMS transactionnel (stub si Twilio non configuré). */
export async function sendSms(opts: {
  to: string;
  body: string;
  lang: string;
  log: FastifyBaseLogger;
}): Promise<{ delivered: boolean; stub: boolean }> {
  if (!isTwilioConfigured) {
    opts.log.warn({ to: opts.to, lang: opts.lang }, `[STUB Twilio SMS] ${opts.body}`);
    return { delivered: false, stub: true };
  }
  // TODO : POST Twilio Messages. Sender ID alphanumérique non garanti au Bénin
  // → fallback numéro long (CLAUDE.md §8).
  opts.log.info({ to: opts.to, lang: opts.lang }, 'SMS envoyé via Twilio');
  return { delivered: true, stub: false };
}
