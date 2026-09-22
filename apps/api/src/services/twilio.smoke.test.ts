// ─────────────────────────────────────────────────────────────
// SMOKE TEST TWILIO — envoi RÉEL d'un SMS vers un numéro de RECETTE (opt-in).
//
//   SMOKE_TWILIO=1 SMOKE_TWILIO_TO=+22901XXXXXXXX \
//     pnpm --filter @digisante/api test:smoke -- twilio
//
// Identifiants résolus comme en production (base chiffrée → `.env`) : lancer sur
// l'environnement cible (DATABASE_URL / REDIS_URL / HEALTH_ENCRYPTION_KEY posés).
// N'affiche que le numéro MASQUÉ et le SID MASQUÉ. N'envoie AUCUN code OTP réel.
// Ne valide PAS la réception : seul l'opérateur la constate (fiche de recette).
// ─────────────────────────────────────────────────────────────
import { phoneSchema } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { maskId, maskPhone } from '@/lib/redact.js';

const ENABLED = process.env.SMOKE_TWILIO === '1';
const TO = process.env.SMOKE_TWILIO_TO ?? '';

describe.skipIf(!ENABLED)('SMOKE Twilio (réel, opt-in)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
  });
  afterAll(async () => app?.close());

  it('le numéro de recette est au format béninois +229 01XXXXXXXX', () => {
    expect(phoneSchema.safeParse(TO).success, `SMOKE_TWILIO_TO invalide (${maskPhone(TO)})`).toBe(true);
  });

  it('Twilio est configuré (pas de stub) et accepte le SMS de recette', async () => {
    const { resolveConfiguredSecrets } = await import('@/lib/integrations.js');
    expect(await resolveConfiguredSecrets(app, 'TWILIO'), 'Twilio non configuré (stub)').not.toBeNull();

    const { sendSms } = await import('./twilio.js');
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const res = await sendSms({ app, to: TO, body: `DigiSanté — SMS de recette ${stamp} UTC. Aucune action requise.`, lang: 'FR' });
    // Seule trace publiable : numéro et SID MASQUÉS (à reporter dans la fiche de recette).
    // eslint-disable-next-line no-console -- sortie destinée à l’opérateur de recette
    console.info(`[smoke:twilio] destinataire ${maskPhone(TO)} · SID ${maskId(res.sid)} · accepté=${res.delivered}`);
    expect(res.stub).toBe(false);
    expect(res.delivered).toBe(true);
    expect(res.sid).toMatch(/^SM/);
  });
});
