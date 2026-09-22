// Tests d'intégration Pharmacie + Laboratoire (via app.inject). Si DB+Redis (CI).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { linkCare } from '@/test/care-fixture.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290192000001', '+2290192000002', '+2290192000003', '+2290192000004'];

describe.skipIf(!HAS_INFRA)('Pharmacie & Laboratoire (intégration)', () => {
  let app: FastifyInstance;
  let doctorToken: string;
  let pharmacistToken: string;
  let labToken: string;
  let patientId: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const cleanup = async () => {
    await app.prisma.labOrder.deleteMany({ where: { patient: { user: { phone: { in: PHONES } } } } });
    await app.prisma.prescription.deleteMany({ where: { patient: { user: { phone: { in: PHONES } } } } });
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const patient = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Koffi', lastName: 'D' } }, patient: { create: { allergies: [] } } },
      include: { patient: true },
    });
    const doctor = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Awa', lastName: 'K' } }, doctor: { create: { speciality: 'Bio', licenseNumber: 'BJ-MED-5001', consultFee: 3000, verifiedAt: new Date() } } },
    });
    const pharma = await app.prisma.user.create({ data: { phone: PHONES[2], role: 'PHARMACIE', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Pharma', lastName: 'X' } }, pharmacy: { create: { name: 'Pharmacie Centrale', address: 'Cotonou', phone: PHONES[2] } } } });
    const labTech = await app.prisma.user.create({ data: { phone: PHONES[3], role: 'LABORATOIRE', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Labo', lastName: 'Y' } }, lab: { create: { name: 'Labo Central', address: 'Cotonou', phone: PHONES[3], servicesOffered: [] } } } });

    patientId = patient.patient!.id;
    doctorToken = app.jwt.sign({ sub: doctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });
    await linkCare(app, doctor.id, patientId);
    pharmacistToken = app.jwt.sign({ sub: pharma.id, role: 'PHARMACIE' }, { expiresIn: '15m' });
    labToken = app.jwt.sign({ sub: labTech.id, role: 'LABORATOIRE' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('Pharmacie : scan QR authentique → délivrance totale', async () => {
    const validUntil = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
    const presc = await app.inject({
      method: 'POST',
      url: '/api/v1/prescriptions',
      headers: auth(doctorToken),
      payload: { patientId, validUntil, items: [{ medicationName: 'Doliprane', dosage: '1g', frequency: '3x/j', duration: '5j' }] },
    });
    expect(presc.statusCode).toBe(201);
    const qrCode = presc.json().qrCode as string;
    const itemId = presc.json().items[0].id as string;

    const scan = await app.inject({ method: 'POST', url: '/api/v1/pharmacy/scan', headers: auth(pharmacistToken), payload: { qrCode } });
    expect(scan.statusCode).toBe(200);
    expect(scan.json().authentic).toBe(true);
    expect(scan.json().items[0].genericSuggestion).toBe('Paracétamol'); // Doliprane → DCI

    const bad = await app.inject({ method: 'POST', url: '/api/v1/pharmacy/scan', headers: auth(pharmacistToken), payload: { qrCode: 'x'.repeat(64) } });
    expect(bad.statusCode).toBe(404);

    const prescId = presc.json().id as string;
    const dispense = await app.inject({
      method: 'POST',
      url: `/api/v1/pharmacy/prescriptions/${prescId}/dispense`,
      headers: auth(pharmacistToken),
      payload: { items: [{ itemId, status: 'DISPENSED' }] },
    });
    expect(dispense.statusCode).toBe(200);
    expect(dispense.json().status).toBe('FULLY_DISPENSED');

    // Journal de dispensation : la délivrance est tracée pour CETTE pharmacie.
    const journal = await app.inject({ method: 'GET', url: '/api/v1/pharmacy/dispensations', headers: auth(pharmacistToken) });
    expect(journal.statusCode).toBe(200);
    const entries = journal.json();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].status).toBe('FULLY_DISPENSED');
    expect(entries[0].patient.firstName).toBe('Koffi');
  });

  it('Pharmacie : délivrance granulaire (un servi, un indisponible) → PARTIALLY_DISPENSED', async () => {
    const validUntil = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
    const presc = await app.inject({
      method: 'POST',
      url: '/api/v1/prescriptions',
      headers: auth(doctorToken),
      payload: {
        patientId,
        validUntil,
        items: [
          { medicationName: 'Amoxicilline', dosage: '500mg', frequency: '2x/j', duration: '7j' },
          { medicationName: 'Ibuprofène', dosage: '400mg', frequency: '3x/j', duration: '3j' },
        ],
      },
    });
    const prescId = presc.json().id as string;
    const [a, b] = presc.json().items as { id: string }[];

    const dispense = await app.inject({
      method: 'POST',
      url: `/api/v1/pharmacy/prescriptions/${prescId}/dispense`,
      headers: auth(pharmacistToken),
      payload: { items: [{ itemId: a.id, status: 'DISPENSED' }, { itemId: b.id, status: 'UNAVAILABLE' }] },
    });
    expect(dispense.statusCode).toBe(200);
    expect(dispense.json().status).toBe('PARTIALLY_DISPENSED');

    const journal = await app.inject({ method: 'GET', url: '/api/v1/pharmacy/dispensations', headers: auth(pharmacistToken) });
    const latest = journal.json()[0];
    expect(latest.status).toBe('PARTIALLY_DISPENSED');
    expect(latest.lines).toHaveLength(2);
  });

  it('Pharmacie : un compte sans profil pharmacie ne peut pas délivrer (403)', async () => {
    const orphan = await app.prisma.user.create({ data: { phone: PHONES[3].replace('4', '9'), role: 'PHARMACIE', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'No', lastName: 'Shop' } } } });
    const orphanToken = app.jwt.sign({ sub: orphan.id, role: 'PHARMACIE' }, { expiresIn: '15m' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/pharmacy/dispensations', headers: auth(orphanToken) });
    expect(res.statusCode).toBe(403);
    await app.prisma.user.delete({ where: { id: orphan.id } });
  });

  it('Laboratoire : résultat avec valeur critique → LAB_CRITICAL', async () => {
    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/lab/orders',
      headers: auth(doctorToken),
      payload: { patientId, testType: 'Glycémie' },
    });
    expect(order.statusCode).toBe(201);
    const orderId = order.json().id as string;

    // Le labo prend en charge la demande avant de pouvoir saisir un résultat.
    const claim = await app.inject({ method: 'POST', url: `/api/v1/lab/orders/${orderId}/claim`, headers: auth(labToken) });
    expect(claim.statusCode).toBe(200);

    const before = await app.prisma.auditLog.count({ where: { action: 'LAB_CRITICAL' } });
    const result = await app.inject({
      method: 'POST',
      url: `/api/v1/lab/orders/${orderId}/result`,
      headers: auth(labToken),
      payload: { values: { glucose: 0.3, potassium: 4.1 } },
    });
    expect(result.statusCode).toBe(201);
    expect(result.json().critical.length).toBeGreaterThanOrEqual(1);
    const after = await app.prisma.auditLog.count({ where: { action: 'LAB_CRITICAL' } });
    expect(after).toBe(before + 1);
  });
});
