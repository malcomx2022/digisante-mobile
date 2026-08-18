// Tests d'intégration SOS (via app.inject). Si DB+Redis (CI).
//
// Écart D6 : `Sos.status` et `resolvedAt` n'étaient écrits NULLE PART après la
// création — toute alerte restait `ACTIVE` indéfiniment et `resolvedAt` était un
// champ mort. Ces tests verrouillent la clôture par le patient et son
// cloisonnement (§4 : on ne clôt que SA propre alerte).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290196200001', '+2290196200002'];

describe.skipIf(!HAS_INFRA)('SOS — clôture d’alerte (intégration)', () => {
  let app: FastifyInstance;
  let tokenA: string;
  let tokenB: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const cleanup = async () => {
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  };

  const trigger = async (token: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sos',
      headers: auth(token),
      payload: { latitude: 6.36, longitude: 2.42 },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const a = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Ama', lastName: 'S' } }, patient: { create: {} } },
    });
    const b = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Bio', lastName: 'T' } }, patient: { create: {} } },
    });
    tokenA = app.jwt.sign({ sub: a.id, role: 'PATIENT' }, { expiresIn: '15m' });
    tokenB = app.jwt.sign({ sub: b.id, role: 'PATIENT' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('« je vais bien » clôt l’alerte (RESOLVED + resolvedAt) et la seconde tentative est refusée', async () => {
    const id = await trigger(tokenA);

    // L'alerte naît ACTIVE, sans date de clôture.
    const listed = await app.inject({ method: 'GET', url: '/api/v1/sos', headers: auth(tokenA) });
    const before = listed.json().find((s: { id: string }) => s.id === id);
    expect(before.status).toBe('ACTIVE');
    expect(before.resolvedAt).toBeNull();

    const close = await app.inject({ method: 'POST', url: `/api/v1/sos/${id}/resolve`, headers: auth(tokenA), payload: {} });
    expect(close.statusCode).toBe(200);
    expect(close.json().status).toBe('RESOLVED');
    expect(close.json().resolvedAt).not.toBeNull();

    // Idempotence explicite : on ne re-clôt pas une alerte déjà close.
    const again = await app.inject({ method: 'POST', url: `/api/v1/sos/${id}/resolve`, headers: auth(tokenA), payload: {} });
    expect(again.statusCode).toBe(400);
  });

  it('« fausse alerte » distingue le statut FALSE_ALARM et journalise la clôture', async () => {
    const id = await trigger(tokenA);
    const before = await app.prisma.auditLog.count({ where: { action: 'SOS_RESOLVED' } });

    const close = await app.inject({
      method: 'POST', url: `/api/v1/sos/${id}/resolve`, headers: auth(tokenA), payload: { falseAlarm: true },
    });
    expect(close.statusCode).toBe(200);
    expect(close.json().status).toBe('FALSE_ALARM');

    // La clôture d'une urgence est un événement de traçabilité (§4).
    expect(await app.prisma.auditLog.count({ where: { action: 'SOS_RESOLVED' } })).toBe(before + 1);
  });

  it('§4 — on ne clôt pas l’alerte d’un autre patient (404, sans confirmer son existence)', async () => {
    const id = await trigger(tokenA);
    const intrus = await app.inject({ method: 'POST', url: `/api/v1/sos/${id}/resolve`, headers: auth(tokenB), payload: {} });
    expect(intrus.statusCode).toBe(404);

    // Et l'alerte reste bien ouverte pour son propriétaire.
    const still = await app.prisma.sos.findUnique({ where: { id }, select: { status: true } });
    expect(still?.status).toBe('ACTIVE');
  });
});
