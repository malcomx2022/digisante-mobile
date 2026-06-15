// Test d'intégration des rappels horaires d'observance. CI uniquement.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE_PATIENT = '+22995200001';
const PHONE_DOCTOR = '+22995200002';
const ALL = [PHONE_PATIENT, PHONE_DOCTOR];
const TOKEN = 'med_reminder_test_token';

describe.skipIf(!HAS_INFRA)('Rappels horaires d’observance (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let doctorToken: string;
  let patientUserId: string;
  let itemId: string;
  let reminderId: string;
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
    process.env.RECONCILE_TOKEN = TOKEN;
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: ALL } } });

    const patient = await registerAndLogin({ phone: PHONE_PATIENT, role: 'PATIENT', lang: 'FR', firstName: 'Rem', lastName: 'Patient' });
    patientToken = patient.token;
    patientUserId = patient.userId;
    const patientId = (await app.prisma.patient.findUniqueOrThrow({ where: { userId: patient.userId }, select: { id: true } })).id;

    const doctor = await registerAndLogin({
      phone: PHONE_DOCTOR, role: 'MEDECIN', lang: 'FR', firstName: 'Dr', lastName: 'R',
      speciality: 'Généraliste', licenseNumber: 'BJ-MED-9201', consultFee: 3000,
    });
    doctorToken = doctor.token;

    const validUntil = new Date(Date.now() + 60 * 24 * 3600_000).toISOString();
    const presc = await app.inject({
      method: 'POST', url: '/api/v1/prescriptions', headers: auth(doctorToken),
      payload: { patientId, validUntil, items: [{ medicationName: 'Metformine', dosage: '850mg', frequency: '2x/j', duration: '30j' }] },
    });
    itemId = presc.json().items[0].id as string;
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: ALL } } });
    await app.close();
  });

  it('le patient crée un rappel horaire et le retrouve', async () => {
    const add = await app.inject({
      method: 'POST', url: '/api/v1/reminders/medication', headers: auth(patientToken),
      payload: { itemId, medicationName: 'Metformine', time: '00:00' }, // heure passée → due aujourd'hui
    });
    expect(add.statusCode).toBe(201);
    reminderId = add.json().id as string;

    const list = await app.inject({ method: 'GET', url: '/api/v1/reminders/medication', headers: auth(patientToken) });
    expect(list.json().some((r: { id: string }) => r.id === reminderId)).toBe(true);
  });

  it('le générateur crée une notification due, puis est idempotent le même jour', async () => {
    const gen1 = await app.inject({ method: 'POST', url: '/api/v1/reminders/generate', headers: { 'x-service-token': TOKEN } });
    expect(gen1.statusCode).toBe(200);
    expect(gen1.json().generated).toBeGreaterThanOrEqual(1);

    const notif = await app.prisma.notification.findFirst({
      where: { recipientId: patientUserId, type: 'SYSTEM', body: { contains: 'Metformine' } },
    });
    expect(notif).not.toBeNull();
    expect(notif?.status).toBe('PENDING');

    // Idempotence : pas de doublon le même jour.
    const gen2 = await app.inject({ method: 'POST', url: '/api/v1/reminders/generate', headers: { 'x-service-token': TOKEN } });
    expect(gen2.json().generated).toBe(0);
  });

  it('rejette le générateur sans jeton de service (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/reminders/generate' });
    expect(res.statusCode).toBe(401);
  });

  it('le patient supprime son rappel', async () => {
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/reminders/medication/${reminderId}`, headers: auth(patientToken) });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/v1/reminders/medication', headers: auth(patientToken) });
    expect(list.json().some((r: { id: string }) => r.id === reminderId)).toBe(false);
  });

  it('réservé au patient : un médecin est refusé (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reminders/medication', headers: auth(doctorToken) });
    expect(res.statusCode).toBe(403);
  });
});
