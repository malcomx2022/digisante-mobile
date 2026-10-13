// Test d'intégration de la réconciliation FedaPay (cron interne). CI uniquement.
// FedaPay n'étant pas configuré en test, on vérifie le balayage sûr (scanned, 0
// résolu, pas de crash) et la protection par jeton de service.
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as audit from '@/lib/audit.js';
import { buildWebhookSignatureHeader } from '@/services/fedapay.js';
import { fedapayWebhookBody } from '@/test/fedapay-fixture.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE = '+2290191000009';
const TOKEN = 'reconcile_test_token';

describe.skipIf(!HAS_INFRA)('Réconciliation FedaPay (intégration)', () => {
  let app: FastifyInstance;

  const cleanup = async () => {
    await app.prisma.payment.deleteMany({ where: { user: { phone: PHONE } } });
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });
    // §5/Lot E : pas de config FedaPay en base → balayage seul (résolu 0).
    await app.prisma.integrationConfig.deleteMany({ where: { provider: 'FEDAPAY' } });
    await app.redis.del('integration:FEDAPAY');
  };

  beforeAll(async () => {
    // Le jeton de service doit être présent AVANT le chargement de l'env.
    process.env.RECONCILE_TOKEN = TOKEN;
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const user = await app.prisma.user.create({
      data: {
        phone: PHONE, role: 'PATIENT', status: 'ACTIVE', lang: 'FR',
        profile: { create: { firstName: 'Recon', lastName: 'Cile' } },
        patient: { create: {} },
      },
    });
    // Paiement PENDING ancien (> 1 h) → éligible au balayage.
    await app.prisma.payment.create({
      data: {
        userId: user.id, type: 'CONSULTATION', method: 'MTN_MOMO',
        amount: new Prisma.Decimal(5000), currency: 'XOF', status: 'PENDING',
        fedapayId: 'fdp_recon_test', createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('balaye les paiements PENDING anciens (FedaPay non configuré → resolved 0)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/reconcile',
      headers: { 'x-service-token': TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().scanned).toBeGreaterThanOrEqual(1);
    expect(res.json().resolved).toBe(0); // pas de résolution sans API configurée
    // Le paiement reste PENDING (non résolu).
    const p = await app.prisma.payment.findFirst({ where: { fedapayId: 'fdp_recon_test' }, select: { status: true } });
    expect(p?.status).toBe('PENDING');
  });

  it('rejette sans jeton de service (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/payments/reconcile' });
    expect(res.statusCode).toBe(401);
  });

  it('rattrape PROCESSING après webhook pending, sans retraiter les terminaux ni les paiements récents', async () => {
    const { setIntegration } = await import('@/lib/integrations.js');
    const secret = 'whsec_test_reconcile_processing';
    await setIntegration(app, 'FEDAPAY', { secrets: { secretKey: 'sk_sandbox_test_reconcile', publicKey: 'pk_sandbox_test_reconcile', webhookSecret: secret } });
    const user = await app.prisma.user.findUniqueOrThrow({ where: { phone: PHONE } });
    const old = new Date(Date.now() - 2 * 3600_000);
    const payment = await app.prisma.payment.create({
      data: { userId: user.id, type: 'WALLET_TOPUP', method: 'MTN_MOMO', amount: 200, status: 'PENDING', fedapayId: 'fdp_processing_recon', createdAt: old },
    });
    const body = fedapayWebhookBody(payment.fedapayId!, 'pending');
    const pending = await app.inject({
      method: 'POST', url: '/api/v1/payments/webhook', payload: body,
      headers: { 'content-type': 'application/json', 'x-fedapay-signature': buildWebhookSignatureHeader(body, secret) },
    });
    expect(pending.statusCode).toBe(200);
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PROCESSING');
    for (const status of ['COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED'] as const) {
      await app.prisma.payment.create({
        data: { userId: user.id, type: 'CONSULTATION', method: 'MTN_MOMO', amount: 200, status, fedapayId: `fdp_excluded_${status}`, createdAt: old },
      });
    }
    await app.prisma.payment.create({
      data: { userId: user.id, type: 'CONSULTATION', method: 'MTN_MOMO', amount: 200, status: 'PROCESSING', fedapayId: 'fdp_excluded_recent' },
    });
    await app.prisma.payment.create({
      data: { userId: user.id, type: 'CONSULTATION', method: 'WALLET', amount: 200, status: 'PENDING', createdAt: old },
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify({
      'v1/transaction': { status: String(url).endsWith('/fdp_processing_recon') ? 'approved' : 'pending' },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const run = () => app.inject({ method: 'POST', url: '/api/v1/payments/reconcile', headers: { 'x-service-token': TOKEN } });
    const first = await run();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ resolved: 1, failed: 0 });
    expect((await run()).json().resolved).toBe(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('fdp_excluded_'))).toBe(false);
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('COMPLETED');
    expect(Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).balance)).toBe(200);
    expect(await app.prisma.walletTransaction.count({ where: { reference: payment.id, type: 'TOPUP' } })).toBe(1);
  });

  // B2 (revue indépendante 13/10/2026) : une exception sur UN paiement (P2028,
  // interblocage, conflit d'activation L6/capture L7…) interrompait tout le lot —
  // les paiements suivants n'étaient jamais réconciliés. Le lot se poursuit
  // désormais, MAIS la réponse reste non 2xx (500 + compteurs) dès qu'un paiement
  // échoue : `fedapay_reconcile.sh` journalise alors ÉCHEC et sort 1, et la sonde
  // `cron` de healthwatch alerte dès 1 échec. Un 200 `{ failed: 1 }` rendrait
  // silencieux un paiement débité chez FedaPay et resté PENDING (la sonde
  // `providers` n'alerte qu'à partir de 3 lignes par passage).
  it('un paiement en échec n’interrompt plus le lot : les suivants sont résolus, l’échec est compté, signalé (non 2xx) puis repris', async () => {
    const { setIntegration } = await import('@/lib/integrations.js');
    await setIntegration(app, 'FEDAPAY', { secrets: { secretKey: 'sk_sandbox_test_reconcile', publicKey: 'pk_sandbox_test_reconcile', webhookSecret: 'whsec_test_reconcile_b2' } });
    const user = await app.prisma.user.findUniqueOrThrow({ where: { phone: PHONE } });
    const make = (fedapayId: string, hoursAgo: number) => app.prisma.payment.create({
      data: { userId: user.id, type: 'WALLET_TOPUP', method: 'MTN_MOMO', amount: 300, status: 'PENDING', fedapayId, createdAt: new Date(Date.now() - hoursAgo * 3600_000) },
    });
    const failing = await make('fdp_b2_recon_first', 5); // le plus ancien : traité en premier
    const next = await make('fdp_b2_recon_next', 4);
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify({
      'v1/transaction': { status: /fdp_b2_recon_/.test(String(url)) ? 'approved' : 'pending' },
    }), { status: 200 })));
    await app.prisma.wallet.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    const balance = async () => Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).balance);
    const before = await balance();
    const errors = vi.spyOn(app.log, 'error');
    // L'audit transactionnel du PREMIER paiement résolu échoue : sa transaction est annulée.
    const auditFailure = vi.spyOn(audit, 'writeAuditWithin').mockRejectedValueOnce(new Error('B2 simulated failure'));
    try {
      const run = await app.inject({ method: 'POST', url: '/api/v1/payments/reconcile', headers: { 'x-service-token': TOKEN } });
      // Échec signalé au déclencheur cron : non 2xx, compteurs dans le corps.
      expect(run.statusCode).toBe(500);
      expect(run.json()).toMatchObject({ code: 'RECONCILE_PARTIAL_FAILURE', resolved: 1, failed: 1 });
      // Corps minimal : compteurs seulement, ni identifiant ni erreur interne.
      expect(Object.keys(run.json()).sort()).toEqual(['code', 'failed', 'message', 'resolved', 'scanned']);
      expect(run.body).not.toContain(failing.id);
      expect(run.body).not.toContain('B2 simulated failure');
    } finally {
      auditFailure.mockRestore();
    }
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: failing.id } })).status).toBe('PENDING');
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('COMPLETED');
    expect(await balance()).toBe(before + 300);
    expect(await app.prisma.walletTransaction.count({ where: { reference: failing.id } })).toBe(0);
    // Journal : identifiant du paiement + erreur sérialisée, sans charge utile.
    const call = errors.mock.calls.find(([obj]) => (obj as { job?: string })?.job === 'reconcile');
    expect(call?.[0]).toMatchObject({ paymentId: failing.id, job: 'reconcile' });
    expect(call?.[1]).toBe('[FedaPay] réconciliation : paiement en échec, lot poursuivi');
    errors.mockRestore();

    // Passage suivant : le paiement en échec est repris, une seule fois.
    const again = await app.inject({ method: 'POST', url: '/api/v1/payments/reconcile', headers: { 'x-service-token': TOKEN } });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ resolved: 1, failed: 0 });
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: failing.id } })).status).toBe('COMPLETED');
    expect(await balance()).toBe(before + 600);
    expect(await app.prisma.walletTransaction.count({ where: { reference: { in: [failing.id, next.id] }, type: 'TOPUP' } })).toBe(2);
  });
});
