// Tests d'intégration Santé maternelle (grossesse + CPN + rappels). CI (DB+Redis).
import { ANC_SCHEDULE } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE = '+2290195600001';
const TOKEN = 'maternity_service_token';

describe.skipIf(!HAS_INFRA)('Santé maternelle (intégration)', () => {
  let app: FastifyInstance;
  let token: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  const cleanup = async () => {
    await app.prisma.notification.deleteMany({ where: { recipient: { phone: PHONE } } });
    await app.prisma.user.deleteMany({ where: { phone: { in: [PHONE, '+2290195600002'] } } });
  };

  beforeAll(async () => {
    process.env.RECONCILE_TOKEN = TOKEN;
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();
    const user = await app.prisma.user.create({
      data: { phone: PHONE, role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Maman', lastName: 'T' } }, patient: { create: {} } },
    });
    token = app.jwt.sign({ sub: user.id, role: 'PATIENT' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('démarre un suivi et génère les 8 CPN (terme calculé)', async () => {
    // LMP ancienne → CPN en retard (utile pour les rappels).
    const res = await app.inject({ method: 'POST', url: '/api/v1/maternity', headers: auth(token), payload: { lmpDate: '2025-11-01' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().visits.length).toBe(ANC_SCHEDULE.length);
    expect(res.json().dueDate).toBeTruthy();
  });

  it('refuse une deuxième grossesse active (400)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/maternity', headers: auth(token), payload: { lmpDate: '2026-01-01' } });
    expect(res.statusCode).toBe(400);
  });

  it('marque une CPN comme faite', async () => {
    const active = await app.inject({ method: 'GET', url: '/api/v1/maternity', headers: auth(token) });
    const visitId = active.json().visits[0].id as string;
    const done = await app.inject({ method: 'POST', url: `/api/v1/maternity/visits/${visitId}/done`, headers: auth(token), payload: { done: true } });
    expect(done.statusCode).toBe(200);
    expect(done.json().doneAt).not.toBeNull();
  });

  it('génère les rappels CPN dus — idempotent par jour', async () => {
    const gen1 = await app.inject({ method: 'POST', url: '/api/v1/maternity/reminders/generate', headers: { 'x-service-token': TOKEN } });
    expect(gen1.statusCode).toBe(200);
    expect(gen1.json().generated).toBeGreaterThanOrEqual(1);
    const gen2 = await app.inject({ method: 'POST', url: '/api/v1/maternity/reminders/generate', headers: { 'x-service-token': TOKEN } });
    expect(gen2.json().generated).toBe(0);
  });

  it('cloisonnement §4 : marquer la CPN d’une autre patiente → 404', async () => {
    const other = await app.prisma.user.create({
      data: { phone: '+2290195600002', role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Autre', lastName: 'M' } }, patient: { create: {} } },
      include: { patient: true },
    });
    const preg = await app.prisma.pregnancy.create({
      data: { patientId: other.patient!.id, lmpDate: new Date('2026-01-01'), dueDate: new Date('2026-10-08'), visits: { create: [{ contactNumber: 1, dueDate: new Date('2026-03-26') }] } },
      select: { visits: { select: { id: true } } },
    });
    const res = await app.inject({ method: 'POST', url: `/api/v1/maternity/visits/${preg.visits[0].id}/done`, headers: auth(token), payload: { done: true } });
    expect(res.statusCode).toBe(404);
  });

  it('clôt la grossesse ; une nouvelle peut alors démarrer', async () => {
    const end = await app.inject({ method: 'POST', url: '/api/v1/maternity/end', headers: auth(token) });
    expect(end.statusCode).toBe(200);
    expect(end.json().ended).toBe(true);
    const active = await app.inject({ method: 'GET', url: '/api/v1/maternity', headers: auth(token) });
    expect(active.json()).toBeNull();
    const restart = await app.inject({ method: 'POST', url: '/api/v1/maternity', headers: auth(token), payload: { lmpDate: '2026-02-01' } });
    expect(restart.statusCode).toBe(201);
  });
});
