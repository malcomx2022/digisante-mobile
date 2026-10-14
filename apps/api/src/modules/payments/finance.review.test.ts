// Revue L7 : conflits PostgreSQL réels et confirmation après annulation, sans fournisseur réel.
import { randomUUID } from 'node:crypto';
import type { Role } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setIntegration } from '@/lib/integrations.js';
import { buildWebhookSignatureHeader } from '@/services/fedapay.js';
import { fedapayWebhookBody } from '@/test/fedapay-fixture.js';
import * as finance from './finance.service.js';

const period = () => {
  const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  return { from: today, to: today };
};
const serializationError = (code: string, sqlCode?: string) => new Prisma.PrismaClientKnownRequestError('Conflit synthétique', {
  code, clientVersion: 'review-test', ...(sqlCode ? { meta: { code: sqlCode } } : {}),
});

describe('Revue L7 — limites de reprise des lectures', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([serializationError('P2034'), serializationError('P2010', '40001')])('borne les reprises d’un conflit de sérialisation', async (error) => {
    const transaction = vi.fn().mockRejectedValue(error);
    const app = { prisma: { $transaction: transaction } } as unknown as FastifyInstance;
    await expect(finance.stats(app, 'review-doctor', period())).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(3);
    for (const call of transaction.mock.calls) expect(call[1]).toEqual({ isolationLevel: 'RepeatableRead' });
  });
  it.each([new Error('Erreur métier'), serializationError('P2028'), serializationError('P2010', '23505')])('ne rejoue pas une erreur sans conflit de sérialisation', async (error) => {
    const transaction = vi.fn().mockRejectedValue(error);
    const app = { prisma: { $transaction: transaction } } as unknown as FastifyInstance;
    await expect(finance.stats(app, 'review-doctor', period())).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290195492001', '+2290195492002', '+2290195492003'];
const WHSEC = 'whsec_finance_review_synthetic';

describe.skipIf(!HAS_INFRA)('Revue L7 — lectures et anomalies intégrées', () => {
  let app: FastifyInstance;
  let doctorUser: string; let doctorId: string; let patientUser: string; let patientId: string; let adminUser: string;
  const auth = (sub = doctorUser, role: Role = 'MEDECIN') => ({ authorization: `Bearer ${app.jwt.sign({ sub, role }, { expiresIn: '15m' })}` });
  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    const doctor = await app.prisma.user.create({ data: { phone: PHONES[0]!, role: 'MEDECIN', status: 'ACTIVE',
      doctor: { create: { speciality: 'G', licenseNumber: randomUUID(), verifiedAt: new Date(), consultFee: 3000 } },
      wallet: { create: { balance: 50000 } } }, include: { doctor: true } });
    doctorUser = doctor.id; doctorId = doctor.doctor!.id;
    const patient = await app.prisma.user.create({ data: { phone: PHONES[1]!, role: 'PATIENT', status: 'ACTIVE', patient: { create: {} } }, include: { patient: true } });
    patientUser = patient.id; patientId = patient.patient!.id;
    adminUser = (await app.prisma.user.create({ data: { phone: PHONES[2]!, role: 'ADMIN', status: 'ACTIVE', adminProfile: { create: { scopes: ['finance:read'] } } } })).id;
    const buy = await app.inject({ method: 'POST', url: '/api/v1/subscriptions', headers: auth(), payload: { plan: 'PRO', method: 'WALLET', requestId: randomUUID() } });
    expect(buy.statusCode, buy.body).toBe(200);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (app) {
      await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
      await app.prisma.integrationConfig.deleteMany({ where: { provider: 'FEDAPAY' } });
      await app.redis.del('integration:FEDAPAY');
      await app.close();
    }
  });

  it('reprend le snapshot après modification concurrente du médecin avant FOR SHARE', async () => {
    const originalTransaction = app.prisma.$transaction.bind(app.prisma);
    let changed = false;
    const attempts: unknown[] = [];
    vi.spyOn(app.prisma, '$transaction').mockImplementation((async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) => {
      attempts.push(options);
      return originalTransaction(async (tx) => callback(new Proxy(tx, {
        get(target, property) {
          if (property === '$queryRaw') return async (...args: unknown[]) => {
            const sql = Array.isArray(args[0]) ? args[0].join('') : '';
            if (!changed && sql.includes('SELECT id FROM doctors') && sql.includes('FOR SHARE')) {
              changed = true;
              // Le snapshot existe déjà, mais aucun verrou Doctor n'a encore été pris.
              await app.prisma.doctor.update({ where: { id: doctorId }, data: { subscriptionCancelledAt: new Date() } });
            }
            return Reflect.apply(target.$queryRaw, target, args);
          };
          return Reflect.get(target, property);
        },
      })), options as Parameters<typeof originalTransaction>[1]);
    }) as typeof app.prisma.$transaction);
    const response = await app.inject({ method: 'GET', url: `/api/v1/professionals/me/revenue?${new URLSearchParams(period())}`, headers: auth() });
    expect(changed).toBe(true);
    expect(response.statusCode, response.body).toBe(200);
    expect(attempts).toEqual([{ isolationLevel: 'RepeatableRead' }, { isolationLevel: 'RepeatableRead' }]);
    expect(response.json().balance).toMatchObject({ due: '0', available: '0' });
  });

  it('signale la confirmation après annulation sans inventer un remboursement ni révéler son motif', async () => {
    await setIntegration(app, 'FEDAPAY', { secrets: { secretKey: 'sk_sandbox_finance_review', publicKey: 'pk_sandbox_finance_review', webhookSecret: WHSEC } });
    const create = async () => {
      const appointment = await app.prisma.appointment.create({ data: { patientId, doctorId, type: 'PHYSICAL', status: 'CONFIRMED', scheduledAt: new Date() } });
      const payment = await app.prisma.payment.create({ data: { userId: patientUser, appointmentId: appointment.id, type: 'CONSULTATION', method: 'MTN_MOMO', amount: 3000, fedapayId: `review-${randomUUID()}` } });
      return { appointment, payment };
    };
    const approve = async (fedapayId: string) => {
      const body = fedapayWebhookBody(fedapayId, 'approved');
      const response = await app.inject({ method: 'POST', url: '/api/v1/payments/webhook', payload: body,
        headers: { 'content-type': 'application/json', 'x-fedapay-signature': buildWebhookSignatureHeader(body, WHSEC) } });
      expect(response.statusCode, response.body).toBe(200);
    };
    const cancel = async (id: string) => {
      const response = await app.inject({ method: 'POST', url: `/api/v1/appointments/${id}/cancel`, headers: auth(), payload: { reason: 'motif médical privé de recette' } });
      expect(response.statusCode, response.body).toBe(200);
    };
    const late = await create();
    await cancel(late.appointment.id);
    await approve(late.payment.fedapayId!);
    const normal = await create();
    await approve(normal.payment.fedapayId!);
    const refunded = await create();
    await approve(refunded.payment.fedapayId!);
    await cancel(refunded.appointment.id);
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/finance/anomalies?pageSize=100', headers: auth(adminUser, 'ADMIN') });
    expect(response.statusCode, response.body).toBe(200);
    const ids = response.json().data.map((entry: { id: string }) => entry.id);
    expect(ids).toContain(late.payment.id);
    expect(ids).not.toContain(normal.payment.id);
    expect(ids).not.toContain(refunded.payment.id);
    expect(response.body).not.toMatch(/motif médical|cancelReason|patientId|phone|notes|triage/);
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: late.payment.id } })).status).toBe('COMPLETED');
    expect(await app.prisma.financeEntry.count({ where: { paymentId: late.payment.id, kind: 'REFUND' } })).toBe(0);
    expect(await app.prisma.financeOperation.count({ where: { requestId: `refund:${late.payment.id}` } })).toBe(0);
  });
});
