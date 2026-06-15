// Test d'intégration de l'annuaire des médecins (filtre langue + fiche). CI uniquement.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+22995400001', '+22995400002', '+22995400003'];

describe.skipIf(!HAS_INFRA)('Annuaire médecins (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let patientId: string;
  let drFonId: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });

    const patient = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'P', lastName: 'D' } }, patient: { create: {} } },
      include: { patient: true },
    });
    patientId = patient.patient!.id;
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });

    const drFon = await app.prisma.user.create({
      data: {
        phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Koffi', lastName: 'Agbo', spokenLangs: ['FR', 'FON'] } },
        doctor: { create: { speciality: 'Cardiologie', licenseNumber: 'BJ-MED-9401', consultFee: 3000, bio: 'Cardiologue à Cotonou.', verifiedAt: new Date() } },
      },
      include: { doctor: true },
    });
    drFonId = drFon.doctor!.id;

    await app.prisma.user.create({
      data: {
        phone: PHONES[2], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Awa', lastName: 'Sani', spokenLangs: ['FR', 'EN'] } },
        doctor: { create: { speciality: 'Dermatologie', licenseNumber: 'BJ-MED-9402', consultFee: 3000, verifiedAt: new Date() } },
      },
    });
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await app.close();
  });

  it('filtre par langue parlée : ?lang=FON ne renvoie que le médecin parlant FON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/professionals?lang=FON', headers: auth(patientToken) });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.map((d: { profile: { firstName: string } }) => d.profile.firstName);
    expect(names).toContain('Koffi');
    expect(names).not.toContain('Awa');
  });

  it('?lang=EN ne renvoie que le médecin parlant EN', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/professionals?lang=EN', headers: auth(patientToken) });
    const names = res.json().data.map((d: { profile: { firstName: string } }) => d.profile.firstName);
    expect(names).toContain('Awa');
    expect(names).not.toContain('Koffi');
  });

  it('fiche détaillée : bio + langues parlées + badge vérifié', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/professionals/${drFonId}`, headers: auth(patientToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bio).toContain('Cardiologue');
    expect(body.profile.spokenLangs).toContain('FON');
    expect(body.isVerified).toBe(true);
  });

  it('avis : refusé sans consultation terminée, puis autorisé après', async () => {
    // Sans RDV terminé → 403.
    const denied = await app.inject({
      method: 'POST', url: `/api/v1/professionals/${drFonId}/reviews`, headers: auth(patientToken),
      payload: { rating: 5, comment: 'Excellent' },
    });
    expect(denied.statusCode).toBe(403);

    // Crée un RDV TERMINÉ entre le patient et ce médecin.
    await app.prisma.appointment.create({
      data: { patientId, doctorId: drFonId, type: 'TELECONSULTATION', status: 'COMPLETED', scheduledAt: new Date(Date.now() - 3600_000) },
    });

    const ok = await app.inject({
      method: 'POST', url: `/api/v1/professionals/${drFonId}/reviews`, headers: auth(patientToken),
      payload: { rating: 5, comment: 'Très à l’écoute' },
    });
    expect(ok.statusCode).toBe(201);

    // Résumé : moyenne 5, 1 avis.
    const list = await app.inject({ method: 'GET', url: `/api/v1/professionals/${drFonId}/reviews`, headers: auth(patientToken) });
    expect(list.json().summary.average).toBe(5);
    expect(list.json().summary.count).toBe(1);

    // La fiche reflète la note + canReview.
    const detail = await app.inject({ method: 'GET', url: `/api/v1/professionals/${drFonId}`, headers: auth(patientToken) });
    expect(detail.json().rating.average).toBe(5);
    expect(detail.json().canReview).toBe(true);

    // L'annuaire affiche la note moyenne.
    const dir = await app.inject({ method: 'GET', url: '/api/v1/professionals?lang=FON', headers: auth(patientToken) });
    const item = dir.json().data.find((d: { id: string }) => d.id === drFonId);
    expect(item.rating.average).toBe(5);
  });
});
