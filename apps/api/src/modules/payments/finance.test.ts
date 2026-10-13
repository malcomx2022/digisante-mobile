// L7 : PostgreSQL/Redis/API réels ; fonds synthétiques, aucun transfert fournisseur.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as payments from './payments.service.js';
import * as audit from '@/lib/audit.js';
import * as finance from './finance.service.js';
import { buildWebhookSignatureHeader } from '@/services/fedapay.js';
import { fedapayWebhookBody } from '@/test/fedapay-fixture.js';
import type { Role } from '@digisante/shared';

describe('L7 — contrats purs', () => {
  it('bornes Africa/Lagos inclusives, exclusivité du lendemain', () => {
    expect(finance.periodBounds({ from: '2026-10-01', to: '2026-10-07' })).toEqual({ gte: new Date('2026-09-30T23:00:00Z'), lt: new Date('2026-10-07T23:00:00Z') });
  });
  it('refuse dates impossibles, période inversée, excessive et cible médecin injectée', () => {
    for (const p of [{ from: '2026-02-30', to: '2026-03-01' }, { from: '2026-10-07', to: '2026-10-06' }, { from: '2025-01-01', to: '2026-10-07' }, { from: '2026-01-01', to: '2026-01-02', doctorId: 'other' }]) expect(finance.periodSchema.safeParse(p).success).toBe(false);
    expect(finance.periodSchema.safeParse({ from: '2024-02-29', to: '2024-02-29' }).success).toBe(true);
  });
  it('CSV neutralise formules/espaces/tabulations et échappe guillemets', () => {
    for (const s of ['=HYPERLINK("x")', '+123', '-3', '@SUM(A1)', ' \t=1', '\rtext']) expect(finance.csvCell(s)).toMatch(/^"'/);
    expect(finance.csvCell('abc"def')).toBe('"abc""def"');
  });
  it('montant client, doublons de paiements, preuve URL refusés', () => {
    expect(finance.payoutSchema.safeParse({ requestId: randomUUID(), doctorId: 'cl7testdoctor00000000000001', paymentIds: ['cl7testpayment0000000000001'], amount: 1 }).success).toBe(false);
    for (const proofRef of ['https://supplier/evidence', 'abc\n123', 'patient name', '=1', 'short']) expect(finance.proofSchema.safeParse({ proofRef }).success).toBe(false);
  });
});

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290195470001', '+2290195470002', '+2290195470003', '+2290195470004', '+2290195470005'];
describe.skipIf(!HAS_INFRA)('L7 — revenus et opérations intégrées', () => {
  let app: FastifyInstance; let doctorUser: string; let doctorId: string; let otherUser: string; let otherDoctor: string; let patientUser: string; let patientId: string; let adminId: string; let readAdmin: string;
  const auth = (sub = doctorUser, role: Role = 'MEDECIN') => ({ authorization: `Bearer ${app.jwt.sign({ sub, role }, { expiresIn: '15m' })}` });
  const period = () => { const now = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10); return { from: now, to: now }; };
  const stats = (user = doctorUser) => app.inject({ method: 'GET', url: `/api/v1/professionals/me/revenue?${new URLSearchParams(period())}`, headers: auth(user) });
  const operation = (id: string, action: string, payload?: object, actor = adminId) => app.inject({ method: 'POST', url: `/api/v1/admin/finance/operations/${id}/${action}`, headers: auth(actor, 'ADMIN'), ...(payload ? { payload } : {}) });
  const payout = (paymentIds: string[], requestId = randomUUID(), id = doctorId, extra: object = {}) => app.inject({ method: 'POST', url: '/api/v1/admin/finance/payouts', headers: auth(adminId, 'ADMIN'), payload: { requestId, doctorId: id, paymentIds, ...extra } });
  const buy = (id: string) => app.inject({ method: 'POST', url: '/api/v1/subscriptions', headers: auth(id), payload: { plan: 'PRO', method: 'WALLET', requestId: randomUUID() } });
  const appointment = (id = doctorId, status: 'COMPLETED' | 'CONFIRMED' = 'COMPLETED') => app.prisma.appointment.create({ data: { patientId, doctorId: id, type: 'PHYSICAL', status, scheduledAt: new Date() } });
  async function paid(id = doctorId, status: 'COMPLETED' | 'CONFIRMED' = 'COMPLETED') {
    const appt = await appointment(id, status);
    const result = await payments.initiate(app, patientUser, { type: 'CONSULTATION', method: 'WALLET', appointmentId: appt.id });
    return result.payment.id;
  }
  beforeAll(async () => { const { buildServer } = await import('@/server.js'); app = await buildServer(); await app.ready(); });
  beforeEach(async () => {
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    const makeDoctor = (phone: string, fee: number) => app.prisma.user.create({ data: { phone, role: 'MEDECIN', status: 'ACTIVE', doctor: { create: { speciality: 'G', licenseNumber: randomUUID(), verifiedAt: new Date(), consultFee: fee } }, wallet: { create: { balance: 50000 } } }, include: { doctor: true } });
    const d = await makeDoctor(PHONES[0]!, 3000); doctorUser = d.id; doctorId = d.doctor!.id;
    const other = await makeDoctor(PHONES[1]!, 7000); otherUser = other.id; otherDoctor = other.doctor!.id;
    const p = await app.prisma.user.create({ data: { phone: PHONES[2]!, role: 'PATIENT', status: 'ACTIVE', patient: { create: {} }, wallet: { create: { balance: 100000 } } }, include: { patient: true } }); patientUser = p.id; patientId = p.patient!.id;
    adminId = (await app.prisma.user.create({ data: { phone: PHONES[3]!, role: 'ADMIN', status: 'ACTIVE', adminProfile: { create: { scopes: ['finance:read', 'finance:write'] } } } })).id;
    readAdmin = (await app.prisma.user.create({ data: { phone: PHONES[4]!, role: 'ADMIN', status: 'ACTIVE', adminProfile: { create: { scopes: ['finance:read'] } } } })).id;
    expect((await buy(doctorUser)).statusCode).toBe(200); expect((await buy(otherUser)).statusCode).toBe(200);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { if (app) { await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } }); await app.prisma.integrationConfig.deleteMany({ where: { provider: 'FEDAPAY' } }); await app.redis.del('integration:FEDAPAY'); await app.close(); } });

  it('deux médecins isolés, abonnements/topups/transferts exclus, chiffre d’affaires distinct du paiement', async () => {
    await paid(); await paid(otherDoctor);
    await payments.initiate(app, patientUser, { type: 'PHARMACY', method: 'WALLET', amount: 500 });
    const result = await stats(); expect(result.statusCode).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json()).toMatchObject({ revenue: { gross: '3000', commission: '90', net: '2910', confirmedCount: 1 }, paidInPeriod: '0', balance: { due: '2910', available: '2910' } });
    expect((await stats(otherUser)).json().revenue.gross).toBe('7000');
  });
  it('FAILED/PENDING/PROCESSING n’ajoutent aucune recette, héritage terminal signalé sans backfill', async () => {
    for (const status of ['FAILED', 'PENDING', 'PROCESSING', 'COMPLETED', 'REFUNDED'] as const) {
      const appt = await appointment(); await app.prisma.payment.create({ data: { userId: patientUser, appointmentId: appt.id, type: 'CONSULTATION', method: 'MTN_MOMO', amount: 3000, status } });
    }
    expect((await stats()).json()).toMatchObject({ revenue: { gross: '0', net: '0' }, legacyUnproven: 2 });
    const anomalies = await app.inject({ method: 'GET', url: '/api/v1/admin/finance/anomalies', headers: auth(readAdmin, 'ADMIN') });
    expect(anomalies.statusCode).toBe(200); expect(anomalies.json().data.filter((p: { doctorId: string }) => p.doctorId === doctorId)).toHaveLength(2); expect(anomalies.body).not.toMatch(/patientId|triage|notes|phone/);
  });
  it('remboursement concurrent déduit exactement une fois, wallet et journal concordent', async () => {
    const id = await paid(); await Promise.all([payments.refund(app, id, { actorId: adminId }), payments.refund(app, id, { actorId: adminId })]);
    expect((await stats()).json()).toMatchObject({ revenue: { gross: '3000', refunds: '3000', commission: '0', net: '0', refundedCount: 1 }, balance: { due: '0' } });
    expect(await app.prisma.financeEntry.count({ where: { paymentId: id } })).toBe(2);
    expect(await app.prisma.walletTransaction.count({ where: { reference: id, type: 'REFUND_IN' } })).toBe(1);
    expect(await app.prisma.financeOperation.count({ where: { requestId: `refund:${id}` } })).toBe(0);
  });
  it('journal conserve le tarif payé après changement de tarif médecin', async () => {
    await paid(); await app.prisma.doctor.update({ where: { id: doctorId }, data: { consultFee: 9000 } });
    expect((await stats()).json().revenue.gross).toBe('3000');
  });
  it('clôture de période exacte : capture incluse à début, exclue au lendemain', async () => {
    const now = period(); const range = finance.periodBounds(now);
    for (const at of [range.gte, new Date(range.lt.getTime() - 1), range.lt]) await app.prisma.financeEntry.create({ data: { paymentId: randomUUID(), doctorId, kind: 'CAPTURE', gross: 100, commission: 3, net: 97, occurredAt: at } });
    expect((await stats()).json().revenue.gross).toBe('200');
  });
  it('annulations et avis limités au médecin et à leur période, aucun commentaire médical', async () => {
    const a = await appointment(); await app.prisma.appointment.update({ where: { id: a.id }, data: { status: 'CANCELLED', cancelReason: 'secret clinique' } });
    await appointment(); await app.prisma.doctorReview.create({ data: { doctorId, patientId, rating: 4, comment: 'secret clinique' } });
    const res = await stats(); expect(res.json()).toMatchObject({ activity: { scheduled: 2, completed: 1, cancelled: 1, cancellationRate: 0.5 }, satisfaction: { count: 1, average: 4 } }); expect(res.body).not.toContain('secret clinique');
  });
  it('export isolé, minimisé, cohérent avec capture/remboursement, sans identité ni DMP', async () => {
    const mine = await paid(); const theirs = await paid(otherDoctor); await payments.refund(app, mine, { actorId: adminId });
    const res = await app.inject({ method: 'GET', url: `/api/v1/professionals/me/revenue/export?${new URLSearchParams(period())}`, headers: auth() });
    expect(res.statusCode).toBe(200); expect(res.json().content).toContain(mine); expect(res.json().content).not.toContain(theirs); expect(res.json().content).toContain('REFUND');
    expect(res.json().content).not.toMatch(/patient|phone|notes|daily|comment|triage/); expect(res.json().fiscal).toBe(false);
    expect(await app.prisma.auditLog.count({ where: { actorId: doctorUser, action: 'FINANCE_EXPORT' } })).toBe(1);
  });
  it('FREE et expiration refusés côté API, raw PRO ne vaut pas droit', async () => {
    await app.prisma.subscriptionOrder.updateMany({ where: { doctorId }, data: { endsAt: new Date(Date.now() - 1000) } });
    expect((await stats()).statusCode).toBe(403);
    await app.prisma.doctor.update({ where: { id: doctorId }, data: { subscriptionPlan: 'PRO', subscriptionStatus: 'ACTIVE' } }); expect((await stats()).statusCode).toBe(403);
  });
  it('suspension/retrait KYC/retrait rôle et patient/admin bloqués', async () => {
    await app.prisma.doctor.update({ where: { id: doctorId }, data: { verifiedAt: null } }); expect((await stats()).statusCode).toBe(403);
    await app.prisma.user.update({ where: { id: otherUser }, data: { status: 'SUSPENDED' } }); expect((await stats(otherUser)).statusCode).toBe(401);
    for (const [id, role] of [[patientUser, 'PATIENT'], [adminId, 'ADMIN']] as const) expect((await app.inject({ method: 'GET', url: `/api/v1/professionals/me/revenue?${new URLSearchParams(period())}`, headers: auth(id, role) })).statusCode).toBe(403);
  });
  it('sans session 401 et cible médecin ajoutée 422', async () => {
    const url = `/api/v1/professionals/me/revenue?${new URLSearchParams(period())}`;
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `${url}&doctorId=${otherDoctor}`, headers: auth() })).statusCode).toBe(422);
  });
  it('reçu appartenant au payeur, non fiscal, REFUNDED interne sans attestation opérateur', async () => {
    const id = await paid(); const url = `/api/v1/payments/${id}/receipt`;
    expect((await app.inject({ method: 'GET', url, headers: auth() })).statusCode).toBe(404);
    const res = await app.inject({ method: 'GET', url, headers: auth(patientUser, 'PATIENT') }); expect(res.statusCode).toBe(200); expect(res.json()).toMatchObject({ fiscal: false, amount: '3000', status: 'COMPLETED' }); expect(res.json().confirmedAt).not.toBeNull();
    expect(res.body).not.toMatch(/patientId|doctorId|receiptUrl|fedapayId|notes/);
  });
  it('demande reversement idempotente, montant net serveur, réserve sans transférer', async () => {
    const id = await paid(); const key = randomUUID(); const a = await payout([id], key); const b = await payout([id], key);
    expect(a.statusCode).toBe(200); expect(b.json().id).toBe(a.json().id); expect(a.json()).toMatchObject({ amount: '2910', state: 'REQUESTED' });
    expect((await stats()).json()).toMatchObject({ paidInPeriod: '0', balance: { due: '2910', reserved: '2910', available: '0' } });
  });
  it('deux demandes concurrentes n’allouent jamais deux fois le même paiement', async () => {
    const id = await paid(); const results = await Promise.all([payout([id]), payout([id])]); expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });
  it('clé réutilisée pour un autre paiement refusée', async () => {
    const first = await paid(); const second = await paid(); const key = randomUUID(); expect((await payout([first], key)).statusCode).toBe(200); expect((await payout([second], key)).statusCode).toBe(409);
  });
  it('autre médecin, pending, historique sans écriture, soins non terminés refusés', async () => {
    expect((await payout([await paid(otherDoctor)])).statusCode).toBe(409);
    expect((await payout([await paid(doctorId, 'CONFIRMED')])).statusCode).toBe(409);
    const appt = await appointment(); const p = await app.prisma.payment.create({ data: { userId: patientUser, appointmentId: appt.id, type: 'CONSULTATION', method: 'MTN_MOMO', amount: 3000, status: 'COMPLETED' } }); expect((await payout([p.id])).statusCode).toBe(409);
  });
  it('réservation bloque remboursement, annulation libère et nouvelle demande autorisée', async () => {
    const id = await paid(); const op = (await payout([id])).json(); await expect(payments.refund(app, id, { actorId: adminId })).rejects.toMatchObject({ statusCode: 409 });
    expect((await operation(op.id, 'cancel')).statusCode).toBe(200); expect((await payout([id])).statusCode).toBe(200);
  });
  it('exécution exige prise en charge et preuve ; clôture répétée stable, vraie somme reversée distincte', async () => {
    const id = await paid(); const op = (await payout([id])).json(); expect((await operation(op.id, 'complete', { proofRef: 'operator:l7proof' })).statusCode).toBe(409);
    expect((await operation(op.id, 'start')).json().state).toBe('EXECUTING'); expect((await operation(op.id, 'cancel')).statusCode).toBe(409);
    for (let i = 0; i < 2; i++) expect((await operation(op.id, 'complete', { proofRef: 'operator:' + op.id })).statusCode).toBe(200);
    expect((await stats()).json()).toMatchObject({ paidInPeriod: '2910', balance: { due: '0', reserved: '0', available: '0' } });
    expect((await operation(op.id, 'complete', { proofRef: 'another:proof' })).statusCode).toBe(409); expect((await payout([id])).statusCode).toBe(409);
  });
  it('preuve unique sur plusieurs opérations, pas de clôture concurrente double', async () => {
    const a = (await payout([await paid()])).json(); const b = (await payout([await paid()])).json(); await operation(a.id, 'start'); await operation(b.id, 'start');
    const results = await Promise.all([operation(a.id, 'complete', { proofRef: 'bank:' + a.id }), operation(b.id, 'complete', { proofRef: 'bank:' + a.id })]); expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });
  it('remboursement après reversement produit dette négative, pas un nouveau solde distribuable', async () => {
    const id = await paid(); const op = (await payout([id])).json(); await operation(op.id, 'start'); await operation(op.id, 'complete', { proofRef: 'bank:' + op.id }); await payments.refund(app, id, { actorId: adminId });
    expect((await stats()).json().balance).toMatchObject({ due: '-2910', available: '-2910' }); expect((await payout([await paid()])).statusCode).toBe(409);
  });
  it('finance:read voit opérations sans DMP, finance:write seul ne lit pas, suspension bloque', async () => {
    const id = await paid(); const url = '/api/v1/admin/finance/operations';
    expect((await app.inject({ method: 'GET', url, headers: auth(readAdmin, 'ADMIN') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/finance/payouts', headers: auth(readAdmin, 'ADMIN'), payload: { doctorId, paymentIds: [id], requestId: randomUUID() } })).statusCode).toBe(403);
    await app.prisma.adminProfile.update({ where: { userId: adminId }, data: { suspendedAt: new Date() } }); expect((await payout([id])).statusCode).toBe(403);
  });
  it('annulation impossible pendant exécution ; réattribution start autre admin interdite', async () => {
    const op = (await payout([await paid()])).json(); await operation(op.id, 'start');
    await app.prisma.adminProfile.update({ where: { userId: readAdmin }, data: { scopes: ['finance:read', 'finance:write'] } });
    expect((await operation(op.id, 'start', undefined, readAdmin)).statusCode).toBe(409); expect((await operation(op.id, 'cancel')).statusCode).toBe(409);
  });
  it('confirmation webhook répétée, remboursement externe auto journalisé sans appel FedaPay', async () => {
    const appt = await appointment(); const p = await app.prisma.payment.create({ data: { userId: patientUser, appointmentId: appt.id, type: 'CONSULTATION', method: 'MTN_MOMO', amount: 3000, status: 'PENDING', fedapayId: 'l7-' + randomUUID() } });
    const body = fedapayWebhookBody(p.fedapayId!, 'approved');
    for (let i = 0; i < 2; i++) await payments.handleWebhook(app, body, buildWebhookSignatureHeader(body, 'l7test'), 'l7test');
    expect(await app.prisma.financeEntry.count({ where: { paymentId: p.id, kind: 'CAPTURE' } })).toBe(1);
    const fetch = vi.spyOn(globalThis, 'fetch'); await payments.refund(app, p.id, { actorId: adminId }); expect(fetch).not.toHaveBeenCalled();
    const op = await app.prisma.financeOperation.findUniqueOrThrow({ where: { requestId: `refund:${p.id}` } }); expect(op.state).toBe('REQUESTED'); expect((await operation(op.id, 'cancel')).statusCode).toBe(409);
    await operation(op.id, 'start'); expect((await operation(op.id, 'complete', { proofRef: 'fedapay:' + p.id })).statusCode).toBe(200); expect((await stats()).json().paidInPeriod).toBe('0');
  });
  it('legacy REFUNDED externe rattrapé une fois, wallet/sans fournisseur refusés', async () => {
    const p = await app.prisma.payment.create({ data: { userId: patientUser, type: 'WALLET_TOPUP', method: 'MTN_MOMO', amount: 3000, status: 'REFUNDED', fedapayId: 'legacy-' + randomUUID() } });
    const url = `/api/v1/admin/finance/payments/${p.id}/external-refund`;
    const a = await app.inject({ method: 'POST', url, headers: auth(adminId, 'ADMIN') }); const b = await app.inject({ method: 'POST', url, headers: auth(adminId, 'ADMIN') }); expect(a.statusCode).toBe(200); expect(b.json().id).toBe(a.json().id);
    const wallet = await paid(); await payments.refund(app, wallet, { actorId: adminId }); expect((await app.inject({ method: 'POST', url: `/api/v1/admin/finance/payments/${wallet}/external-refund`, headers: auth(adminId, 'ADMIN') })).statusCode).toBe(409);
  });
  it('échec audit annule ensemble paiement, débit et écriture comptable', async () => {
    const appt = await appointment(); vi.spyOn(audit, 'writeAuditWithin').mockRejectedValueOnce(new Error('L7 simulated audit failure'));
    await expect(payments.initiate(app, patientUser, { type: 'CONSULTATION', method: 'WALLET', appointmentId: appt.id })).rejects.toThrow();
    expect(await app.prisma.payment.count({ where: { appointmentId: appt.id } })).toBe(0); expect(Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: patientUser } })).balance)).toBe(100000);
    expect((await stats()).json().revenue.gross).toBe('0');
  });
  it('échec audit annule remboursement, reversal et obligation externe', async () => {
    const id = await paid(); vi.spyOn(audit, 'writeAuditWithin').mockRejectedValueOnce(new Error('L7 simulated audit failure'));
    await expect(payments.refund(app, id, { actorId: adminId })).rejects.toThrow();
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id } })).status).toBe('COMPLETED'); expect(await app.prisma.financeEntry.count({ where: { paymentId: id } })).toBe(1);
    expect(Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: patientUser } })).balance)).toBe(97000);
  });
  it('échec audit annule réservation financière', async () => {
    const id = await paid(); const key = randomUUID(); vi.spyOn(audit, 'writeAuditWithin').mockRejectedValueOnce(new Error('L7 simulated audit failure')); expect((await payout([id], key)).statusCode).toBe(500);
    expect(await app.prisma.financeOperation.count({ where: { requestId: key } })).toBe(0); expect((await stats()).json().balance.reserved).toBe('0');
  });
  it('journal SQL append-only : UPDATE, DELETE et TRUNCATE refusés', async () => {
    const id = await paid(); await expect(app.prisma.financeEntry.updateMany({ where: { paymentId: id }, data: { net: 0 } })).rejects.toThrow();
    await expect(app.prisma.financeEntry.deleteMany({ where: { paymentId: id } })).rejects.toThrow(); await expect(app.prisma.$executeRawUnsafe('TRUNCATE finance_entries')).rejects.toThrow();
  });
  it('remboursement sur une autre période est une contre-écriture datée, pas une modification du mois payé', async () => {
    const appt = await appointment(); const p = await app.prisma.payment.create({ data: { userId: patientUser, appointmentId: appt.id, type: 'CONSULTATION', method: 'WALLET', amount: 3000, status: 'COMPLETED' } });
    await app.prisma.financeEntry.create({ data: { paymentId: p.id, doctorId, kind: 'CAPTURE', gross: 3000, commission: 90, net: 2910, occurredAt: new Date('2026-08-01T12:00:00Z') } });
    await payments.refund(app, p.id, { actorId: adminId });
    expect((await stats()).json().revenue).toMatchObject({ gross: '0', refunds: '3000', commission: '-90', net: '-2910' });
    const august = await app.inject({ method: 'GET', url: '/api/v1/professionals/me/revenue?from=2026-08-01&to=2026-08-31', headers: auth() }); expect(august.json().revenue).toMatchObject({ gross: '3000', refunds: '0', net: '2910' });
  });
  it('remboursement et réservation simultanés : un seul gagne, aucun paiement remboursé réservé', async () => {
    const id = await paid(); const outcomes = await Promise.allSettled([payments.refund(app, id, { actorId: adminId }), finance.requestPayout(app, adminId, { requestId: randomUUID(), doctorId, paymentIds: [id] })]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  });
  it('compensation de trop-perçu : allocation partielle sans perdre le reliquat, rejeu même contenu stable', async () => {
    // Ancienne commission reversée puis remboursement, et nouveau tarif différent.
    const old = await paid(); const op = (await payout([old])).json(); await operation(op.id, 'start'); await operation(op.id, 'complete', { proofRef: 'bank:' + op.id }); await payments.refund(app, old, { actorId: adminId });
    await app.prisma.doctor.update({ where: { id: doctorId }, data: { consultFee: 4000 } }); const fresh = await paid(); const key = randomUUID();
    const partial = await payout([fresh], key); expect(partial.statusCode).toBe(200); expect(partial.json().amount).toBe('970'); expect(partial.json().items[0].amount).toBe('970');
    expect((await payout([fresh], key)).json().id).toBe(partial.json().id);
    expect((await stats()).json().balance).toMatchObject({ due: '970', available: '0' });
  });
  it('export surdimensionné rejeté sans troncature et sans audit de succès', async () => {
    await app.prisma.financeEntry.createMany({ data: Array.from({ length: 10001 }, () => ({ paymentId: randomUUID(), doctorId, kind: 'CAPTURE', gross: 1, commission: 0, net: 1 })) });
    const res = await app.inject({ method: 'GET', url: `/api/v1/professionals/me/revenue/export?${new URLSearchParams(period())}`, headers: auth() }); expect(res.statusCode).toBe(400);
    expect(await app.prisma.auditLog.count({ where: { actorId: doctorUser, action: 'FINANCE_EXPORT' } })).toBe(0);
  });
  it('échec audit du webhook annule statut et capture ; un retry sain confirme une seule fois', async () => {
    const appt = await appointment(); const p = await app.prisma.payment.create({ data: { userId: patientUser, appointmentId: appt.id, type: 'CONSULTATION', method: 'MTN_MOMO', amount: 3000, status: 'PENDING', fedapayId: 'rollback-' + randomUUID() } });
    const body = fedapayWebhookBody(p.fedapayId!, 'approved'); const signature = buildWebhookSignatureHeader(body, 'l7test');
    vi.spyOn(audit, 'writeAuditWithin').mockRejectedValueOnce(new Error('L7 simulated audit failure')); await expect(payments.handleWebhook(app, body, signature, 'l7test')).rejects.toThrow();
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('PENDING'); expect(await app.prisma.financeEntry.count({ where: { paymentId: p.id } })).toBe(0);
    await payments.handleWebhook(app, body, signature, 'l7test'); expect(await app.prisma.financeEntry.count({ where: { paymentId: p.id } })).toBe(1);
  });
  it('éligibilité paginée exclut réservations/remboursements, aucune donnée patient', async () => {
    const id = await paid(); const a = await paid(); const url = `/api/v1/admin/finance/eligible?doctorId=${doctorId}&page=1&pageSize=1`;
    const first = await app.inject({ method: 'GET', url, headers: auth(adminId, 'ADMIN') }); expect(first.json().data).toHaveLength(1); expect(first.json().hasMore).toBe(true);
    await payout([id]); await payments.refund(app, a, { actorId: adminId }); const next = await app.inject({ method: 'GET', url, headers: auth(adminId, 'ADMIN') }); expect(next.json().data).toEqual([]); expect(next.body).not.toMatch(/phone|patientId|notes|triage/);
  });
});
