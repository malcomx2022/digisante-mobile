// ─────────────────────────────────────────────────────────────
// Service Twilio — envoi OTP par SMS ou appel vocal.
// STUB tant que les clés ne sont pas configurées (dev/local) : on journalise
// au lieu d'envoyer. L'intégration réelle est branchée en P4.2 (notifications).
// Piège Bénin (CLAUDE.md §8) : sender ID alphanumérique non garanti chez tous
// les opérateurs → prévoir le fallback numéro long lors de l'implémentation réelle.
// ─────────────────────────────────────────────────────────────
import type { FastifyBaseLogger } from 'fastify';

import { env, isTwilioConfigured } from '@/lib/env.js';

export type OtpChannel = 'SMS' | 'VOICE';

/**
 * POST bas niveau à l'API REST Twilio (auth basique ACCOUNT_SID/AUTH_TOKEN).
 * Renvoie true si l'API a accepté (2xx). Ne throw pas : log + false sinon.
 */
async function twilioPost(
  resource: 'Messages' | 'Calls',
  params: Record<string, string>,
  log: FastifyBaseLogger,
): Promise<boolean> {
  const sid = env.TWILIO_ACCOUNT_SID!;
  const token = env.TWILIO_AUTH_TOKEN!;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/${resource}.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      log.error({ status: res.status, detail }, `[Twilio] ${resource} en échec`);
      return false;
    }
    return true;
  } catch (err) {
    // Erreur réseau : on ne crashe jamais l'appelant (CLAUDE.md §4, l'urgence prime).
    log.error({ err }, `[Twilio] erreur réseau ${resource}`);
    return false;
  }
}

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

  // Appel réel : SMS via Messages, voix via Calls (TwiML inline lisant le code).
  let ok: boolean;
  if (opts.channel === 'VOICE') {
    const twiml = `<Response><Say>${opts.code.split('').join(' ')}</Say></Response>`;
    ok = await twilioPost(
      'Calls',
      { To: opts.to, From: env.TWILIO_FROM_NUMBER!, Twiml: twiml },
      opts.log,
    );
  } else {
    ok = await twilioPost(
      'Messages',
      { To: opts.to, From: env.TWILIO_FROM_NUMBER!, Body: `DigiSanté: ${opts.code}` },
      opts.log,
    );
  }
  if (ok) opts.log.info({ to: opts.to, channel: opts.channel, lang: opts.lang }, 'OTP envoyé via Twilio');
  return { delivered: ok, stub: false };
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
  // POST Twilio Messages. Sender ID alphanumérique non garanti au Bénin
  // → on utilise le numéro long TWILIO_FROM_NUMBER (CLAUDE.md §8).
  const ok = await twilioPost(
    'Messages',
    { To: opts.to, From: env.TWILIO_FROM_NUMBER!, Body: opts.body },
    opts.log,
  );
  if (ok) opts.log.info({ to: opts.to, lang: opts.lang }, 'SMS envoyé via Twilio');
  return { delivered: ok, stub: false };
}
