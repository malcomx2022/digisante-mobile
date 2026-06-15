// Test d'intégration de la fiche médicale d'urgence (patient). CI uniquement.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE_PATIENT = '+22995000001';
const PHONE_DOCTOR = '+22995000002';
const ALL = [PHONE_PATIENT, PHONE_DOCTOR];

describe.skipIf(!HAS_INFRA)('Fiche médicale d’urgence (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let doctorToken: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  async function registerAndLogin(payload: Record<string, unknown>) {
    const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
    const devCode = reg.json().otp.devCode as string;
    const verify = await app.inject({
      method: 'POST', url: '/api/v1/auth/otp/verify',
      payload: { phone: payload.phone, code: devCode },
    });
    return verify.json().accessToken as string;
  }

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: ALL } } });
    patientToken = await registerAndLogin({ phone: PHONE_PATIENT, role: 'PATIENT', lang: 'FR', firstName: 'Med', lastName: 'Patient' });
    doctorToken = await registerAndLogin({
      phone: PHONE_DOCTOR, role: 'MEDECIN', lang: 'FR', firstName: 'Dr', lastName: 'X',
      speciality: 'Généraliste', licenseNumber: 'BJ-MED-9001', consultFee: 3000,
    });
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: ALL } } });
    await app.close();
  });

  it('le patient renseigne et relit sa fiche médicale d’urgence', async () => {
    const patch = await app.inject({
      method: 'PATCH', url: '/api/v1/users/me/medical', headers: auth(patientToken),
      payload: {
        bloodGroup: 'O+', allergies: ['Pénicilline', 'Arachide'],
        chronicDiseases: ['Hypertension'], emergencyContact: '+22990000000',
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().bloodGroup).toBe('O+');

    const get = await app.inject({ method: 'GET', url: '/api/v1/users/me/medical', headers: auth(patientToken) });
    expect(get.statusCode).toBe(200);
    const body = get.json();
    expect(body.allergies).toContain('Pénicilline');
    expect(body.chronicDiseases).toContain('Hypertension');
    expect(body.emergencyContact).toBe('+22990000000');
  });

  it('rejette un groupe sanguin invalide (422)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/v1/users/me/medical', headers: auth(patientToken),
      payload: { bloodGroup: 'Z+' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('réservé aux patients : un médecin est refusé (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/me/medical', headers: auth(doctorToken) });
    expect(res.statusCode).toBe(403);
  });
});
