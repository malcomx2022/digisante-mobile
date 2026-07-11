// ─────────────────────────────────────────────────────────────
// Service Resend — emails transactionnels. STUB si non configuré.
// Config résolue DYNAMIQUEMENT via le resolver d'intégrations (base → `.env`, §3.6).
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

import { resolveConfiguredSecrets } from '@/lib/integrations.js';

/** Envoie un email transactionnel (stub si Resend non configuré). */
export async function sendEmail(opts: {
  app: FastifyInstance;
  to: string | null;
  subject: string;
  body: string;
}): Promise<{ delivered: boolean; stub: boolean }> {
  const log = opts.app.log;
  if (!opts.to) {
    log.warn('[Resend] aucune adresse e-mail — email ignoré');
    return { delivered: false, stub: true };
  }
  const secrets = await resolveConfiguredSecrets(opts.app, 'RESEND');
  if (!secrets) {
    log.warn({ to: opts.to, subject: opts.subject }, `[STUB Resend] ${opts.body}`);
    return { delivered: false, stub: true };
  }
  // Appel réel : POST https://api.resend.com/emails (Bearer RESEND_API_KEY).
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secrets.apiKey!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: secrets.fromEmail ?? 'DigiSanté <no-reply@digisante.bj>',
        to: opts.to,
        subject: opts.subject,
        text: opts.body,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      log.error({ status: res.status, detail }, '[Resend] envoi email en échec');
      return { delivered: false, stub: false };
    }
    log.info({ to: opts.to, subject: opts.subject }, 'email envoyé via Resend');
    return { delivered: true, stub: false };
  } catch (err) {
    log.error({ err }, '[Resend] erreur réseau');
    return { delivered: false, stub: false };
  }
}
