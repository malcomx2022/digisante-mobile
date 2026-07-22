// Test d'intégration des abonnements professionnels (cas limites). CI uniquement.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
// doctor (avec profil) · patient (RBAC) · médecin SANS profil doctor
const PHONES = ['+2290195440001', '+2290195440002', '+2290195440003'];

describe.skipIf(!HAS_INFRA)('Abonnements pro (intégration — cas limites)', () => {
  let app: FastifyInstance;
  let doctorToken: string;
  let patientToken: string;
  let medNoProfileToken: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });

    const doctor = await app.prisma.user.create({
      data: {
        phone: PHONES[0], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Sena', lastName: 'Kougblenou' } },
        doctor: { create: { speciality: 'Pédiatrie', licenseNumber: 'BJ-MED-4401', consultFee: 2500, verifiedAt: new Date() } },
      },
    });
    doctorToken = app.jwt.sign({ sub: doctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });

    const patient = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Efe', lastName: 'Lawson' } }, patient: { create: {} } },
    });
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });

    // Médecin dont l'enregistrement de rôle Doctor n'existe pas (cas dégradé).
    const medNoProfile = await app.prisma.user.create({
      data: { phone: PHONES[2], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Sans', lastName: 'Profil' } } },
    });
    medNoProfileToken = app.jwt.sign({ sub: medNoProfile.id, role: 'MEDECIN' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await app.close();
  });

  it('refuse un non-médecin (RBAC) → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/me', headers: auth(patientToken) });
    expect(res.statusCode).toBe(403);
  });

  it('médecin sans profil Doctor → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/me', headers: auth(medNoProfileToken) });
    expect(res.statusCode).toBe(403);
  });

  it('plan courant par défaut : FREE / ACTIVE', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/me', headers: auth(doctorToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ subscriptionPlan: 'FREE', subscriptionStatus: 'ACTIVE' });
  });

  it('rejette un plan inconnu → 422', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/subscriptions', headers: auth(doctorToken), payload: { plan: 'PLATINUM' } });
    expect(res.statusCode).toBe(422);
  });

  it('souscrit un plan valide (PRO) → 200 et persiste', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/subscriptions', headers: auth(doctorToken), payload: { plan: 'PRO' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ subscriptionPlan: 'PRO', subscriptionStatus: 'ACTIVE' });

    const after = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/me', headers: auth(doctorToken) });
    expect(after.json().subscriptionPlan).toBe('PRO');
  });
});
