// Tests d'intégration Paiements + Wallet + Abonnements (via app.inject). Si DB+Redis (CI).
import { createHmac } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290190000001', '+2290190000002'];
const WHSEC = 'whsec_test_p41';

describe.skipIf(!HAS_INFRA)('Paiements FedaPay & Wallet (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let doctorToken: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  const sign = (body: string) => createHmac('sha256', WHSEC).update(body).digest('hex');
  const cleanup = async () => {
    await app.prisma.payment.deleteMany({ where: { user: { phone: { in: PHONES } } } });
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
  };

  beforeAll(async () => {
    // Le secret webhook doit être présent AVANT le chargement de l'env.
    process.env.FEDAPAY_WEBHOOK_SECRET = WHSEC;
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const patient = await app.prisma.user.create({ data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'P', lastName: 'D' } }, patient: { create: {} } } });
    const doctor = await app.prisma.user.create({ data: { phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Dr', lastName: 'X' } }, doctor: { create: { speciality: 'G', licenseNumber: 'BJ-MED-3001', consultFee: 5000 } } } });
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
    doctorToken = app.jwt.sign({ sub: doctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  const webhook = (fedapayId: string, status = 'approved') => {
    const body = JSON.stringify({ fedapayId, status });
    return app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: { 'content-type': 'application/json', 'x-fedapay-signature': sign(body) },
      payload: body,
    });
  };

  it('initiation + webhook signé → COMPLETED (commission 3 %)', async () => {
    const init = await app.inject({ method: 'POST', url: '/api/v1/payments', headers: auth(patientToken), payload: { type: 'CONSULTATION', method: 'MTN_MOMO', amount: 5000 } });
    expect(init.statusCode).toBe(201);
    expect(init.json().commission).toBe(150);
    const fedapayId = init.json().payment.fedapayId as string;

    // Signature invalide → 401.
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: { 'content-type': 'application/json', 'x-fedapay-signature': 'invalide' },
      payload: JSON.stringify({ fedapayId, status: 'approved' }),
    });
    expect(bad.statusCode).toBe(401);

    const before = await app.prisma.auditLog.count({ where: { action: 'PAYMENT_CONFIRMED' } });
    const ok = await webhook(fedapayId);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().processed).toBe(true);
    const after = await app.prisma.auditLog.count({ where: { action: 'PAYMENT_CONFIRMED' } });
    expect(after).toBe(before + 1);

    // Idempotence : rejouer le webhook ne retraite pas.
    const dup = await webhook(fedapayId);
    expect(dup.json().idempotent).toBe(true);
    const after2 = await app.prisma.auditLog.count({ where: { action: 'PAYMENT_CONFIRMED' } });
    expect(after2).toBe(after); // pas de double confirmation
  });

  it('wallet : recharge € → FCFA créditée au webhook, puis débit', async () => {
    const topup = await app.inject({ method: 'POST', url: '/api/v1/wallet/topup', headers: auth(patientToken), payload: { amountEur: 10, method: 'VISA_MC' } });
    expect(topup.statusCode).toBe(200);
    expect(topup.json().amountXof).toBe(6560);
    const fedapayId = topup.json().payment.fedapayId as string;

    await webhook(fedapayId); // confirme la recharge → crédit

    const w1 = await app.inject({ method: 'GET', url: '/api/v1/wallet', headers: auth(patientToken) });
    expect(Number(w1.json().balance)).toBe(6560);

    const pay = await app.inject({ method: 'POST', url: '/api/v1/wallet/pay', headers: auth(patientToken), payload: { amount: 1000, description: 'Consultation proche' } });
    expect(pay.statusCode).toBe(200);
    expect(Number(pay.json().balance)).toBe(5560);
  });

  it('abonnement professionnel : souscription d’un plan', async () => {
    const sub = await app.inject({ method: 'POST', url: '/api/v1/subscriptions', headers: auth(doctorToken), payload: { plan: 'PRO' } });
    expect(sub.statusCode).toBe(200);
    expect(sub.json().subscriptionPlan).toBe('PRO');
  });
});
