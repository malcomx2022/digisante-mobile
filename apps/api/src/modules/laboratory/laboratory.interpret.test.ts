// Test d'intégration de la boucle prescrire → résultat → interprétation médecin. CI uniquement.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { linkCare } from '@/test/care-fixture.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290193200001', '+2290193200002', '+2290193200003', '+2290193200004'];

describe.skipIf(!HAS_INFRA)('Interprétation des résultats (médecin, intégration)', () => {
  let app: FastifyInstance;
  let doctorToken: string;
  let otherDoctorToken: string;
  let labToken: string;
  let patientUserId: string;
  let patientId: string;
  let orderId: string;
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
      data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Ama', lastName: 'K' } }, patient: { create: {} } },
      include: { patient: true },
    });
    patientUserId = patient.id;
    patientId = patient.patient!.id;

    const doctor = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Dr', lastName: 'Presc' } }, doctor: { create: { speciality: 'Bio', licenseNumber: 'BJ-MED-8001', consultFee: 3000, verifiedAt: new Date() } } },
    });
    const otherDoctor = await app.prisma.user.create({
      data: { phone: PHONES[2], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Dr', lastName: 'Autre' } }, doctor: { create: { speciality: 'Bio', licenseNumber: 'BJ-MED-8002', consultFee: 3000, verifiedAt: new Date() } } },
    });
    const labTech = await app.prisma.user.create({
      data: { phone: PHONES[3], role: 'LABORATOIRE', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Lab', lastName: 'Z' } }, lab: { create: { name: 'Labo Z', address: 'Cotonou', phone: PHONES[3], servicesOffered: [] } } },
    });

    doctorToken = app.jwt.sign({ sub: doctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });
    await linkCare(app, doctor.id, patientId);
    otherDoctorToken = app.jwt.sign({ sub: otherDoctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });
    labToken = app.jwt.sign({ sub: labTech.id, role: 'LABORATOIRE' }, { expiresIn: '15m' });

    // Le médecin prescrit ; le labo prend en charge et publie un résultat.
    const order = await app.inject({ method: 'POST', url: '/api/v1/lab/orders', headers: auth(doctorToken), payload: { patientId, testType: 'Kaliémie' } });
    orderId = order.json().id as string;
    await app.inject({ method: 'POST', url: `/api/v1/lab/orders/${orderId}/claim`, headers: auth(labToken) });
    await app.inject({ method: 'POST', url: `/api/v1/lab/orders/${orderId}/result`, headers: auth(labToken), payload: { values: { potassium: 6.8 } } });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('le médecin prescripteur voit le résultat avec valeur critique recalculée', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/lab/results', headers: auth(doctorToken) });
    expect(res.statusCode).toBe(200);
    const row = res.json().find((r: { id: string }) => r.id === orderId);
    expect(row).toBeTruthy();
    expect(row.patient.firstName).toBe('Ama');
    expect(row.critical.map((c: { key: string }) => c.key)).toContain('potassium');
    expect(row.interpretation).toBeNull();
  });

  it('un autre médecin ne peut pas interpréter (non prescripteur → 403)', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/lab/orders/${orderId}/interpret`, headers: auth(otherDoctorToken), payload: { interpretation: 'RAS' } });
    expect(res.statusCode).toBe(403);
  });

  it('le prescripteur interprète : note enregistrée + patient notifié', async () => {
    const before = await app.prisma.notification.count({ where: { recipientId: patientUserId, type: 'LAB_RESULT' } });
    const res = await app.inject({ method: 'POST', url: `/api/v1/lab/orders/${orderId}/interpret`, headers: auth(doctorToken), payload: { interpretation: 'Hyperkaliémie : contrôle urgent.' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().interpretation).toContain('Hyperkaliémie');
    expect(res.json().interpretedAt).toBeTruthy();

    const after = await app.prisma.notification.count({ where: { recipientId: patientUserId, type: 'LAB_RESULT' } });
    expect(after).toBe(before + 1);

    // La fiche reflète l'interprétation.
    const list = await app.inject({ method: 'GET', url: '/api/v1/lab/results', headers: auth(doctorToken) });
    const row = list.json().find((r: { id: string }) => r.id === orderId);
    expect(row.interpretation).toContain('Hyperkaliémie');
  });
});
