// Droits QR, concurrence et atomicité de la délivrance, sur DB/Redis synthétiques.
import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { env } from '@/lib/env.js';
import { computeSignature } from '@/modules/prescriptions/prescriptions.service.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe.skipIf(!HAS_INFRA)('Pharmacie — délivrance protégée', () => {
  let app: FastifyInstance;
  let doctorId: string;
  let patientId: string;
  let recipientIds: string[];
  let pharmacyTokens: string[];
  let pharmacyIds: string[];
  let failAt: 'Dispensation' | 'Notification' | null = null;
  const userIds: string[] = [];
  const licenseNumber = 'BJ-TST-' + Date.now();

  const prescription = async (count = 1) => {
    const record = await app.prisma.prescription.create({ data: {
      doctorId, patientId, validUntil: new Date(Date.now() + 86400_000),
      items: { create: Array.from({ length: count }, (_, i) => ({ medicationName: `Synthétique ${i}`, dosage: 'Synthétique', frequency: 'Synthétique', duration: 'Synthétique' })) },
    }, include: { items: true } });
    const qrCode = computeSignature(record.id, licenseNumber, env.JWT_SECRET);
    return app.prisma.prescription.update({ where: { id: record.id }, data: { qrCode }, include: { items: true } });
  };
  const dispense = (id: string, qrCode: string | undefined, items: { itemId: string; status: string }[], pharmacy = 0) => app.inject({
    method: 'POST', url: `/api/v1/pharmacy/prescriptions/${id}/dispense`,
    headers: { authorization: `Bearer ${pharmacyTokens[pharmacy]}` }, payload: { ...(qrCode === undefined ? {} : { qrCode }), items },
  });
  const notificationCount = () => app.prisma.notification.count({ where: { recipientId: { in: recipientIds }, type: 'PRESCRIPTION_READY' } });
  const unchanged = async (id: string) => {
    const record = await app.prisma.prescription.findUniqueOrThrow({ where: { id }, include: { items: true } });
    expect(record.status).toBe('ACTIVE');
    expect(record.items.every((item) => item.status === 'PENDING')).toBe(true);
    expect(await app.prisma.dispensation.count({ where: { prescriptionId: id } })).toBe(0);
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    app.prisma.$use(async (params, next) => {
      if (params.model === failAt && ['create', 'createMany'].includes(params.action)) throw new Error('Panne synthétique de délivrance');
      return next(params);
    });
    const patient = await app.prisma.user.create({ data: { phone: '+' + randomUUID(), role: 'PATIENT', status: 'ACTIVE', patient: { create: {} } }, include: { patient: true } });
    userIds.push(patient.id);
    patientId = patient.patient!.id;
    const doctor = await app.prisma.user.create({ data: { phone: '+' + randomUUID(), role: 'MEDECIN', status: 'ACTIVE', doctor: { create: { speciality: 'Synthétique', licenseNumber, verifiedAt: new Date(), consultFee: 0 } } }, include: { doctor: true } });
    userIds.push(doctor.id);
    doctorId = doctor.doctor!.id;
    recipientIds = [patient.id, doctor.id];
    pharmacyTokens = [];
    pharmacyIds = [];
    for (let i = 0; i < 2; i++) {
      const phone = '+' + randomUUID();
      const pharmacy = await app.prisma.user.create({ data: { phone, role: 'PHARMACIE', status: 'ACTIVE', pharmacy: { create: { name: 'Synthétique', address: 'Synthétique', phone } } }, include: { pharmacy: true } });
      userIds.push(pharmacy.id);
      pharmacyIds.push(pharmacy.pharmacy!.id);
      pharmacyTokens.push(app.jwt.sign({ sub: pharmacy.id, role: 'PHARMACIE' }, { expiresIn: '15m' }));
    }
  });
  afterEach(() => { failAt = null; });
  afterAll(async () => {
    if (!app) return;
    await app.prisma.prescription.deleteMany({ where: { patientId } });
    await app.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('connaître les IDs ne suffit pas : QR absent refusé sans effet', async () => {
    const record = await prescription();
    const before = await notificationCount();
    expect((await dispense(record.id, undefined, [{ itemId: record.items[0].id, status: 'DISPENSED' }])).statusCode).toBe(422);
    await unchanged(record.id);
    expect(await notificationCount()).toBe(before);
  });
  it('QR incorrect ou authentique pour une autre ordonnance : refus sans effet', async () => {
    const record = await prescription();
    const other = await prescription();
    const items = [{ itemId: record.items[0].id, status: 'DISPENSED' }];
    const before = await notificationCount();
    expect((await dispense(record.id, '0'.repeat(64), items)).statusCode).toBe(403);
    expect((await dispense(record.id, other.qrCode!, items)).statusCode).toBe(403);
    await unchanged(record.id);
    expect(await notificationCount()).toBe(before);
  });
  it('QR stocké altéré : correspondance en base seule ne suffit pas sans signature', async () => {
    const record = await prescription();
    const qrCode = '0'.repeat(64);
    await app.prisma.prescription.update({ where: { id: record.id }, data: { qrCode } });
    expect((await dispense(record.id, qrCode, [{ itemId: record.items[0].id, status: 'DISPENSED' }])).statusCode).toBe(403);
    await unchanged(record.id);
  });
  it('QR précédemment lu puis remplacé : ancien jeton refusé', async () => {
    const record = await prescription();
    await app.prisma.prescription.update({ where: { id: record.id }, data: { qrCode: '1'.repeat(64) } });
    expect((await dispense(record.id, record.qrCode!, [{ itemId: record.items[0].id, status: 'DISPENSED' }])).statusCode).toBe(403);
    await unchanged(record.id);
  });
  it('deux pharmacies concurrentes : une seule délivrance, un journal et deux notifications', async () => {
    const record = await prescription();
    const before = await notificationCount();
    const items = [{ itemId: record.items[0].id, status: 'DISPENSED' }];
    const responses = await Promise.all([dispense(record.id, record.qrCode!, items, 0), dispense(record.id, record.qrCode!, items, 1)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400]);
    const entries = await app.prisma.dispensation.findMany({ where: { prescriptionId: record.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].pharmacyId).toBe(pharmacyIds[responses[0].statusCode === 200 ? 0 : 1]);
    expect((await app.prisma.prescription.findUniqueOrThrow({ where: { id: record.id } })).status).toBe('FULLY_DISPENSED');
    expect(await notificationCount()).toBe(before + 2);
  });
  for (const model of ['Dispensation', 'Notification'] as const) {
    it(`panne ${model} : lignes, ordonnance, journal et notifications annulés ensemble`, async () => {
      const record = await prescription();
      const before = await notificationCount();
      failAt = model;
      expect((await dispense(record.id, record.qrCode!, [{ itemId: record.items[0].id, status: 'DISPENSED' }])).statusCode).toBe(500);
      failAt = null;
      await unchanged(record.id);
      expect(await notificationCount()).toBe(before);
      expect((await dispense(record.id, record.qrCode!, [{ itemId: record.items[0].id, status: 'DISPENSED' }])).statusCode).toBe(200);
    });
  }
  it('IDs de ligne dupliqués : refus de toute la mutation', async () => {
    const record = await prescription();
    expect((await dispense(record.id, record.qrCode!, [
      { itemId: record.items[0].id, status: 'DISPENSED' },
      { itemId: record.items[0].id, status: 'UNAVAILABLE' },
    ])).statusCode).toBe(422);
    await unchanged(record.id);
  });
  it('ligne déjà délivrée : ni nouvelle délivrance ni régression, les autres lignes restent disponibles', async () => {
    const record = await prescription(2);
    const [first, second] = record.items;
    expect((await dispense(record.id, record.qrCode!, [{ itemId: first.id, status: 'DISPENSED' }])).statusCode).toBe(200);
    for (const status of ['DISPENSED', 'UNAVAILABLE', 'PARTIALLY_DISPENSED']) {
      expect((await dispense(record.id, record.qrCode!, [{ itemId: first.id, status }, { itemId: second.id, status: 'DISPENSED' }])).statusCode).toBe(400);
    }
    const partial = await app.prisma.prescription.findUniqueOrThrow({ where: { id: record.id }, include: { items: true } });
    expect(partial.status).toBe('PARTIALLY_DISPENSED');
    expect(partial.items.find((item) => item.id === first.id)!.status).toBe('DISPENSED');
    expect(partial.items.find((item) => item.id === second.id)!.status).toBe('PENDING');
    expect(await app.prisma.dispensation.count({ where: { prescriptionId: record.id } })).toBe(1);
    expect((await dispense(record.id, record.qrCode!, [{ itemId: second.id, status: 'DISPENSED' }], 1)).statusCode).toBe(200);
    expect((await app.prisma.prescription.findUniqueOrThrow({ where: { id: record.id } })).status).toBe('FULLY_DISPENSED');
  });
  it('expiration courante contrôlée avant la délivrance', async () => {
    const record = await prescription();
    await app.prisma.prescription.update({ where: { id: record.id }, data: { validUntil: new Date(Date.now() - 1) } });
    expect((await dispense(record.id, record.qrCode!, [{ itemId: record.items[0].id, status: 'DISPENSED' }])).statusCode).toBe(400);
    await unchanged(record.id);
  });
});
