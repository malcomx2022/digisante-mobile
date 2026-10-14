// §5 revu : statut RDV, remboursement atomique et courses ; fournisseurs uniquement simulés.
import { randomUUID } from 'node:crypto';
import type { Role } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as audit from '@/lib/audit.js';
import { setIntegration } from '@/lib/integrations.js';
import * as wallet from '@/modules/wallet/wallet.service.js';
import { buildWebhookSignatureHeader } from '@/services/fedapay.js';
import { fedapayWebhookBody } from '@/test/fedapay-fixture.js';
import * as payments from './payments.service.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290195493001', '+2290195493002', '+2290195493003'];
const WHSEC = 'whsec_appointment_review_synthetic';
const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
};

describe.skipIf(!HAS_INFRA)('Revue §5 — paiements et annulation du RDV', () => {
  let app: FastifyInstance;
  let doctorUser: string; let doctorId: string; let patientUser: string; let patientId: string; let adminUser: string;
  const auth = (sub = patientUser, role: Role = 'PATIENT') => ({ authorization: `Bearer ${app.jwt.sign({ sub, role }, { expiresIn: '15m' })}` });
  const appointment = (status: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' = 'CONFIRMED') => app.prisma.appointment.create({ data: { patientId, doctorId, type: 'PHYSICAL', status, scheduledAt: new Date() } });
  const pay = (id: string, method: 'WALLET' | 'MTN_MOMO' = 'WALLET') => app.inject({ method: 'POST', url: '/api/v1/payments', headers: auth(), payload: { type: 'CONSULTATION', method, appointmentId: id } });
  const cancel = (id: string, sub = doctorUser, role: Role = 'MEDECIN') => app.inject({ method: 'POST', url: `/api/v1/appointments/${id}/cancel`, headers: auth(sub, role), payload: { reason: 'Indisponibilité de recette' } });
  const balance = async () => Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: patientUser } })).balance);
  const approve = async (fedapayId: string) => {
    const body = fedapayWebhookBody(fedapayId, 'approved');
    const response = await app.inject({ method: 'POST', url: '/api/v1/payments/webhook', payload: body,
      headers: { 'content-type': 'application/json', 'x-fedapay-signature': buildWebhookSignatureHeader(body, WHSEC) } });
    expect(response.statusCode, response.body).toBe(200);
  };
  beforeAll(async () => { const { buildServer } = await import('@/server.js'); app = await buildServer(); await app.ready(); });
  beforeEach(async () => {
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    const doctor = await app.prisma.user.create({ data: { phone: PHONES[0]!, role: 'MEDECIN', status: 'ACTIVE',
      doctor: { create: { speciality: 'G', licenseNumber: randomUUID(), verifiedAt: new Date(), consultFee: 3000 } } }, include: { doctor: true } });
    doctorUser = doctor.id; doctorId = doctor.doctor!.id;
    const patient = await app.prisma.user.create({ data: { phone: PHONES[1]!, role: 'PATIENT', status: 'ACTIVE', patient: { create: {} }, wallet: { create: { balance: 10000 } } }, include: { patient: true } });
    patientUser = patient.id; patientId = patient.patient!.id;
    adminUser = (await app.prisma.user.create({ data: { phone: PHONES[2]!, role: 'ADMIN', status: 'ACTIVE', adminProfile: { create: { scopes: ['finance:write', 'finance:read'] } } } })).id;
    await setIntegration(app, 'FEDAPAY', { secrets: { secretKey: 'sk_sandbox_appointment_review', publicKey: 'pk_sandbox_appointment_review', webhookSecret: WHSEC } });
    const upstreamId = `review-${randomUUID()}`;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).endsWith('/token')
      ? new Response(JSON.stringify({ url: 'https://sandbox-process.fedapay.com/review-synthetic-token' }))
      : new Response(JSON.stringify({ 'v1/transaction': { id: upstreamId } })));
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

  it.each([
    ['CANCELLED', 'WALLET'], ['COMPLETED', 'WALLET'],
    ['CANCELLED', 'MTN_MOMO'], ['COMPLETED', 'MTN_MOMO'],
  ] as const)('refuse %s par %s avant débit, fournisseur, paiement ou audit', async (status, method) => {
    const appt = await appointment(status);
    const response = await pay(appt.id, method);
    expect(response.statusCode, response.body).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(await balance()).toBe(10000);
    expect(await app.prisma.payment.count({ where: { appointmentId: appt.id } })).toBe(0);
    expect(await app.prisma.walletTransaction.count({ where: { wallet: { userId: patientUser } } })).toBe(0);
    expect(await app.prisma.financeEntry.count({ where: { doctorId } })).toBe(0);
    expect(await app.prisma.auditLog.count({ where: { actorId: patientUser, action: 'PAYMENT_CONFIRMED' } })).toBe(0);
  });

  it('échec du crédit : ni RDV annulé, ni remboursement partiel ; nouvelle tentative possible', async () => {
    const appt = await appointment();
    const bought = await pay(appt.id); expect(bought.statusCode, bought.body).toBe(201);
    const paymentId = bought.json().payment.id as string;
    const failed = vi.spyOn(wallet, 'creditWithin').mockRejectedValueOnce(new Error('review synthetic credit failure'));
    expect((await cancel(appt.id)).statusCode).toBe(500);
    failed.mockRestore();
    expect((await app.prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe('CONFIRMED');
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('COMPLETED');
    expect(await balance()).toBe(7000);
    expect(await app.prisma.walletTransaction.count({ where: { reference: paymentId, type: 'REFUND_IN' } })).toBe(0);
    expect(await app.prisma.financeEntry.count({ where: { paymentId, kind: 'REFUND' } })).toBe(0);
    expect(await app.prisma.auditLog.count({ where: { targetId: paymentId, action: 'PAYMENT_REFUND' } })).toBe(0);
    expect((await cancel(appt.id)).statusCode).toBe(200);
    expect(await balance()).toBe(10000);
    expect((await cancel(appt.id)).statusCode).toBe(400);
    expect(await app.prisma.walletTransaction.count({ where: { reference: paymentId, type: 'REFUND_IN' } })).toBe(1);
  });

  it('échec de l’audit opérateur : annulation, REFUND et demande externe sont annulés ensemble', async () => {
    const appt = await appointment();
    const bought = await pay(appt.id, 'MTN_MOMO'); expect(bought.statusCode, bought.body).toBe(201);
    const paymentId = bought.json().payment.id as string;
    await approve(bought.json().payment.fedapayId);
    const failed = vi.spyOn(audit, 'writeAuditWithin').mockRejectedValueOnce(new Error('review synthetic audit failure'));
    expect((await cancel(appt.id)).statusCode).toBe(500);
    failed.mockRestore();
    expect((await app.prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe('CONFIRMED');
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('COMPLETED');
    expect(await app.prisma.financeEntry.count({ where: { paymentId, kind: 'REFUND' } })).toBe(0);
    expect(await app.prisma.financeOperation.count({ where: { requestId: `refund:${paymentId}` } })).toBe(0);
    expect((await cancel(appt.id)).statusCode).toBe(200);
    expect(await app.prisma.financeEntry.count({ where: { paymentId, kind: 'REFUND' } })).toBe(1);
    expect(await app.prisma.financeOperation.count({ where: { requestId: `refund:${paymentId}` } })).toBe(1);
    expect(await balance()).toBe(10000);
  });

  it('annulation après précontrôle WALLET : relecture avant le débit et la création', async () => {
    const appt = await appointment();
    const entered = gate(); const release = gate();
    const original = app.prisma.$transaction.bind(app.prisma);
    let first = true;
    vi.spyOn(app.prisma, '$transaction').mockImplementation((async (...args: Parameters<typeof original>) => {
      if (first) { first = false; entered.open(); await release.promise; }
      return Reflect.apply(original, app.prisma, args);
    }) as typeof app.prisma.$transaction);
    const paying = pay(appt.id);
    try {
      await entered.promise;
      expect((await cancel(appt.id)).statusCode).toBe(200);
    } finally { release.open(); }
    const response = await paying;
    expect(response.statusCode, response.body).toBe(400);
    expect(await balance()).toBe(10000);
    expect(await app.prisma.payment.count({ where: { appointmentId: appt.id } })).toBe(0);
  });

  it('annulation pendant FedaPay : aucun verrou réseau, paiement local ni checkout livré', async () => {
    const appt = await appointment();
    const entered = gate(); const release = gate();
    vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
      if (String(url).endsWith('/token')) {
        entered.open(); await release.promise;
        return new Response(JSON.stringify({ url: 'https://sandbox-process.fedapay.com/review-synthetic-token' }));
      }
      return new Response(JSON.stringify({ 'v1/transaction': { id: `review-${randomUUID()}` } }));
    });
    const paying = pay(appt.id, 'MTN_MOMO');
    try {
      await entered.promise;
      expect((await cancel(appt.id)).statusCode).toBe(200);
    } finally { release.open(); }
    const response = await paying;
    expect(response.statusCode, response.body).toBe(400);
    expect(response.body).not.toMatch(/review-synthetic-token|paymentUrl/);
    expect(await app.prisma.payment.count({ where: { appointmentId: appt.id } })).toBe(0);
    expect(await balance()).toBe(10000);
  });

  it('compte suspendu après précontrôle : aucun débit après attente de transaction', async () => {
    const appt = await appointment();
    const entered = gate(); const release = gate();
    const original = app.prisma.$transaction.bind(app.prisma);
    vi.spyOn(app.prisma, '$transaction').mockImplementation((async (...args: Parameters<typeof original>) => {
      entered.open(); await release.promise;
      return Reflect.apply(original, app.prisma, args);
    }) as typeof app.prisma.$transaction);
    const paying = pay(appt.id);
    try {
      await entered.promise;
      await app.prisma.user.update({ where: { id: patientUser }, data: { status: 'SUSPENDED' } });
    } finally { release.open(); }
    expect((await paying).statusCode).toBe(403);
    expect(await balance()).toBe(10000);
    expect(await app.prisma.payment.count({ where: { appointmentId: appt.id } })).toBe(0);
  });

  it.each(['initiation', 'annulation'] as const)('%s attend un verrou User de plus de 5 s sans erreur P2028', async (operation) => {
    const appt = await appointment();
    const owner = operation === 'initiation' ? patientUser : doctorUser;
    const entered = gate(); const release = gate();
    // Une commande PRO tient ce même verrou User pendant ses appels fournisseur.
    const holder = app.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner} FOR UPDATE`;
      entered.open();
      await release.promise;
    }, { timeout: 12_000 });
    await entered.promise;
    const action = operation === 'initiation' ? pay(appt.id) : cancel(appt.id);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 5200));
    } finally { release.open(); }
    await holder;
    const response = await action;
    expect(response.statusCode, response.body).toBe(operation === 'initiation' ? 201 : 200);
    expect(await balance()).toBe(operation === 'initiation' ? 7000 : 10000);
  });

  it('paiement wallet et annulation concurrents : aucun montant retenu après annulation médecin', async () => {
    for (let index = 0; index < 4; index++) {
      const appt = await appointment();
      const [paid, cancelled] = await Promise.all([pay(appt.id), cancel(appt.id)]);
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      expect([201, 400]).toContain(paid.statusCode);
      const payment = await app.prisma.payment.findUnique({ where: { appointmentId: appt.id } });
      if (paid.statusCode === 201) {
        expect(payment?.status).toBe('REFUNDED');
        expect(await app.prisma.walletTransaction.count({ where: { reference: payment!.id, type: 'REFUND_IN' } })).toBe(1);
      } else expect(payment).toBeNull();
      expect(await balance()).toBe(10000);
    }
  });

  it('refund public concurrent à l’annulation : une seule restitution, contre-écriture et audit', async () => {
    const appt = await appointment();
    const bought = await pay(appt.id); expect(bought.statusCode, bought.body).toBe(201);
    const paymentId = bought.json().payment.id as string;
    const [refunded, cancelled] = await Promise.all([
      payments.refund(app, paymentId, { actorId: adminUser, reason: 'Rapprochement de recette' }), cancel(appt.id),
    ]);
    expect(refunded.status).toBe('REFUNDED');
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(await balance()).toBe(10000);
    expect(await app.prisma.walletTransaction.count({ where: { reference: paymentId, type: 'REFUND_IN' } })).toBe(1);
    expect(await app.prisma.financeEntry.count({ where: { paymentId, kind: 'REFUND' } })).toBe(1);
    expect(await app.prisma.auditLog.count({ where: { targetId: paymentId, action: 'PAYMENT_REFUND' } })).toBe(1);
  });
});
