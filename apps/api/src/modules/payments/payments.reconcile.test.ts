// Test d'intégration de la réconciliation FedaPay (cron interne). CI uniquement.
// FedaPay n'étant pas configuré en test, on vérifie le balayage sûr (scanned, 0
// résolu, pas de crash) et la protection par jeton de service.
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE = '+22991000009';
const TOKEN = 'reconcile_test_token';

describe.skipIf(!HAS_INFRA)('Réconciliation FedaPay (intégration)', () => {
  let app: FastifyInstance;

  const cleanup = async () => {
    await app.prisma.payment.deleteMany({ where: { user: { phone: PHONE } } });
    await app.prisma.user.deleteMany({ where: { phone: PHONE } });
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
});
