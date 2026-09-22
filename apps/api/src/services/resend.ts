// ─────────────────────────────────────────────────────────────
// Service Resend — emails transactionnels. STUB si non configuré.
// Config résolue DYNAMIQUEMENT via le resolver d'intégrations (base → `.env`, §3.6).
// Journaux : adresse MASQUÉE (`u•••@domaine`), identifiant de message masqué ;
// sujet/corps jamais journalisés en production (même en stub). Seules les campagnes
// de santé PUBLIQUE empruntent ce canal (notifications typées : IN_APP/PUSH) — aucun
// contenu médical nominatif n'y transite (§4).
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

import { resolveConfiguredSecrets } from '@/lib/integrations.js';
import { maskEmail, maskId, stubContent } from '@/lib/redact.js';

/** Expéditeur par défaut si `fromEmail` n'est pas saisi (domaine à vérifier chez Resend). */
export const DEFAULT_FROM = 'DigiSanté <no-reply@digisante.bj>';

/** Envoie un email transactionnel (stub si Resend non configuré). */
export async function sendEmail(opts: {
  app: FastifyInstance;
  to: string | null;
  subject: string;
  body: string;
}): Promise<{ delivered: boolean; stub: boolean; id?: string }> {
  const log = opts.app.log;
  if (!opts.to) {
    log.warn('[Resend] aucune adresse e-mail — email ignoré');
    return { delivered: false, stub: true };
  }
  const secrets = await resolveConfiguredSecrets(opts.app, 'RESEND');
  if (!secrets) {
    log.warn({ to: maskEmail(opts.to), subject: stubContent(opts.subject) }, `[STUB Resend] ${stubContent(opts.body)}`);
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
        from: secrets.fromEmail || DEFAULT_FROM,
        to: opts.to,
        subject: opts.subject,
        text: opts.body,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; name?: string };
    if (!res.ok) {
      // `name` (ex. validation_error, invalid_from_address) suffit au diagnostic ;
      // le `message` de Resend peut citer l'adresse destinataire → non journalisé.
      log.error({ status: res.status, resendError: data.name, to: maskEmail(opts.to) }, '[Resend] envoi email en échec');
      return { delivered: false, stub: false };
    }
    log.info({ to: maskEmail(opts.to), id: maskId(data.id) }, 'email envoyé via Resend');
    return { delivered: true, stub: false, id: data.id };
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, '[Resend] erreur réseau');
    return { delivered: false, stub: false };
  }
}
