// Test d'intégration de la couverture d'assurance patient. CI uniquement.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { invalidateProviders } from './insurance.service.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290195410001'];

describe.skipIf(!HAS_INFRA)('Assurance patient (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let insuranceId: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });

    const ins = await app.prisma.insurance.upsert({
      where: { code: 'TEST-ARCH' },
      update: {},
      create: { name: 'ARCH Test', code: 'TEST-ARCH', coverageTypes: ['CONSULTATION', 'PHARMACIE'] },
    });
    insuranceId = ins.id;
    // Le catalogue est mis en cache (read-through) : purger la clé après l'upsert
    // pour que la première lecture de ce run reflète bien l'assureur de test,
    // indépendamment de l'ordre d'exécution des suites.
    await invalidateProviders(app);

    const patient = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'P', lastName: 'A' } }, patient: { create: {} } },
    });
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await app.prisma.insurance.deleteMany({ where: { code: 'TEST-ARCH' } });
    await app.close();
  });

  it('le catalogue liste l’assureur de test', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/insurance/providers', headers: auth(patientToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((p: { code: string }) => p.code)).toContain('TEST-ARCH');
  });

  it('déclare une couverture, la liste, refuse le doublon, puis la supprime', async () => {
    // Déclaration.
    const add = await app.inject({
      method: 'POST', url: '/api/v1/insurance/me', headers: auth(patientToken),
      payload: { insuranceId, memberNumber: 'ARCH-12345' },
    });
    expect(add.statusCode).toBe(201);
    const coverageId = add.json().id;

    // Liste : la couverture apparaît avec statut ACTIVE.
    const mine = await app.inject({ method: 'GET', url: '/api/v1/insurance/me', headers: auth(patientToken) });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toHaveLength(1);
    expect(mine.json()[0].insurance.code).toBe('TEST-ARCH');
    expect(mine.json()[0].status).toBe('ACTIVE');

    // Doublon sur le même assureur → 409.
    const dup = await app.inject({
      method: 'POST', url: '/api/v1/insurance/me', headers: auth(patientToken),
      payload: { insuranceId, memberNumber: 'ARCH-99999' },
    });
    expect(dup.statusCode).toBe(409);

    // Suppression.
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/insurance/me/${coverageId}`, headers: auth(patientToken) });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/v1/insurance/me', headers: auth(patientToken) });
    expect(after.json()).toHaveLength(0);
  });

  it('statut EXPIRED calculé quand la date d’expiration est dépassée', async () => {
    const add = await app.inject({
      method: 'POST', url: '/api/v1/insurance/me', headers: auth(patientToken),
      payload: { insuranceId, memberNumber: 'ARCH-OLD', expiresAt: '2020-01-01' },
    });
    expect(add.statusCode).toBe(201);
    const mine = await app.inject({ method: 'GET', url: '/api/v1/insurance/me', headers: auth(patientToken) });
    expect(mine.json()[0].status).toBe('EXPIRED');
  });

  it('le catalogue est servi depuis le cache Redis et invalidable', async () => {
    // 1) Amorce le cache (lecture read-through).
    await app.inject({ method: 'GET', url: '/api/v1/insurance/providers', headers: auth(patientToken) });

    // 2) Écriture DIRECTE en base (contourne le cache) d'un nouvel assureur.
    await app.prisma.insurance.create({
      data: { name: 'Cache Test', code: 'TEST-CACHE', coverageTypes: ['CONSULTATION'] },
    });

    // 3) Nouvelle lecture : encore servie depuis le cache → n'inclut PAS le nouvel
    //    assureur (preuve du hit cache, pas d'aller-retour DB).
    const cachedRes = await app.inject({ method: 'GET', url: '/api/v1/insurance/providers', headers: auth(patientToken) });
    expect(cachedRes.json().map((p: { code: string }) => p.code)).not.toContain('TEST-CACHE');

    // 4) Invalidation via le service → la lecture suivante reflète l'état réel.
    await invalidateProviders(app);
    const freshRes = await app.inject({ method: 'GET', url: '/api/v1/insurance/providers', headers: auth(patientToken) });
    expect(freshRes.json().map((p: { code: string }) => p.code)).toContain('TEST-CACHE');

    await app.prisma.insurance.deleteMany({ where: { code: 'TEST-CACHE' } });
  });
});
