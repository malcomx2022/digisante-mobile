// ─────────────────────────────────────────────────────────────
// Service Twilio — envoi OTP par SMS ou appel vocal.
// Config résolue DYNAMIQUEMENT via le resolver d'intégrations (base chiffrée →
// fallback `.env`, §3.6) : STUB tant qu'aucune config complète n'existe.
// Piège Bénin (CLAUDE.md §8) : sender ID alphanumérique non garanti chez tous
// les opérateurs → on envoie depuis le numéro long TWILIO_FROM_NUMBER.
// ─────────────────────────────────────────────────────────────
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import { resolveConfiguredSecrets } from '@/lib/integrations.js';

export type OtpChannel = 'SMS' | 'VOICE';

interface TwilioCreds {
  sid: string;
  token: string;
  from: string;
}

/**
 * POST bas niveau à l'API REST Twilio (auth basique ACCOUNT_SID/AUTH_TOKEN).
 * Renvoie true si l'API a accepté (2xx). Ne throw pas : log + false sinon.
 */
async function twilioPost(
  creds: TwilioCreds,
  resource: 'Messages' | 'Calls',
  params: Record<string, string>,
  log: FastifyBaseLogger,
): Promise<boolean> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/${resource}.json`;
  const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString('base64');
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

/** Résout les identifiants Twilio (base → `.env`) ou null si config incomplète. */
async function resolveCreds(app: FastifyInstance): Promise<TwilioCreds | null> {
  const secrets = await resolveConfiguredSecrets(app, 'TWILIO');
  if (!secrets) return null;
  return { sid: secrets.accountSid!, token: secrets.authToken!, from: secrets.fromNumber! };
}

export interface SendOtpOptions {
  app: FastifyInstance;
  to: string;
  code: string;
  channel: OtpChannel;
  /** Langue du destinataire (les messages partent dans sa langue — CLAUDE.md §4). */
  lang: string;
}

/** Envoie un OTP. En l'absence de configuration Twilio, fonctionne en stub. */
export async function sendOtp(opts: SendOtpOptions): Promise<{ delivered: boolean; stub: boolean }> {
  const log = opts.app.log;
  const creds = await resolveCreds(opts.app);
  if (!creds) {
    log.warn(
      { to: opts.to, channel: opts.channel, lang: opts.lang },
      `[STUB Twilio] OTP ${opts.code} (Twilio non configuré — aucun envoi réel)`,
    );
    return { delivered: false, stub: true };
  }

  // Appel réel : SMS via Messages, voix via Calls (TwiML inline lisant le code).
  let ok: boolean;
  if (opts.channel === 'VOICE') {
    const twiml = `<Response><Say>${opts.code.split('').join(' ')}</Say></Response>`;
    ok = await twilioPost(creds, 'Calls', { To: opts.to, From: creds.from, Twiml: twiml }, log);
  } else {
    ok = await twilioPost(creds, 'Messages', { To: opts.to, From: creds.from, Body: `DigiSanté: ${opts.code}` }, log);
  }
  if (ok) log.info({ to: opts.to, channel: opts.channel, lang: opts.lang }, 'OTP envoyé via Twilio');
  return { delivered: ok, stub: false };
}

/** Envoie un SMS transactionnel (stub si Twilio non configuré). */
export async function sendSms(opts: {
  app: FastifyInstance;
  to: string;
  body: string;
  lang: string;
}): Promise<{ delivered: boolean; stub: boolean }> {
  const log = opts.app.log;
  const creds = await resolveCreds(opts.app);
  if (!creds) {
    log.warn({ to: opts.to, lang: opts.lang }, `[STUB Twilio SMS] ${opts.body}`);
    return { delivered: false, stub: true };
  }
  // POST Twilio Messages. Sender ID alphanumérique non garanti au Bénin
  // → on utilise le numéro long from (CLAUDE.md §8).
  const ok = await twilioPost(creds, 'Messages', { To: opts.to, From: creds.from, Body: opts.body }, log);
  if (ok) log.info({ to: opts.to, lang: opts.lang }, 'SMS envoyé via Twilio');
  return { delivered: ok, stub: false };
}
