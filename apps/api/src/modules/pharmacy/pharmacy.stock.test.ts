// Tests d'intégration — stock pharmacie & « médicament près de moi ». CI (DB+Redis).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290194400001', '+2290194400002', '+2290194400003']; // pharma1, pharma2, patient

describe.skipIf(!HAS_INFRA)('Pharmacie — stock & disponibilité (intégration)', () => {
  let app: FastifyInstance;
  let pharma1: string;
  let pharma2: string;
  let patient: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  const cleanup = () => app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const p1 = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'PHARMACIE', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Ph', lastName: 'Un' } }, pharmacy: { create: { name: 'Pharmacie Cotonou', address: 'Cotonou', phone: PHONES[0], geolat: 6.3703, geolong: 2.3912 } } },
    });
    const p2 = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'PHARMACIE', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Ph', lastName: 'Deux' } }, pharmacy: { create: { name: 'Pharmacie Bohicon', address: 'Bohicon', phone: PHONES[1], geolat: 7.178, geolong: 2.0667 } } },
    });
    const pat = await app.prisma.user.create({
      data: { phone: PHONES[2], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Pat', lastName: 'Ient' } }, patient: { create: {} } },
    });
    pharma1 = app.jwt.sign({ sub: p1.id, role: 'PHARMACIE' }, { expiresIn: '15m' });
    pharma2 = app.jwt.sign({ sub: p2.id, role: 'PHARMACIE' }, { expiresIn: '15m' });
    patient = app.jwt.sign({ sub: pat.id, role: 'PATIENT' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('la pharmacie gère son stock (upsert + liste)', async () => {
    const add = await app.inject({ method: 'POST', url: '/api/v1/pharmacy/stock', headers: auth(pharma1), payload: { displayName: 'Paracétamol 500mg', status: 'IN_STOCK', price: 500 } });
    expect(add.statusCode).toBe(201);
    // Amoxicilline en rupture chez pharma1.
    await app.inject({ method: 'POST', url: '/api/v1/pharmacy/stock', headers: auth(pharma1), payload: { displayName: 'Amoxicilline', status: 'OUT' } });
    // Paracétamol aussi chez pharma2 (plus loin).
    await app.inject({ method: 'POST', url: '/api/v1/pharmacy/stock', headers: auth(pharma2), payload: { displayName: 'Paracétamol', status: 'LOW' } });

    const list = await app.inject({ method: 'GET', url: '/api/v1/pharmacy/stock', headers: auth(pharma1) });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBe(2); // pharma1 ne voit QUE son stock (§ privacy)
  });

  it('recherche patient : trie par distance, exclut les ruptures', async () => {
    // Position proche de Cotonou → pharma1 (Paracétamol) doit sortir en premier.
    const res = await app.inject({ method: 'GET', url: '/api/v1/pharmacy/availability?q=parac&lat=6.37&lng=2.39', headers: auth(patient) });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ displayName: string; pharmacy: { name: string }; distanceKm: number | null }>;
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].pharmacy.name).toBe('Pharmacie Cotonou'); // la plus proche
    expect(items[0].distanceKm).toBeLessThan(items[1].distanceKm!);

    // Amoxicilline est en rupture partout → aucun résultat.
    const amox = await app.inject({ method: 'GET', url: '/api/v1/pharmacy/availability?q=amox', headers: auth(patient) });
    expect(amox.json().items.length).toBe(0);
  });

  it('supprime une ligne ; une autre pharmacie ne peut pas (404)', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/pharmacy/stock', headers: auth(pharma1) });
    const lineId = list.json()[0].id as string;
    // pharma2 tente de supprimer une ligne de pharma1 → 404 (cloisonnée).
    const foreign = await app.inject({ method: 'DELETE', url: `/api/v1/pharmacy/stock/${lineId}`, headers: auth(pharma2) });
    expect(foreign.statusCode).toBe(404);
    // pharma1 supprime la sienne → OK.
    const own = await app.inject({ method: 'DELETE', url: `/api/v1/pharmacy/stock/${lineId}`, headers: auth(pharma1) });
    expect(own.statusCode).toBe(200);
  });
});
