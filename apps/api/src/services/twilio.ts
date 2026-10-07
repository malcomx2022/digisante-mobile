// ─────────────────────────────────────────────────────────────
// Service Twilio — envoi OTP par SMS ou appel vocal.
// Config résolue DYNAMIQUEMENT via le resolver d'intégrations (base chiffrée →
// fallback `.env`, §3.6) : STUB tant qu'aucune config complète n'existe.
// Piège Bénin (CLAUDE.md §8) : sender ID alphanumérique non garanti chez tous
// les opérateurs → on envoie depuis le numéro long TWILIO_FROM_NUMBER.
// ─────────────────────────────────────────────────────────────
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import { resolveConfiguredSecrets } from '@/lib/integrations.js';
import { maskId, maskPhone, stubContent } from '@/lib/redact.js';

export type OtpChannel = 'SMS' | 'VOICE';

export interface TwilioCreds {
  sid: string;
  token: string;
  from: string;
}

/**
 * POST bas niveau à l'API REST Twilio (auth basique ACCOUNT_SID/AUTH_TOKEN).
 * Renvoie `{ ok, sid }` (sid = identifiant du message/appel si 2xx). Ne throw pas.
 * Journalisation : jamais le numéro complet ni le corps — l'erreur Twilio est réduite
 * à son `code` + `more_info` (son `message` peut citer le numéro destinataire).
 */
export async function twilioPost(
  creds: TwilioCreds,
  resource: 'Messages' | 'Calls',
  params: Record<string, string>,
  log: FastifyBaseLogger,
): Promise<{ ok: boolean; sid?: string }> {
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
    const data = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; more_info?: string };
    if (!res.ok) {
      log.error({ status: res.status, ...(typeof data.code === 'number' && Number.isSafeInteger(data.code) ? { twilioCode: data.code } : {}), to: maskPhone(params.To) }, `[Twilio] ${resource} en échec`);
      return { ok: false };
    }
    return { ok: true, sid: data.sid };
  } catch {
    // Erreur réseau : on ne crashe jamais l'appelant (CLAUDE.md §4, l'urgence prime).
    log.error({ operation: resource }, '[Twilio] erreur réseau');
    return { ok: false };
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
export async function sendOtp(opts: SendOtpOptions): Promise<{ delivered: boolean; stub: boolean; sid?: string }> {
  const log = opts.app.log;
  const creds = await resolveCreds(opts.app);
  if (!creds) {
    // Code lisible en test seulement : en production, un stub = Twilio non
    // configuré, et un code OTP dans les journaux permettrait de prendre le compte.
    log.warn(
      { to: maskPhone(opts.to), channel: opts.channel, lang: opts.lang },
      `[STUB Twilio] OTP ${stubContent(opts.code)} (Twilio non configuré — aucun envoi réel)`,
    );
    return { delivered: false, stub: true };
  }

  // Appel réel : SMS via Messages, voix via Calls (TwiML inline lisant le code).
  let res: { ok: boolean; sid?: string };
  if (opts.channel === 'VOICE') {
    const twiml = `<Response><Say>${opts.code.split('').join(' ')}</Say></Response>`;
    res = await twilioPost(creds, 'Calls', { To: opts.to, From: creds.from, Twiml: twiml }, log);
  } else {
    res = await twilioPost(creds, 'Messages', { To: opts.to, From: creds.from, Body: `DigiSanté: ${opts.code}` }, log);
  }
  if (res.ok) log.info({ to: maskPhone(opts.to), channel: opts.channel, lang: opts.lang, sid: maskId(res.sid) }, 'OTP envoyé via Twilio');
  return { delivered: res.ok, stub: false, sid: res.sid };
}

/** Envoie un SMS transactionnel (stub si Twilio non configuré). */
export async function sendSms(opts: {
  app: FastifyInstance;
  to: string;
  body: string;
  lang: string;
}): Promise<{ delivered: boolean; stub: boolean; sid?: string }> {
  const log = opts.app.log;
  const creds = await resolveCreds(opts.app);
  if (!creds) {
    // Corps lisible en dev/test seulement (un SMS SOS porte des coordonnées GPS).
    log.warn({ to: maskPhone(opts.to), lang: opts.lang }, `[STUB Twilio SMS] ${stubContent(opts.body)}`);
    return { delivered: false, stub: true };
  }
  // POST Twilio Messages. Sender ID alphanumérique non garanti au Bénin
  // → on utilise le numéro long from (CLAUDE.md §8).
  const res = await twilioPost(creds, 'Messages', { To: opts.to, From: creds.from, Body: opts.body }, log);
  if (res.ok) log.info({ to: maskPhone(opts.to), lang: opts.lang, sid: maskId(res.sid) }, 'SMS envoyé via Twilio');
  return { delivered: res.ok, stub: false, sid: res.sid };
}
