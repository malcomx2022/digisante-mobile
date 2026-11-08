// M1 + M3 : clôture d'un RDV présentiel (vu / absent) et créneaux libres réels.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290194600001', '+2290194600002', '+2290194600003']; // patient, médecin, autre médecin

describe.skipIf(!HAS_INFRA)('RDV présentiels : clôture et créneaux (intégration)', () => {
  let app: FastifyInstance;
  let patientTok: string;
  let doctorTok: string;
  let otherTok: string;
  let patientId: string;
  let doctorId: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const cleanup = () => app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  const appt = (scheduledAt: Date, status: 'PENDING' | 'CONFIRMED' = 'CONFIRMED') =>
    app.prisma.appointment.create({ data: { patientId, doctorId, type: 'PHYSICAL', status, scheduledAt } });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();
    const pat = await app.prisma.user.create({ data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', patient: { create: {} } }, include: { patient: true } });
    const doc = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', doctor: { create: { speciality: 'G', licenseNumber: 'BJ-MED-9461', consultFee: 0, slotDuration: 30, verifiedAt: new Date() } } },
      include: { doctor: true },
    });
    const other = await app.prisma.user.create({
      data: { phone: PHONES[2], role: 'MEDECIN', status: 'ACTIVE', doctor: { create: { speciality: 'G', licenseNumber: 'BJ-MED-9462', consultFee: 0, verifiedAt: new Date() } } },
    });
    patientId = pat.patient!.id;
    doctorId = doc.doctor!.id;
    patientTok = app.jwt.sign({ sub: pat.id, role: 'PATIENT' }, { expiresIn: '15m' });
    doctorTok = app.jwt.sign({ sub: doc.id, role: 'MEDECIN' }, { expiresIn: '15m' });
    otherTok = app.jwt.sign({ sub: other.id, role: 'MEDECIN' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('le médecin clôt un RDV passé : vu → COMPLETED, ce qui ouvre l’avis patient', async () => {
    const a = await appt(new Date(Date.now() - 3_600_000));
    expect((await app.inject({ method: 'POST', url: `/api/v1/appointments/${a.id}/complete`, headers: auth(otherTok) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/appointments/${a.id}/complete`, headers: auth(patientTok) })).statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: `/api/v1/appointments/${a.id}/complete`, headers: auth(doctorTok) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('COMPLETED');
    // État terminal : ni second passage ni absence après coup.
    expect((await app.inject({ method: 'POST', url: `/api/v1/appointments/${a.id}/no-show`, headers: auth(doctorTok) })).statusCode).toBe(400);
  });

  it('absence : NO_SHOW ; refus avant l’heure et sur un RDV non confirmé', async () => {
    const past = await appt(new Date(Date.now() - 3_600_000));
    const res = await app.inject({ method: 'POST', url: `/api/v1/appointments/${past.id}/no-show`, headers: auth(doctorTok) });
    expect(res.json().status).toBe('NO_SHOW');
    const future = await appt(new Date(Date.now() + 3 * 24 * 3_600_000));
    expect((await app.inject({ method: 'POST', url: `/api/v1/appointments/${future.id}/complete`, headers: auth(doctorTok) })).statusCode).toBe(400);
    const pending = await appt(new Date(Date.now() - 7_200_000), 'PENDING');
    expect((await app.inject({ method: 'POST', url: `/api/v1/appointments/${pending.id}/complete`, headers: auth(doctorTok) })).statusCode).toBe(400);
  });

  it('créneaux : pas = slotDuration, un RDV actif retire son créneau, médecin inconnu → 404', async () => {
    const day = new Date(Date.now() + 5 * 24 * 3_600_000).toISOString().slice(0, 10);
    const before = await app.inject({ method: 'GET', url: `/api/v1/appointments/slots?doctorId=${doctorId}&date=${day}`, headers: auth(patientTok) });
    expect(before.statusCode).toBe(200);
    const slots = before.json().slots as string[];
    expect(slots).toHaveLength(18); // 8 h–17 h par pas de 30 min
    const book = await app.inject({ method: 'POST', url: '/api/v1/appointments', headers: auth(patientTok), payload: { doctorId, type: 'PHYSICAL', scheduledAt: slots[2] } });
    expect(book.statusCode).toBe(201);
    const after = await app.inject({ method: 'GET', url: `/api/v1/appointments/slots?doctorId=${doctorId}&date=${day}`, headers: auth(patientTok) });
    expect(after.json().slots).not.toContain(slots[2]);
    expect(after.json().slots).toHaveLength(17);
    const unknown = await app.inject({ method: 'GET', url: `/api/v1/appointments/slots?doctorId=ck00000000000000000000000&date=${day}`, headers: auth(patientTok) });
    expect(unknown.statusCode).toBe(404);
  });
});
