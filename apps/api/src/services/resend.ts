// ─────────────────────────────────────────────────────────────
// Service Resend — emails transactionnels. STUB si non configuré.
// ─────────────────────────────────────────────────────────────
import type { FastifyBaseLogger } from 'fastify';

import { env, isResendConfigured } from '@/lib/env.js';

/** Envoie un email transactionnel (stub si Resend non configuré). */
export async function sendEmail(opts: {
  to: string | null;
  subject: string;
  body: string;
  log: FastifyBaseLogger;
}): Promise<{ delivered: boolean; stub: boolean }> {
  if (!opts.to) {
    opts.log.warn('[Resend] aucune adresse e-mail — email ignoré');
    return { delivered: false, stub: true };
  }
  if (!isResendConfigured) {
    opts.log.warn({ to: opts.to, subject: opts.subject }, `[STUB Resend] ${opts.body}`);
    return { delivered: false, stub: true };
  }
  // Appel réel : POST https://api.resend.com/emails (Bearer RESEND_API_KEY).
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL ?? 'DigiSanté <no-reply@digisante.bj>',
        to: opts.to,
        subject: opts.subject,
        text: opts.body,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      opts.log.error({ status: res.status, detail }, '[Resend] envoi email en échec');
      return { delivered: false, stub: false };
    }
    opts.log.info({ to: opts.to, subject: opts.subject }, 'email envoyé via Resend');
    return { delivered: true, stub: false };
  } catch (err) {
    opts.log.error({ err }, '[Resend] erreur réseau');
    return { delivered: false, stub: false };
  }
}
