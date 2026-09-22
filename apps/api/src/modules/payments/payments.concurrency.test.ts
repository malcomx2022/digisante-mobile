// ─────────────────────────────────────────────────────────────
// Re-test §5 (prompt 10, 22/09/2026) — livraisons CONCURRENTES du même webhook.
// FedaPay rejoue un webhook non acquitté (retries) ; la réconciliation de 02:30
// peut résoudre le même paiement ; l'API tourne en PM2 ×2. L'idempotence de
// `applyPaymentStatus` repose sur une LECTURE préalable du statut, suivie d'une
// mise à jour NON conditionnelle puis du crédit du portefeuille.
// MESURE AVANT CORRECTIF (22/09/2026, 5 exécutions) : 4 à 5 crédits pour 5
// livraisons — une recharge de 10 € créditée jusqu'à 5 fois. Refunds : même motif.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildWebhookSignatureHeader } from '@/services/fedapay.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE = '+2290190000091';
const WHSEC = 'whsec_test_concurrency';

describe.skipIf(!HAS_INFRA)('Paiements — webhooks concurrents (re-test §5)', () => {
  let app: FastifyInstance;
  let token: string;

  const cleanup = async () => {
    await app.prisma.payment.deleteMany({ where: { user: { phone: PHONE } } });
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });
    await app.prisma.integrationConfig.deleteMany({ where: { provider: 'FEDAPAY' } });
    await app.redis.del('integration:FEDAPAY');
  };

  beforeAll(async () => {
    process.env.FEDAPAY_WEBHOOK_SECRET = WHSEC;
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();
    const u = await app.prisma.user.create({
      data: { phone: PHONE, role: 'DIASPORA', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'C', lastName: 'C' } }, wallet: { create: {} } },
    });
    token = app.jwt.sign({ sub: u.id, role: 'DIASPORA' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  const deliver = (fedapayId: string) => {
    const body = JSON.stringify({ fedapayId, status: 'approved' });
    return app.inject({
      method: 'POST', url: '/api/v1/payments/webhook',
      headers: { 'content-type': 'application/json', 'x-fedapay-signature': buildWebhookSignatureHeader(body, WHSEC) },
      payload: body,
    });
  };

  it('5 livraisons simultanées d’un même webhook de recharge : UN SEUL crédit', async () => {
    const topup = await app.inject({ method: 'POST', url: '/api/v1/wallet/topup', headers: { authorization: `Bearer ${token}` }, payload: { amountEur: 10, method: 'VISA_MC' } });
    expect(topup.statusCode).toBe(200);
    const fedapayId = topup.json().payment.fedapayId as string;

    const results = await Promise.all(Array.from({ length: 5 }, () => deliver(fedapayId)));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);

    const credits = await app.prisma.walletTransaction.count({ where: { reference: topup.json().payment.id, type: 'TOPUP' } });
    const wallet = await app.inject({ method: 'GET', url: '/api/v1/wallet', headers: { authorization: `Bearer ${token}` } });
    expect(credits).toBe(1);
    expect(Number(wallet.json().balance)).toBe(6560);
  });

  it('remboursements admin simultanés : UN SEUL reversal', async () => {
    const topup = await app.inject({ method: 'POST', url: '/api/v1/wallet/topup', headers: { authorization: `Bearer ${token}` }, payload: { amountEur: 1, method: 'VISA_MC' } });
    const paymentId = topup.json().payment.id as string;
    await deliver(topup.json().payment.fedapayId as string);
    const payments = await import('./payments.service.js');
    const admin = await app.prisma.user.findUniqueOrThrow({ where: { phone: PHONE } });
    const results = await Promise.all(Array.from({ length: 4 }, () => payments.refund(app, paymentId, { actorId: admin.id })));
    expect(results.filter((r) => 'refunded' in r)).toHaveLength(1);
    const reversals = await app.prisma.walletTransaction.count({ where: { reference: paymentId, type: 'REFUND' } });
    expect(reversals).toBe(1);
  });
});
