// Tests d'intégration des PARCOURS de bout en bout (continuités inter-lots, P7.1).
// Vérifient que les modules s'enchaînent correctement. Si DB+Redis (CI).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildWebhookSignatureHeader } from '@/services/fedapay.js';
import { fedapayWebhookBody } from '@/test/fedapay-fixture.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290188000001', '+2290188000002', '+2290188000003'];
const WHSEC = 'whsec_journeys';

describe.skipIf(!HAS_INFRA)('Parcours de bout en bout (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let doctorToken: string;
  let pharmaToken: string;
  let patientId: string;
  let patientUserId: string;
  let doctorRecordId: string;

  const auth = (t: string, share?: string) => ({ authorization: `Bearer ${t}`, ...(share ? { 'x-share-token': share } : {}) });
  const sign = (b: string) => buildWebhookSignatureHeader(b, WHSEC);
  const cleanup = async () => {
    await app.prisma.payment.deleteMany({ where: { user: { phone: { in: PHONES } } } });
    await app.prisma.prescription.deleteMany({ where: { patient: { user: { phone: { in: PHONES } } } } });
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    // §5/Lot E : pas de config FedaPay en base → le webhook résout le secret depuis `.env`.
    await app.prisma.integrationConfig.deleteMany({ where: { provider: 'FEDAPAY' } });
    await app.redis.del('integration:FEDAPAY');
  };

  beforeAll(async () => {
    process.env.FEDAPAY_WEBHOOK_SECRET = WHSEC;
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const patient = await app.prisma.user.create({
      data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Aïcha', lastName: 'D' } }, patient: { create: { allergies: [] } } },
      include: { patient: true },
    });
    const doctor = await app.prisma.user.create({
      data: { phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Awa', lastName: 'K' } }, doctor: { create: { speciality: 'G', licenseNumber: 'BJ-MED-2001', consultFee: 5000, verifiedAt: new Date() } } },
      include: { doctor: true },
    });
    const pharma = await app.prisma.user.create({ data: { phone: PHONES[2], role: 'PHARMACIE', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Ph', lastName: 'X' } }, pharmacy: { create: { name: 'Pharmacie Test', address: 'Cotonou', phone: PHONES[2] } } } });

    patientId = patient.patient!.id;
    doctorRecordId = doctor.doctor!.id;
    patientUserId = patient.id;
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
    doctorToken = app.jwt.sign({ sub: doctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });
    pharmaToken = app.jwt.sign({ sub: pharma.id, role: 'PHARMACIE' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  it('Chaîne 1 : DMP saisi → partage consenti → lecture médecin (DMP_ACCESS)', async () => {
    const rec = await app.inject({ method: 'POST', url: '/api/v1/dmp/records', headers: auth(patientToken), payload: { type: 'VITAL_SIGNS', title: 'Tension', data: { bp: '15.1/9.2' } } });
    expect(rec.statusCode).toBe(201);
    const recordId = rec.json().id as string;

    const share = await app.inject({ method: 'POST', url: `/api/v1/dmp/records/${recordId}/share`, headers: auth(patientToken), payload: { shareType: 'QR_CODE', ttlHours: 24 } });
    const token = share.json().shareToken as string;

    const before = await app.prisma.auditLog.count({ where: { action: 'DMP_ACCESS' } });
    const read = await app.inject({ method: 'GET', url: `/api/v1/dmp/records?patientId=${patientId}`, headers: auth(doctorToken, token) });
    expect(read.statusCode).toBe(200);
    expect(read.json()[0].data.bp).toBe('15.1/9.2');
    const after = await app.prisma.auditLog.count({ where: { action: 'DMP_ACCESS' } });
    expect(after).toBeGreaterThan(before);
  });

  it('Chaîne 2 : ordonnance signée → scan pharmacie → délivrance synchronisée', async () => {
    const validUntil = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
    const presc = await app.inject({ method: 'POST', url: '/api/v1/prescriptions', headers: auth(doctorToken), payload: { patientId, validUntil, items: [{ medicationName: 'Paracétamol', dosage: '1g', frequency: '3x/j', duration: '5j' }] } });
    const qrCode = presc.json().qrCode as string;
    const prescId = presc.json().id as string;
    const itemId = presc.json().items[0].id as string;

    const scan = await app.inject({ method: 'POST', url: '/api/v1/pharmacy/scan', headers: auth(pharmaToken), payload: { qrCode } });
    expect(scan.json().authentic).toBe(true);

    await app.inject({ method: 'POST', url: `/api/v1/pharmacy/prescriptions/${prescId}/dispense`, headers: auth(pharmaToken), payload: { items: [{ itemId, status: 'DISPENSED' }] } });

    const mine = await app.inject({ method: 'GET', url: '/api/v1/prescriptions', headers: auth(patientToken) });
    expect(mine.json()[0].status).toBe('FULLY_DISPENSED');
  });

  it('Chaîne 3 : recharge wallet (webhook) → paiement de consultation par portefeuille → solde', async () => {
    const topup = await app.inject({ method: 'POST', url: '/api/v1/wallet/topup', headers: auth(patientToken), payload: { amountEur: 10, method: 'VISA_MC' } });
    const fedapayId = topup.json().payment.fedapayId as string;

    const body = fedapayWebhookBody(fedapayId, 'approved');
    const wh = await app.inject({ method: 'POST', url: '/api/v1/payments/webhook', headers: { 'content-type': 'application/json', 'x-fedapay-signature': sign(body) }, payload: body });
    expect(wh.json().processed).toBe(true);

    const w = await app.inject({ method: 'GET', url: '/api/v1/wallet', headers: auth(patientToken) });
    expect(Number(w.json().balance)).toBe(6560);

    // Le règlement passe par le CHEMIN DE PRODUCTION (`POST /payments`, méthode
    // WALLET) et non plus par `POST /wallet/pay`, retirée (écart E2) : elle
    // débitait sans rien régler, donc la chaîne « recharge → paiement » ne
    // testait pas le paiement réel. Le tarif est imposé par le serveur (5000).
    const appt = await app.prisma.appointment.create({
      data: { patientId, doctorId: doctorRecordId, type: 'TELECONSULTATION', status: 'CONFIRMED', scheduledAt: new Date(Date.now() + 86_400_000) },
      select: { id: true },
    });
    const pay = await app.inject({ method: 'POST', url: '/api/v1/payments', headers: auth(patientToken), payload: { type: 'CONSULTATION', method: 'WALLET', appointmentId: appt.id } });
    expect(pay.statusCode).toBe(201);
    expect(Number(pay.json().walletBalance)).toBe(1560);

    const audited = await app.prisma.auditLog.count({ where: { action: 'PAYMENT_CONFIRMED', actorId: patientUserId } });
    expect(audited).toBeGreaterThanOrEqual(1);
  });
});
