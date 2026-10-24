// L6 — pile API/DB/Redis réelle ; HTTP FedaPay seul simulé, aucun règlement réel.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { setIntegration } from '@/lib/integrations.js';
import { buildWebhookSignatureHeader } from '@/services/fedapay.js';
import { fedapayWebhookBody } from '@/test/fedapay-fixture.js';
import * as audit from '@/lib/audit.js';
import * as effects from './subscriptions.effects.js';
import * as payments from '@/modules/payments/payments.service.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290195440001', '+2290195440002', '+2290195440003', '+2290195440004'];
const WHSEC = 'whsec_l6_test_only';

describe.skipIf(!HAS_INFRA)('L6 — abonnements médecin payants', () => {
  let app: FastifyInstance; let userId: string; let doctorId: string; let patientId: string; let missingId: string; let otherId: string;
  let supplier: MockInstance<typeof fetch>; let seq = 0;
  const auth = (id = userId) => ({ authorization: `Bearer ${app.jwt.sign({ sub: id, role: 'MEDECIN' }, { expiresIn: '15m' })}` });
  const read = () => app.inject({ method: 'GET', url: '/api/v1/subscriptions/me', headers: auth() });
  const buy = (extra: Record<string, unknown> = {}, id = userId) => app.inject({ method: 'POST', url: '/api/v1/subscriptions', headers: auth(id), payload: { plan: 'PRO', method: 'MTN_MOMO', requestId: randomUUID(), ...extra } });
  const stop = () => app.inject({ method: 'POST', url: '/api/v1/subscriptions', headers: auth(), payload: { plan: 'FREE' } });
  const webhook = (fedapayId: string, status = 'approved', secret = WHSEC) => {
    const payload = fedapayWebhookBody(fedapayId, status);
    return app.inject({ method: 'POST', url: '/api/v1/payments/webhook', payload, headers: { 'content-type': 'application/json', 'x-fedapay-signature': buildWebhookSignatureHeader(payload, secret) } });
  };
  const orderFor = async (id: string) => app.prisma.subscriptionOrder.findUniqueOrThrow({ where: { id }, include: { payment: true } });
  const pay = async () => { const res = await buy(); expect(res.statusCode).toBe(200); const o = await orderFor(res.json().orderId); expect((await webhook(o.payment.fedapayId!)).statusCode).toBe(200); return orderFor(o.id); };
  beforeAll(async () => {
    const { buildServer } = await import('@/server.js'); app = await buildServer(); await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    const d = await app.prisma.user.create({ data: { phone: PHONES[0]!, role: 'MEDECIN', status: 'ACTIVE', profile: { create: { firstName: 'Test', lastName: 'L6' } }, doctor: { create: { speciality: 'G', licenseNumber: 'L6-TEST-ONLY', consultFee: 3000, verifiedAt: new Date() } }, wallet: { create: { balance: 100000 } } }, include: { doctor: true } }); userId = d.id; doctorId = d.doctor!.id;
    patientId = (await app.prisma.user.create({ data: { phone: PHONES[1]!, role: 'PATIENT', status: 'ACTIVE' } })).id;
    missingId = (await app.prisma.user.create({ data: { phone: PHONES[2]!, role: 'MEDECIN', status: 'ACTIVE' } })).id;
    otherId = (await app.prisma.user.create({ data: { phone: PHONES[3]!, role: 'MEDECIN', status: 'ACTIVE', doctor: { create: { speciality: 'G', licenseNumber: 'L6-OTHER-TEST-ONLY', consultFee: 2000, verifiedAt: new Date() } } } })).id;
  });
  beforeEach(async () => {
    await app.prisma.payment.deleteMany({ where: { userId } });
    await app.prisma.walletTransaction.deleteMany({ where: { wallet: { userId } } });
    await app.prisma.user.update({ where: { id: userId }, data: { role: 'MEDECIN', status: 'ACTIVE' } });
    await app.prisma.doctor.update({ where: { id: doctorId }, data: { verifiedAt: new Date(), subscriptionPlan: 'FREE', subscriptionStatus: 'ACTIVE', subscriptionCancelledAt: null } });
    await app.prisma.wallet.update({ where: { userId }, data: { balance: 100000 } });
    await setIntegration(app, 'FEDAPAY', { secrets: { secretKey: 'sk_sandbox_l6_synthetic', publicKey: 'pk_sandbox_l6_synthetic', webhookSecret: WHSEC } });
    supplier = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/token')) return new Response(JSON.stringify({ url: `https://sandbox-process.fedapay.com/l6-test-${seq}` }));
      if (String(url).endsWith('/transactions')) return new Response(JSON.stringify({ 'v1/transaction': { id: `l6-test-${++seq}` } }));
      return new Response(JSON.stringify({ 'v1/transaction': { status: 'approved' } }));
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { if (app) { await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } }); await app.prisma.integrationConfig.deleteMany({ where: { provider: 'FEDAPAY' } }); await app.redis.del('integration:FEDAPAY'); await app.close(); } });

  it('catalogue versionné FREE + PRO 5000 XOF, STARTER/CLINIC désactivés, sans récurrence', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/catalog', headers: auth() });
    expect(res.statusCode).toBe(200); expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toMatchObject({ version: 'doctor-pilot-2026-10-v1', currency: 'XOF', autoRenew: false, disabledPlans: ['STARTER', 'CLINIC'] });
    expect(res.json().plans.map((p: { plan: string; amount: number }) => [p.plan, p.amount])).toEqual([['FREE', 0], ['PRO', 5000]]);
  });
  it('sans session → 401 ; patient et médecin sans profil → 403', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/subscriptions/me' })).statusCode).toBe(401);
    for (const id of [patientId, missingId]) expect((await app.inject({ method: 'GET', url: '/api/v1/subscriptions/me', headers: auth(id) })).statusCode).toBe(403);
  });
  it('FREE actif par défaut, aucune période ni droit payant', async () => {
    expect((await read()).json()).toMatchObject({ subscriptionPlan: 'FREE', subscriptionStatus: 'ACTIVE', currentPeriodEnd: null, autoRenew: false, rights: { startTeleconsultation: false, revenueStats: false } });
  });
  it('ancien POST plan PRO seul fermé : aucune activation gratuite', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/subscriptions', headers: auth(), payload: { plan: 'PRO' } });
    expect(res.statusCode).toBe(400); expect((await read()).json().subscriptionPlan).toBe('FREE'); expect(supplier).not.toHaveBeenCalled();
  });
  it('plan inconnu et prix client refusés avant tout effet', async () => {
    expect((await buy({ plan: 'PLATINUM' })).statusCode).toBe(422);
    expect((await buy({ amount: 1 })).statusCode).toBe(422); expect(supplier).not.toHaveBeenCalled();
  });
  it('STARTER et CLINIC indisponibles pendant le pilote', async () => {
    for (const plan of ['STARTER', 'CLINIC']) expect((await buy({ plan })).statusCode).toBe(400);
    expect(await app.prisma.payment.count({ where: { userId } })).toBe(0);
  });
  it('paiement SUBSCRIPTION générique fermé pour médecin et patient', async () => {
    for (const id of [userId, patientId]) expect((await app.inject({ method: 'POST', url: '/api/v1/payments', headers: auth(id), payload: { type: 'SUBSCRIPTION', method: 'WALLET', amount: 1 } })).statusCode).toBe(400);
  });
  it('médecin non vérifié refusé avant fournisseur et débit', async () => {
    await app.prisma.doctor.update({ where: { id: doctorId }, data: { verifiedAt: null } });
    expect((await buy()).statusCode).toBe(403); expect(supplier).not.toHaveBeenCalled();
  });
  it('ancien JWT suspendu refusé', async () => {
    const headers = auth(); await app.prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
    expect((await app.inject({ method: 'POST', url: '/api/v1/subscriptions', headers, payload: { plan: 'PRO', method: 'MTN_MOMO', requestId: randomUUID() } })).statusCode).toBe(401);
  });
  it('configuration absente : aucun checkout fictif ni commande', async () => {
    await setIntegration(app, 'FEDAPAY', { secrets: {} });
    expect((await buy()).statusCode).toBe(502); expect(supplier).not.toHaveBeenCalled(); expect(await app.prisma.payment.count({ where: { userId } })).toBe(0);
  });
  it('checkout hébergé impose prix, référence et retour PRO ; FREE tant que non confirmé', async () => {
    const res = await buy(); expect(res.statusCode).toBe(200); expect(res.json().payment).toMatchObject({ amount: '5000', currency: 'XOF', status: 'PENDING' });
    const body = JSON.parse(String(supplier.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({ amount: 5000, currency: { iso: 'XOF' }, merchant_reference: res.json().payment.id }); expect(body.callback_url).toMatch(/\/pro\/stats$/);
    expect(supplier.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
    expect((await read()).json().subscriptionPlan).toBe('FREE'); expect((await orderFor(res.json().orderId)).startsAt).toBeNull();
  });
  it('fournisseur en panne : transaction locale annulée', async () => {
    supplier.mockRejectedValueOnce(new Error('synthetic supplier failure'));
    expect((await buy()).statusCode).toBe(502); expect(await app.prisma.subscriptionOrder.count({ where: { doctorId } })).toBe(0); expect(await app.prisma.payment.count({ where: { userId } })).toBe(0);
  });
  it('checkout non HTTPS ou hors FedaPay refusé, aucun contrat local', async () => {
    supplier.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'invalid-test' }))).mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://evil.example/checkout' })));
    expect((await buy()).statusCode).toBe(502); expect(await app.prisma.payment.count({ where: { userId } })).toBe(0);
  });
  it('cinq POST concurrents du même requestId : une commande et un checkout', async () => {
    const requestId = randomUUID(); const res = await Promise.all(Array.from({ length: 5 }, () => buy({ requestId })));
    expect(res.every((r) => r.statusCode === 200)).toBe(true); expect(new Set(res.map((r) => r.json().orderId)).size).toBe(1); expect(supplier).toHaveBeenCalledTimes(2);
  });
  it('requestId réutilisé avec autre méthode → conflit', async () => {
    const requestId = randomUUID(); await buy({ requestId }); expect((await buy({ requestId, method: 'MOOV_MONEY' })).statusCode).toBe(409);
  });
  it('seconde commande en attente refusée, reprise du même lien propriétaire', async () => {
    const res = await buy(); expect((await buy()).statusCode).toBe(409);
    const resume = await app.inject({ method: 'GET', url: `/api/v1/subscriptions/${res.json().orderId}/checkout`, headers: auth() });
    expect(resume.json().paymentUrl).toBe(res.json().paymentUrl); expect(supplier).toHaveBeenCalledTimes(2);
  });
  it('checkout tiers refusé ; historique sans checkout ni jeton fournisseur', async () => {
    const res = await buy(); expect((await app.inject({ method: 'GET', url: `/api/v1/subscriptions/${res.json().orderId}/checkout`, headers: auth(otherId) })).statusCode).toBe(404);
    const history = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/history', headers: auth() }); expect(history.body).not.toContain('checkoutUrl'); expect(history.body).not.toContain('fedapayId');
  });
  it('A8 : portefeuille refusé avant tout effet, même avec un solde suffisant', async () => {
    const res = await buy({ method: 'WALLET' }); expect(res.statusCode).toBe(400);
    expect(await app.prisma.payment.count({ where: { userId } })).toBe(0); expect(await app.prisma.subscriptionOrder.count({ where: { doctorId } })).toBe(0);
    expect(Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance)).toBe(100000); expect(await app.prisma.walletTransaction.count({ where: { wallet: { userId } } })).toBe(0);
    expect(supplier).not.toHaveBeenCalled(); expect((await read()).json().subscriptionPlan).toBe('FREE');
  });
  it('HMAC incorrect : aucune activation ni transition financière', async () => {
    const o = await orderFor((await buy()).json().orderId); expect((await webhook(o.payment.fedapayId!, 'approved', 'wrong_test_secret')).statusCode).toBe(401); expect((await read()).json().subscriptionPlan).toBe('FREE'); expect((await orderFor(o.id)).payment.status).toBe('PENDING');
  });
  it('cinq webhooks signés concurrents : une seule période immuable', async () => {
    const o = await orderFor((await buy()).json().orderId); const res = await Promise.all(Array.from({ length: 5 }, () => webhook(o.payment.fedapayId!)));
    expect(res.every((r) => r.statusCode === 200)).toBe(true); const activated = await orderFor(o.id); expect(activated.endsAt).toEqual(effects.addCalendarMonth(activated.startsAt!));
    await webhook(o.payment.fedapayId!); expect((await orderFor(o.id)).endsAt).toEqual(activated.endsAt); expect(await app.prisma.auditLog.count({ where: { action: 'PAYMENT_CONFIRMED', targetId: o.paymentId } })).toBe(1);
  });
  it('échec ou annulation fournisseur : aucun droit ni période, retry terminal ignoré', async () => {
    for (const status of ['declined', 'canceled']) { const o = await orderFor((await buy()).json().orderId); expect((await webhook(o.payment.fedapayId!, status)).statusCode).toBe(200); await webhook(o.payment.fedapayId!); expect((await orderFor(o.id)).startsAt).toBeNull(); }
    expect((await read()).json().subscriptionPlan).toBe('FREE');
  });
  it('réconciliation et webhook concurrents : une seule période', async () => {
    const o = await orderFor((await buy()).json().orderId); await app.prisma.payment.update({ where: { id: o.paymentId }, data: { createdAt: new Date(Date.now() - 7_200_000) } });
    await Promise.all([payments.reconcile(app), webhook(o.payment.fedapayId!)]); const after = await orderFor(o.id); expect(after.payment.status).toBe('COMPLETED'); expect(after.endsAt).toEqual(effects.addCalendarMonth(after.startsAt!)); expect(await app.prisma.auditLog.count({ where: { action: 'PAYMENT_CONFIRMED', targetId: o.paymentId } })).toBe(1);
  });
  it('erreur pendant activation : COMPLETED annulé, webhook rejouable', async () => {
    const o = await orderFor((await buy()).json().orderId); vi.spyOn(effects, 'activateWithin').mockRejectedValueOnce(new Error('test-only activation failure'));
    expect((await webhook(o.payment.fedapayId!)).statusCode).toBe(500); expect((await orderFor(o.id)).payment.status).toBe('PENDING'); expect((await webhook(o.payment.fedapayId!)).statusCode).toBe(200); expect((await read()).json().subscriptionPlan).toBe('PRO');
  });
  it('échec audit abonnement : paiement et période annulés, retry répare ensemble', async () => {
    const o = await orderFor((await buy()).json().orderId);
    vi.spyOn(audit, 'writeAuditWithin').mockRejectedValueOnce(new Error('test-only audit failure'));
    expect((await webhook(o.payment.fedapayId!)).statusCode).toBe(500); expect((await orderFor(o.id)).payment.status).toBe('PENDING'); expect((await orderFor(o.id)).startsAt).toBeNull();
    expect((await webhook(o.payment.fedapayId!)).statusCode).toBe(200); expect(await app.prisma.auditLog.count({ where: { action: 'PAYMENT_CONFIRMED', targetId: o.paymentId } })).toBe(1);
  });
  it('échec de révocation : remboursement, droit et audit annulés ensemble', async () => {
    const o = await pay();
    vi.spyOn(effects, 'revokeWithin').mockRejectedValueOnce(new Error('test-only revoke failure'));
    await expect(payments.refund(app, o.paymentId, { actorId: userId })).rejects.toThrow('test-only revoke failure');
    expect((await orderFor(o.id)).revokedAt).toBeNull(); expect((await orderFor(o.id)).payment.status).toBe('COMPLETED'); expect((await read()).json().subscriptionPlan).toBe('PRO');
    expect(await app.prisma.auditLog.count({ where: { action: 'PAYMENT_REFUND', targetId: o.paymentId } })).toBe(0);
  });
  it('annulation et confirmation concurrentes : période conservée ou commande révoquée, jamais un droit incohérent', async () => {
    const o = await orderFor((await buy()).json().orderId);
    const results = await Promise.all([stop(), webhook(o.payment.fedapayId!)]); expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const after = await orderFor(o.id); expect(after.payment.status).toBe('COMPLETED');
    if (after.revokedAt) { expect(after.startsAt).toBeNull(); expect((await read()).json().subscriptionPlan).toBe('FREE'); }
    else { expect(after.startsAt).not.toBeNull(); expect((await read()).json()).toMatchObject({ subscriptionPlan: 'PRO', cancelAtPeriodEnd: true }); }
  });
  it('contrat montant altéré : confirmation refusée et droits fermés', async () => {
    const o = await orderFor((await buy()).json().orderId); await app.prisma.payment.update({ where: { id: o.paymentId }, data: { amount: 1 } });
    expect((await webhook(o.payment.fedapayId!)).statusCode).toBe(400); expect((await orderFor(o.id)).payment.status).toBe('PENDING'); expect((await read()).json().subscriptionPlan).toBe('FREE');
  });
  it('renouvellement manuel : ajoute un mois à la fin existante sans réécrire la première période', async () => {
    const first = await pay(); const next = await pay(); expect(next.startsAt).toEqual(first.endsAt); expect(next.endsAt).toEqual(effects.addCalendarMonth(first.endsAt!)); expect((await orderFor(first.id)).endsAt).toEqual(first.endsAt); expect((await read()).json().currentPeriodEnd).toBe(next.endsAt!.toISOString());
  });
  it('expiration appliquée immédiatement sans cron et sans modifier le paiement', async () => {
    const o = await pay(); await app.prisma.subscriptionOrder.update({ where: { id: o.id }, data: { startsAt: new Date(Date.now() - 7_200_000), endsAt: new Date(Date.now() - 1000) } });
    expect((await read()).json()).toMatchObject({ subscriptionPlan: 'FREE', subscriptionStatus: 'EXPIRED', rights: { startTeleconsultation: false, revenueStats: false } });
    await expect(app.prisma.$transaction((tx) => effects.requireProWithin(tx, userId))).rejects.toMatchObject({ statusCode: 403 }); expect((await orderFor(o.id)).payment.status).toBe('COMPLETED');
  });
  it('FREE : conserve les droits jusqu’à l’échéance de la période payée', async () => {
    const o = await pay(); const stopped = await stop(); expect(stopped.json()).toMatchObject({ subscriptionPlan: 'PRO', cancelAtPeriodEnd: true, currentPeriodEnd: o.endsAt!.toISOString() });
    await app.prisma.$transaction((tx) => effects.requireProWithin(tx, userId)); expect((await orderFor(o.id)).revokedAt).toBeNull();
  });
  it('commande abandonnée puis réglée : paiement tracé, aucun droit, remboursement manuel possible', async () => {
    const o = await orderFor((await buy()).json().orderId); await stop(); expect((await webhook(o.payment.fedapayId!)).statusCode).toBe(200); const after = await orderFor(o.id); expect(after.payment.status).toBe('COMPLETED'); expect(after.startsAt).toBeNull(); expect(after.revokedAt).not.toBeNull(); expect((await read()).json().subscriptionPlan).toBe('FREE');
    await payments.refund(app, o.paymentId, { actorId: userId }); expect((await orderFor(o.id)).payment.status).toBe('REFUNDED');
  });
  it('remboursements concurrents : un seul remboursement et droit révoqué atomiquement', async () => {
    const o = await pay(); await Promise.all(Array.from({ length: 4 }, () => payments.refund(app, o.paymentId, { actorId: userId })));
    expect((await read()).json().subscriptionPlan).toBe('FREE'); expect((await orderFor(o.id)).payment.status).toBe('REFUNDED');
    expect(await app.prisma.auditLog.count({ where: { action: 'PAYMENT_REFUND', targetId: o.paymentId } })).toBe(1); expect(await app.prisma.walletTransaction.count({ where: { reference: o.paymentId } })).toBe(0);
  });
  it('API téléconsultation : FREE refusé, PRO payé démarre, expiration conserve join/end', async () => {
    const patient = await app.prisma.patient.upsert({ where: { userId: patientId }, create: { userId: patientId }, update: {} });
    const appt = await app.prisma.appointment.create({ data: { patientId: patient.id, doctorId, type: 'TELECONSULTATION', status: 'CONFIRMED', scheduledAt: new Date() } });
    const start = () => app.inject({ method: 'POST', url: '/api/v1/consultations', headers: auth(), payload: { appointmentId: appt.id } });
    expect((await start()).statusCode).toBe(403); expect(await app.prisma.consultation.count({ where: { appointmentId: appt.id } })).toBe(0);
    const order = await pay();
    const opened = await start(); expect(opened.statusCode).toBe(201);
    await app.prisma.subscriptionOrder.update({ where: { id: order.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    const cid = opened.json().consultation.id;
    expect((await app.inject({ method: 'POST', url: `/api/v1/consultations/${cid}/join`, headers: auth(patientId) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/consultations/${cid}/end`, headers: auth(), payload: {} })).statusCode).toBe(200);
    await app.prisma.appointment.delete({ where: { id: appt.id } });
  });
  it('ancienne colonne PRO/ACTIVE sans preuve : jamais de droit gratuit', async () => {
    await app.prisma.doctor.update({ where: { id: doctorId }, data: { subscriptionPlan: 'PRO', subscriptionStatus: 'ACTIVE' } }); expect((await read()).json().subscriptionPlan).toBe('FREE'); await expect(app.prisma.$transaction((tx) => effects.requireProWithin(tx, userId))).rejects.toMatchObject({ statusCode: 403 });
  });
  it('NODE_ENV=test désactive la limite globale, sans désactiver les verrous OTP métier', async () => {
    const results = await Promise.all(Array.from({ length: 101 }, () => app.inject({ method: 'GET', url: '/api/v1/health' })));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
  });
  it('ancien paiement SUBSCRIPTION sans commande : confirmation financière seule', async () => {
    const p = await app.prisma.payment.create({ data: { userId, type: 'SUBSCRIPTION', method: 'MTN_MOMO', amount: 5000, fedapayId: 'l6-legacy-test' } }); const hook = await webhook(p.fedapayId!); expect(hook.statusCode, hook.body).toBe(200); expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('COMPLETED'); expect((await read()).json().subscriptionPlan).toBe('FREE');
  });
});

describe('L6 — mois calendaire Bénin', () => {
  it('31 janvier → dernier jour de février, année bissextile comprise', () => {
    expect(effects.addCalendarMonth(new Date('2026-01-31T10:00:00Z')).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(effects.addCalendarMonth(new Date('2028-01-31T10:00:00Z')).toISOString()).toBe('2028-02-29T10:00:00.000Z');
  });
  it('minuit Bénin conservé même quand le jour UTC diffère', () => {
    expect(effects.addCalendarMonth(new Date('2026-01-30T23:30:00Z')).toISOString()).toBe('2026-02-27T23:30:00.000Z');
  });
});
