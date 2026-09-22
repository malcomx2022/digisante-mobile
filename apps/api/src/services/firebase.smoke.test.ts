// ─────────────────────────────────────────────────────────────
// SMOKE TEST FIREBASE FCM — envoi RÉEL d'une notification vers un token de RECETTE.
//
//   SMOKE_FCM=1 SMOKE_FCM_TOKEN=<token d'un appareil de recette> \
//     pnpm --filter @digisante/api test:smoke -- firebase
//
// Le token s'obtient sur l'appareil de recette connecté (voir RECETTE_Firebase_Push.md).
// Identifiants serveur résolus comme en production (base chiffrée → `.env`). N'affiche
// ni clé, ni token, seulement l'identifiant de message MASQUÉ. La RÉCEPTION n'est
// constatée que par l'opérateur, sur l'appareil.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { maskId } from '@/lib/redact.js';

const ENABLED = process.env.SMOKE_FCM === '1';
const TOKEN = process.env.SMOKE_FCM_TOKEN ?? '';

describe.skipIf(!ENABLED)('SMOKE Firebase FCM (réel, opt-in)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
  });
  afterAll(async () => app?.close());

  it('FCM est configuré côté serveur (pas de stub) et un token de recette est fourni', async () => {
    const { resolveConfiguredSecrets } = await import('@/lib/integrations.js');
    expect(await resolveConfiguredSecrets(app, 'FIREBASE'), 'Firebase non configuré (stub)').not.toBeNull();
    expect(TOKEN.length, 'SMOKE_FCM_TOKEN manquant').toBeGreaterThan(20);
  });

  it('FCM HTTP v1 accepte la notification de recette', async () => {
    const { sendPush } = await import('./firebase.js');
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const res = await sendPush({ app, token: TOKEN, title: 'DigiSanté — recette', body: `Notification de test ${stamp} UTC`, data: { link: '/' } });
    // eslint-disable-next-line no-console -- sortie destinée à l’opérateur de recette
    console.info(`[smoke:fcm] accepté=${res.delivered} · message ${maskId(res.messageId)} · token invalide=${Boolean(res.invalidToken)}`);
    expect(res.stub).toBe(false);
    expect(res.invalidToken ?? false, 'token rejeté par FCM (UNREGISTERED/INVALID_ARGUMENT)').toBe(false);
    expect(res.delivered).toBe(true);
  });
});
