// Tests d'intégration — Agent de Santé Communautaire (ASC). CI (DB+Redis).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290193300001', '+2290193300002', '+2290193300003', '+2290193300004']; // asc1, asc2, doctor, patient
const REG_PHONE = '+2290193300005'; // inscription ASC (format international)

describe.skipIf(!HAS_INFRA)('Agent de Santé Communautaire (intégration)', () => {
  let app: FastifyInstance;
  let asc1: string;
  let asc2: string;
  let patientTok: string;
  let doctorId: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  const cleanup = () => app.prisma.user.deleteMany({ where: { phone: { in: [...PHONES, REG_PHONE] } } });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const a1 = await app.prisma.user.create({ data: { phone: PHONES[0], role: 'ASC', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Ada', lastName: 'Relais' } }, communityWorker: { create: { zone: 'Zone Nord' } } } });
    const a2 = await app.prisma.user.create({ data: { phone: PHONES[1], role: 'ASC', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Ben', lastName: 'Relais' } }, communityWorker: { create: { zone: 'Zone Sud' } } } });
    const doc = await app.prisma.user.create({ data: { phone: PHONES[2], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Dr', lastName: 'V' } }, doctor: { create: { speciality: 'G', licenseNumber: 'BJ-MED-9001', consultFee: 0, verifiedAt: new Date() } } }, include: { doctor: true } });
    const pat = await app.prisma.user.create({ data: { phone: PHONES[3], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'P', lastName: 'A' } }, patient: { create: {} } } });
    asc1 = app.jwt.sign({ sub: a1.id, role: 'ASC' }, { expiresIn: '15m' });
    asc2 = app.jwt.sign({ sub: a2.id, role: 'ASC' }, { expiresIn: '15m' });
    patientTok = app.jwt.sign({ sub: pat.id, role: 'PATIENT' }, { expiresIn: '15m' });
    doctorId = doc.doctor!.id;
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('inscription ASC crée le profil de rôle (zone)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { phone: REG_PHONE, role: 'ASC', firstName: 'New', lastName: 'Asc', zone: 'Village X' } });
    expect(res.statusCode).toBe(201);
    const worker = await app.prisma.communityHealthWorker.findFirst({ where: { zone: 'Village X' }, select: { zone: true } });
    expect(worker?.zone).toBe('Village X');
  });

  it('inscription ASC sans zone → refus de validation (422)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { phone: '+2290193300006', role: 'ASC', firstName: 'No', lastName: 'Zone' } });
    expect(res.statusCode).toBe(422);
  });

  it('roster : ajoute un bénéficiaire + observation, relit la fiche', async () => {
    const add = await app.inject({ method: 'POST', url: '/api/v1/asc/beneficiaries', headers: auth(asc1), payload: { name: 'Kofi', village: 'Hameau A', phone: '90000000' } });
    expect(add.statusCode).toBe(201);
    const bId = add.json().id as string;

    const obs = await app.inject({ method: 'POST', url: `/api/v1/asc/beneficiaries/${bId}/observations`, headers: auth(asc1), payload: { systolic: 130, diastolic: 85, temperature: 38.5, triageOutcome: 'CONSULT', note: 'Fièvre' } });
    expect(obs.statusCode).toBe(201);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/asc/beneficiaries/${bId}`, headers: auth(asc1) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().name).toBe('Kofi');
    expect(detail.json().observations.length).toBe(1);
    expect(detail.json().observations[0].triageOutcome).toBe('CONSULT');
  });

  it('cloisonnement §4 : un autre ASC ne voit pas ce bénéficiaire (404)', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/asc/beneficiaries', headers: auth(asc1) });
    const bId = list.json()[0].id as string;
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/asc/beneficiaries/${bId}`, headers: auth(asc2) });
    expect(foreign.statusCode).toBe(404);
    const foreignObs = await app.inject({ method: 'POST', url: `/api/v1/asc/beneficiaries/${bId}/observations`, headers: auth(asc2), payload: { note: 'x' } });
    expect(foreignObs.statusCode).toBe(404);
  });

  it('signalement à un médecin vérifié → notification ; médecin inconnu → 404', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/asc/beneficiaries', headers: auth(asc1) });
    const bId = list.json()[0].id as string;

    const before = await app.prisma.notification.count({ where: { recipient: { phone: PHONES[2] } } });
    const relay = await app.inject({ method: 'POST', url: `/api/v1/asc/beneficiaries/${bId}/relay`, headers: auth(asc1), payload: { doctorId, message: 'Merci de voir ce patient' } });
    expect(relay.statusCode).toBe(200);
    const after = await app.prisma.notification.count({ where: { recipient: { phone: PHONES[2] } } });
    expect(after).toBe(before + 1);

    const bad = await app.inject({ method: 'POST', url: `/api/v1/asc/beneficiaries/${bId}/relay`, headers: auth(asc1), payload: { doctorId: 'ck00000000000000000000000', message: 'x' } });
    expect(bad.statusCode).toBe(404);
  });

  it('RBAC : un patient ne peut pas accéder aux routes ASC (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/asc/beneficiaries', headers: auth(patientTok) });
    expect(res.statusCode).toBe(403);
  });
});
