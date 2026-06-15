// Test d'intégration de l'inbox laboratoire (pool anonymisé, prise en charge,
// transition de statut, appartenance du résultat, notif patient). CI uniquement.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+22993100001', '+22993100002', '+22993100003', '+22993100004'];

describe.skipIf(!HAS_INFRA)('Inbox laboratoire (intégration)', () => {
  let app: FastifyInstance;
  let doctorToken: string;
  let labToken: string;
  let otherLabToken: string;
  let patientUserId: string;
  let patientId: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  const cleanup = async () => {
    await app.prisma.labOrder.deleteMany({ where: { patient: { user: { phone: { in: PHONES } } } } });
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const patient = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Sika', lastName: 'A' } }, patient: { create: {} } },
      include: { patient: true },
    });
    patientUserId = patient.id;
    patientId = patient.patient!.id;

    const doctor = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Dr', lastName: 'B' } }, doctor: { create: { speciality: 'Bio', licenseNumber: 'BJ-MED-7001', consultFee: 3000, verifiedAt: new Date() } } },
    });
    const labTech = await app.prisma.user.create({
      data: { phone: PHONES[2], role: 'LABORATOIRE', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Lab', lastName: 'One' } }, lab: { create: { name: 'Labo 1', address: 'Cotonou', phone: PHONES[2], servicesOffered: [] } } },
    });
    const otherLab = await app.prisma.user.create({
      data: { phone: PHONES[3], role: 'LABORATOIRE', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Lab', lastName: 'Two' } }, lab: { create: { name: 'Labo 2', address: 'Porto-Novo', phone: PHONES[3], servicesOffered: [] } } },
    });

    doctorToken = app.jwt.sign({ sub: doctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });
    labToken = app.jwt.sign({ sub: labTech.id, role: 'LABORATOIRE' }, { expiresIn: '15m' });
    otherLabToken = app.jwt.sign({ sub: otherLab.id, role: 'LABORATOIRE' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('cycle complet : pool anonymisé → prise en charge → transition → résultat → notif patient', async () => {
    // Le médecin prescrit une analyse (PENDING, non assignée).
    const order = await app.inject({ method: 'POST', url: '/api/v1/lab/orders', headers: auth(doctorToken), payload: { patientId, testType: 'Glycémie' } });
    expect(order.statusCode).toBe(201);
    const orderId = order.json().id as string;

    // Pool disponible : la demande apparaît SANS identité patient (§4).
    const available = await app.inject({ method: 'GET', url: '/api/v1/lab/orders/available', headers: auth(labToken) });
    expect(available.statusCode).toBe(200);
    const pooled = available.json().find((o: { id: string }) => o.id === orderId);
    expect(pooled).toBeTruthy();
    expect(pooled.testType).toBe('Glycémie');
    expect(pooled.patient).toBeUndefined();

    // Prise en charge → SAMPLE_COLLECTED.
    const claim = await app.inject({ method: 'POST', url: `/api/v1/lab/orders/${orderId}/claim`, headers: auth(labToken) });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().status).toBe('SAMPLE_COLLECTED');

    // Le pool ne la contient plus ; l'inbox la contient AVEC le nom patient.
    const availAfter = await app.inject({ method: 'GET', url: '/api/v1/lab/orders/available', headers: auth(labToken) });
    expect(availAfter.json().find((o: { id: string }) => o.id === orderId)).toBeUndefined();
    const incoming = await app.inject({ method: 'GET', url: '/api/v1/lab/orders/incoming', headers: auth(labToken) });
    const mine = incoming.json().find((o: { id: string }) => o.id === orderId);
    expect(mine.patient.firstName).toBe('Sika');

    // Un AUTRE labo ne peut pas saisir le résultat (appartenance).
    const denied = await app.inject({ method: 'POST', url: `/api/v1/lab/orders/${orderId}/result`, headers: auth(otherLabToken), payload: { values: { glucose: 1.0 } } });
    expect(denied.statusCode).toBe(403);

    // Transition SAMPLE_COLLECTED → PROCESSING.
    const advance = await app.inject({ method: 'POST', url: `/api/v1/lab/orders/${orderId}/advance`, headers: auth(labToken) });
    expect(advance.json().status).toBe('PROCESSING');

    // Saisie du résultat → COMPLETED + notification patient « résultat prêt ».
    const notifBefore = await app.prisma.notification.count({ where: { recipientId: patientUserId, type: 'LAB_RESULT' } });
    const result = await app.inject({ method: 'POST', url: `/api/v1/lab/orders/${orderId}/result`, headers: auth(labToken), payload: { values: { glucose: 1.0 } } });
    expect(result.statusCode).toBe(201);
    const notifAfter = await app.prisma.notification.count({ where: { recipientId: patientUserId, type: 'LAB_RESULT' } });
    expect(notifAfter).toBe(notifBefore + 1);

    // Une nouvelle prise en charge de la même demande échoue (déjà assignée).
    const reclaim = await app.inject({ method: 'POST', url: `/api/v1/lab/orders/${orderId}/claim`, headers: auth(otherLabToken) });
    expect(reclaim.statusCode).toBe(400);
  });

  it('un compte laboratoire sans profil lab ne peut pas accéder au pool (403)', async () => {
    const orphan = await app.prisma.user.create({ data: { phone: '+22993100009', role: 'LABORATOIRE', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'No', lastName: 'Lab' } } } });
    const orphanToken = app.jwt.sign({ sub: orphan.id, role: 'LABORATOIRE' }, { expiresIn: '15m' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/lab/orders/available', headers: auth(orphanToken) });
    expect(res.statusCode).toBe(403);
    await app.prisma.user.delete({ where: { id: orphan.id } });
  });
});
