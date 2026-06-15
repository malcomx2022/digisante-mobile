// Test d'intégration de l'observance médicamenteuse. CI uniquement (DB+Redis).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE_PATIENT = '+22995100001';
const PHONE_DOCTOR = '+22995100002';
const ALL = [PHONE_PATIENT, PHONE_DOCTOR];

describe.skipIf(!HAS_INFRA)('Observance médicamenteuse (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let doctorToken: string;
  let patientId: string;
  let itemId: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  async function registerAndLogin(payload: Record<string, unknown>) {
    const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
    const devCode = reg.json().otp.devCode as string;
    const verify = await app.inject({
      method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone: payload.phone, code: devCode },
    });
    return { userId: reg.json().user.id as string, token: verify.json().accessToken as string };
  }

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: ALL } } });

    const patient = await registerAndLogin({ phone: PHONE_PATIENT, role: 'PATIENT', lang: 'FR', firstName: 'Obs', lastName: 'Patient' });
    patientToken = patient.token;
    patientId = (await app.prisma.patient.findUniqueOrThrow({ where: { userId: patient.userId }, select: { id: true } })).id;

    const doctor = await registerAndLogin({
      phone: PHONE_DOCTOR, role: 'MEDECIN', lang: 'FR', firstName: 'Dr', lastName: 'A',
      speciality: 'Généraliste', licenseNumber: 'BJ-MED-9101', consultFee: 3000,
    });
    doctorToken = doctor.token;

    // Le médecin prescrit un traitement chronique au patient.
    const validUntil = new Date(Date.now() + 60 * 24 * 3600_000).toISOString();
    const presc = await app.inject({
      method: 'POST', url: '/api/v1/prescriptions', headers: auth(doctorToken),
      payload: { patientId, validUntil, items: [{ medicationName: 'Amlodipine', dosage: '5mg', frequency: '1x/j', duration: '30j' }] },
    });
    itemId = presc.json().items[0].id as string;
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: ALL } } });
    await app.close();
  });

  it('liste le traitement actif (non pris) + résumé initial', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/adherence/today', headers: auth(patientToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const med = body.treatments.find((t: { itemId: string }) => t.itemId === itemId);
    expect(med).toBeTruthy();
    expect(med.medicationName).toBe('Amlodipine');
    expect(med.takenToday).toBe(false);
    expect(body.summary.streak).toBe(0);
  });

  it('déclare une prise → pris aujourd’hui, streak 1, observance 7j ≈ 14 %', async () => {
    const take = await app.inject({
      method: 'POST', url: '/api/v1/adherence/intake', headers: auth(patientToken),
      payload: { itemId, medicationName: 'Amlodipine' },
    });
    expect(take.statusCode).toBe(201);
    expect(take.json().alreadyTaken).toBe(false);

    const res = await app.inject({ method: 'GET', url: '/api/v1/adherence/today', headers: auth(patientToken) });
    const body = res.json();
    expect(body.treatments.find((t: { itemId: string }) => t.itemId === itemId).takenToday).toBe(true);
    expect(body.summary.streak).toBe(1);
    expect(body.summary.adherence7).toBe(14); // round(1/7*100)
  });

  it('idempotence : re-déclarer la même prise le même jour → alreadyTaken', async () => {
    const take = await app.inject({
      method: 'POST', url: '/api/v1/adherence/intake', headers: auth(patientToken),
      payload: { itemId, medicationName: 'Amlodipine' },
    });
    expect(take.statusCode).toBe(201);
    expect(take.json().alreadyTaken).toBe(true);
  });

  it('réservé au patient : un médecin est refusé (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/adherence/today', headers: auth(doctorToken) });
    expect(res.statusCode).toBe(403);
  });
});
