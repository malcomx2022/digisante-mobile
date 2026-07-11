// Tests d'intégration Vaccination PEV (carnet + rappels). CI uniquement (DB+Redis).
import { PEV_SCHEDULE } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE = '+2290195500001';
const TOKEN = 'vacc_service_token';

describe.skipIf(!HAS_INFRA)('Vaccination PEV (intégration)', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  const cleanup = async () => {
    await app.prisma.notification.deleteMany({ where: { recipient: { phone: PHONE } } });
    await app.prisma.user.deleteMany({ where: { phone: PHONE } }); // cascade patient + subjects + vaccinations
  };

  beforeAll(async () => {
    process.env.RECONCILE_TOKEN = TOKEN;
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();
    const user = await app.prisma.user.create({
      data: { phone: PHONE, role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Vac', lastName: 'Cin' } }, patient: { create: {} } },
    });
    userId = user.id;
    token = app.jwt.sign({ sub: user.id, role: 'PATIENT' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('ajoute un sujet et génère tout le calendrier PEV', async () => {
    // Naissance ancienne → toutes les doses sont en retard (utile pour les rappels).
    const res = await app.inject({
      method: 'POST', url: '/api/v1/vaccinations/subjects', headers: auth(token),
      payload: { name: 'Bébé Kossi', birthDate: '2024-01-01', isSelf: false },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('Bébé Kossi');
    expect(res.json().vaccinations.length).toBe(PEV_SCHEDULE.length);
    // Triées par échéance : la première est à la naissance (BCG/VPO0/HepB0).
    expect(['BCG', 'VPO0', 'HEPB0']).toContain(res.json().vaccinations[0].vaccineCode);
  });

  it('liste le carnet et marque une vaccination comme faite', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/vaccinations', headers: auth(token) });
    expect(list.statusCode).toBe(200);
    const vaccId = list.json()[0].vaccinations[0].id as string;

    const done = await app.inject({ method: 'POST', url: `/api/v1/vaccinations/${vaccId}/administered`, headers: auth(token), payload: { done: true } });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe('DONE');
    expect(done.json().administeredAt).not.toBeNull();
  });

  it('génère les rappels dus (retards) — idempotent par jour', async () => {
    const gen1 = await app.inject({ method: 'POST', url: '/api/v1/vaccinations/reminders/generate', headers: { 'x-service-token': TOKEN } });
    expect(gen1.statusCode).toBe(200);
    expect(gen1.json().generated).toBeGreaterThanOrEqual(1);
    // Une notification PENDING a bien été créée pour le patient.
    const notif = await app.prisma.notification.count({ where: { recipientId: userId, status: 'PENDING' } });
    expect(notif).toBeGreaterThanOrEqual(1);

    // Deuxième passage le même jour → rien de neuf (lastNotifiedOn du jour).
    const gen2 = await app.inject({ method: 'POST', url: '/api/v1/vaccinations/reminders/generate', headers: { 'x-service-token': TOKEN } });
    expect(gen2.json().generated).toBe(0);
  });

  it('rappels : rejette sans jeton de service (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/vaccinations/reminders/generate' });
    expect(res.statusCode).toBe(401);
  });

  it('cloisonnement §4 : marquer la vaccination d’un autre patient → 404', async () => {
    // Sujet appartenant à un AUTRE patient.
    const otherUser = await app.prisma.user.create({
      data: { phone: '+2290195500002', role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Autre', lastName: 'P' } }, patient: { create: {} } },
      include: { patient: true },
    });
    const subject = await app.prisma.vaccinationSubject.create({
      data: { patientId: otherUser.patient!.id, name: 'Enfant tiers', birthDate: new Date('2025-01-01'), vaccinations: { create: [{ vaccineCode: 'BCG', doseLabel: '', dueDate: new Date('2025-01-01') }] } },
      select: { vaccinations: { select: { id: true } } },
    });
    const foreignVaccId = subject.vaccinations[0].id;

    const res = await app.inject({ method: 'POST', url: `/api/v1/vaccinations/${foreignVaccId}/administered`, headers: auth(token), payload: { done: true } });
    expect(res.statusCode).toBe(404);

    await app.prisma.user.deleteMany({ where: { phone: '+2290195500002' } });
  });
});
