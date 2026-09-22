// ─────────────────────────────────────────────────────────────
// SMOKE TEST DAILY.CO — appels RÉELS (opt-in) : authentification API, création
// d'une salle ÉPHÉMÈRE, contrôle de ses propriétés, jeton, puis SUPPRESSION.
//
//   SMOKE_DAILY=1 pnpm --filter @digisante/api test:smoke -- daily
//
// Identifiants résolus comme en production (base chiffrée → `.env`). N'affiche ni
// l'apiKey ni le jeton de salle — seulement le nom de salle et des booléens.
// Ne valide PAS l'audio/vidéo : c'est la matrice manuelle (RECETTE_Daily_Teleconsultation.md).
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ENABLED = process.env.SMOKE_DAILY === '1';

describe.skipIf(!ENABLED)('SMOKE Daily.co (réel, opt-in)', () => {
  let app: FastifyInstance;
  let apiKey = '';
  const name = `smoke-${Date.now()}`;

  const getRoom = () =>
    fetch(`https://api.daily.co/v1/rooms/${name}`, { headers: { Authorization: `Bearer ${apiKey}` } });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
  });
  afterAll(async () => {
    if (app) {
      const { deleteRoom } = await import('./daily.js');
      await deleteRoom({ app, name }); // filet : jamais de salle de recette orpheline
      await app.close();
    }
  });

  it('Daily est configuré (pas de stub) et la clé API est acceptée', async () => {
    const { resolveConfiguredSecrets } = await import('@/lib/integrations.js');
    const secrets = await resolveConfiguredSecrets(app, 'DAILY');
    expect(secrets, 'Daily non configuré (stub)').not.toBeNull();
    apiKey = secrets!.apiKey!;
    const me = await fetch('https://api.daily.co/v1/', { headers: { Authorization: `Bearer ${apiKey}` } });
    expect(me.status, 'clé API refusée par Daily').toBe(200);
  });

  it('salle éphémère : privée, expiration ≤ 4 h, éjection à l’échéance, jeton expirant', async () => {
    const { ROOM_TTL_SECONDS, createMeetingToken, createRoom } = await import('./daily.js');
    const room = await createRoom({ app, name });
    expect(room.url).toContain('.daily.co/');
    const res = await getRoom();
    expect(res.status).toBe(200);
    const info = (await res.json()) as { privacy: string; config?: { exp?: number; eject_at_room_exp?: boolean } };
    const now = Math.floor(Date.now() / 1000);
    expect(info.privacy).toBe('private');
    expect(info.config?.exp).toBeGreaterThan(now);
    expect(info.config!.exp!).toBeLessThanOrEqual(now + ROOM_TTL_SECONDS + 60);
    expect(info.config?.eject_at_room_exp).toBe(true);

    const token = await createMeetingToken({ app, room: name, userId: 'smoke-user', isOwner: false });
    expect(token.split('.').length, 'jeton Daily (JWT) attendu, pas un repli').toBe(3);
    // eslint-disable-next-line no-console -- sortie destinée à l’opérateur de recette
    console.info(`[smoke:daily] salle ${name} · privée=${info.privacy === 'private'} · exp=${new Date(info.config!.exp! * 1000).toISOString()} · jeton émis=oui`);
  });

  it('suppression : la salle n’existe plus', async () => {
    const { deleteRoom } = await import('./daily.js');
    expect(await deleteRoom({ app, name })).toBe(true);
    expect((await getRoom()).status).toBe(404);
  });
});
