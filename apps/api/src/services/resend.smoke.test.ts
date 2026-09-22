// ─────────────────────────────────────────────────────────────
// SMOKE TEST RESEND — envoi RÉEL d'un email de recette (opt-in).
//
//   SMOKE_RESEND=1 EMAIL_RECIPIENT_TEST=recette@<domaine> \
//     pnpm --filter @digisante/api test:smoke -- resend
//
// Identifiants résolus comme en production (base chiffrée → `.env`). N'affiche que
// l'adresse MASQUÉE et l'identifiant de message MASQUÉ. La RÉCEPTION (boîte de
// réception vs spam, SPF/DKIM « PASS » dans l'en-tête) est constatée par l'opérateur.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { maskEmail, maskId } from '@/lib/redact.js';

const ENABLED = process.env.SMOKE_RESEND === '1';
const TO = process.env.EMAIL_RECIPIENT_TEST ?? '';

describe.skipIf(!ENABLED)('SMOKE Resend (réel, opt-in)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
  });
  afterAll(async () => app?.close());

  it('Resend est configuré (pas de stub) et une adresse de recette est fournie', async () => {
    const { resolveConfiguredSecrets } = await import('@/lib/integrations.js');
    expect(await resolveConfiguredSecrets(app, 'RESEND'), 'Resend non configuré (stub)').not.toBeNull();
    expect(TO, 'EMAIL_RECIPIENT_TEST manquant ou invalide').toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
  });

  it('Resend accepte l’email de recette (aucune donnée de santé)', async () => {
    const { sendEmail } = await import('./resend.js');
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const res = await sendEmail({ app, to: TO, subject: 'DigiSanté — email de recette', body: `Email de test envoyé le ${stamp} UTC. Aucune action requise.` });
    // eslint-disable-next-line no-console -- sortie destinée à l’opérateur de recette
    console.info(`[smoke:resend] destinataire ${maskEmail(TO)} · message ${maskId(res.id)} · accepté=${res.delivered}`);
    expect(res.stub).toBe(false);
    expect(res.delivered).toBe(true);
  });
});
