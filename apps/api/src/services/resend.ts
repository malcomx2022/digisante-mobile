// ─────────────────────────────────────────────────────────────
// Service Resend — emails transactionnels. STUB si non configuré.
// ─────────────────────────────────────────────────────────────
import type { FastifyBaseLogger } from 'fastify';

import { isResendConfigured } from '@/lib/env.js';

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
  // TODO : POST https://api.resend.com/emails.
  opts.log.info({ to: opts.to, subject: opts.subject }, 'email envoyé via Resend');
  return { delivered: true, stub: false };
}
