// Test d'intégration des bénéficiaires (carnet de proches DIASPORA). CI uniquement.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+22993300001', '+22993300002', '+22993300003'];

describe.skipIf(!HAS_INFRA)('Bénéficiaires diaspora (intégration)', () => {
  let app: FastifyInstance;
  let diasporaToken: string;
  let otherDiasporaToken: string;
  let patientToken: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });

    const diaspora = await app.prisma.user.create({ data: { phone: PHONES[0], role: 'DIASPORA', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Dia', lastName: 'Spora' } } } });
    const other = await app.prisma.user.create({ data: { phone: PHONES[1], role: 'DIASPORA', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Other', lastName: 'D' } } } });
    const patient = await app.prisma.user.create({ data: { phone: PHONES[2], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Pat', lastName: 'X' } }, patient: { create: {} } } });

    diasporaToken = app.jwt.sign({ sub: diaspora.id, role: 'DIASPORA' }, { expiresIn: '15m' });
    otherDiasporaToken = app.jwt.sign({ sub: other.id, role: 'DIASPORA' }, { expiresIn: '15m' });
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await app.close();
  });

  it('CRUD complet d’un proche par son propriétaire', async () => {
    const add = await app.inject({
      method: 'POST', url: '/api/v1/beneficiaries', headers: auth(diasporaToken),
      payload: { name: 'Aïcha', relationship: 'Mère', phone: '+22996000000', languagesSpoken: ['FON'] },
    });
    expect(add.statusCode).toBe(201);
    const id = add.json().id as string;
    expect(add.json().languagesSpoken).toContain('FON');

    const list = await app.inject({ method: 'GET', url: '/api/v1/beneficiaries', headers: auth(diasporaToken) });
    expect(list.json()).toHaveLength(1);

    const patch = await app.inject({ method: 'PATCH', url: `/api/v1/beneficiaries/${id}`, headers: auth(diasporaToken), payload: { name: 'Aïcha B.', relationship: 'Mère' } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe('Aïcha B.');

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/beneficiaries/${id}`, headers: auth(diasporaToken) });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/v1/beneficiaries', headers: auth(diasporaToken) });
    expect(after.json()).toHaveLength(0);
  });

  it('isolation : un autre membre ne peut pas modifier/supprimer le proche d’autrui (404)', async () => {
    const add = await app.inject({ method: 'POST', url: '/api/v1/beneficiaries', headers: auth(diasporaToken), payload: { name: 'Koffi' } });
    const id = add.json().id as string;

    const patch = await app.inject({ method: 'PATCH', url: `/api/v1/beneficiaries/${id}`, headers: auth(otherDiasporaToken), payload: { name: 'Hack' } });
    expect(patch.statusCode).toBe(404);
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/beneficiaries/${id}`, headers: auth(otherDiasporaToken) });
    expect(del.statusCode).toBe(404);

    // L'autre membre ne voit pas non plus ce proche dans sa liste.
    const otherList = await app.inject({ method: 'GET', url: '/api/v1/beneficiaries', headers: auth(otherDiasporaToken) });
    expect(otherList.json()).toHaveLength(0);
  });

  it('RBAC : un patient n’accède pas aux bénéficiaires (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/beneficiaries', headers: auth(patientToken) });
    expect(res.statusCode).toBe(403);
  });
});
