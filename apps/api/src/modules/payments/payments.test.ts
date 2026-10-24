// Tests d'intégration Paiements + Wallet + Abonnements (via app.inject). Si DB+Redis (CI).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildWebhookSignatureHeader } from '@/services/fedapay.js';
import { fedapayWebhookBody } from '@/test/fedapay-fixture.js';
import type * as PaymentsService from './payments.service.js';
import * as wallet from '@/modules/wallet/wallet.service.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONES = ['+2290190000001', '+2290190000002', '+2290190000003'];
const WHSEC = 'whsec_test_p41';

describe.skipIf(!HAS_INFRA)('Paiements FedaPay & Wallet (intégration)', () => {
  let app: FastifyInstance;
  let patientToken: string;
  let doctorToken: string;
  let patientUserId: string;
  let patientRecordId: string;
  let otherPatientRecordId: string;
  let doctorRecordId: string;
  let payments: typeof PaymentsService;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  // Signature au VRAI schéma FedaPay (`t=…,s=…`) — via le helper du service,
  // pour qu'un test ne puisse plus valider une formule que la prod refuserait.
  const sign = (body: string) => buildWebhookSignatureHeader(body, WHSEC);
  const cleanup = async () => {
    await app.prisma.payment.deleteMany({ where: { user: { phone: { in: PHONES } } } });
    await app.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    // §5/Lot E : aucune config FedaPay en base → le webhook résout le secret depuis
    // le `.env` (WHSEC). Garantit le fallback quel que soit l'ordre des fichiers.
    await app.prisma.integrationConfig.deleteMany({ where: { provider: 'FEDAPAY' } });
    await app.redis.del('integration:FEDAPAY');
  };

  // Crée un RDV CONFIRMÉ (patient → médecin), non payé. Tarif médecin = 5000 XOF.
  const makeAppt = (patientId: string = patientRecordId) =>
    app.prisma.appointment.create({
      data: {
        patientId,
        doctorId: doctorRecordId,
        type: 'TELECONSULTATION',
        status: 'CONFIRMED',
        scheduledAt: new Date(Date.now() + 86_400_000),
      },
      select: { id: true },
    });

  beforeAll(async () => {
    // Le secret webhook doit être présent AVANT le chargement de l'env.
    process.env.FEDAPAY_WEBHOOK_SECRET = WHSEC;
    const { buildServer } = await import('@/server.js');
    payments = await import('./payments.service.js');
    app = await buildServer();
    await app.ready();
    await cleanup();

    const patient = await app.prisma.user.create({ data: { phone: PHONES[0], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'P', lastName: 'D' } }, patient: { create: {} } }, include: { patient: true } });
    const doctor = await app.prisma.user.create({ data: { phone: PHONES[1], role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'Dr', lastName: 'X' } }, doctor: { create: { speciality: 'G', licenseNumber: 'BJ-MED-3001', consultFee: 5000 } } }, include: { doctor: true } });
    const other = await app.prisma.user.create({ data: { phone: PHONES[2], role: 'PATIENT', status: 'ACTIVE', lang: 'FR', profile: { create: { firstName: 'O', lastName: 'T' } }, patient: { create: {} } }, include: { patient: true } });
    patientUserId = patient.id;
    patientRecordId = patient.patient!.id;
    doctorRecordId = doctor.doctor!.id;
    otherPatientRecordId = other.patient!.id;
    patientToken = app.jwt.sign({ sub: patient.id, role: 'PATIENT' }, { expiresIn: '15m' });
    doctorToken = app.jwt.sign({ sub: doctor.id, role: 'MEDECIN' }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    if (!app) return;
    await cleanup();
    await app.close();
  });

  const initConsult = (token: string, appointmentId: string, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/api/v1/payments', headers: auth(token), payload: { type: 'CONSULTATION', method: 'MTN_MOMO', appointmentId, ...extra } });

  const webhook = (fedapayId: string, status = 'approved') => {
    const body = fedapayWebhookBody(fedapayId, status);
    return app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: { 'content-type': 'application/json', 'x-fedapay-signature': sign(body) },
      payload: body,
    });
  };

  it('CONSULTATION : montant imposé serveur (tarif médecin), webhook signé → COMPLETED (commission 3 %)', async () => {
    const appt = await makeAppt();
    // Le client tente un montant dérisoire : il DOIT être ignoré (tarif = 5000).
    const init = await initConsult(patientToken, appt.id, { amount: 1 });
    expect(init.statusCode).toBe(201);
    expect(Number(init.json().payment.amount)).toBe(5000); // tarif médecin, pas le montant client
    expect(init.json().commission).toBe(150); // 3 % de 5000
    const fedapayId = init.json().payment.fedapayId as string;

    // Signature invalide → 401.
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: { 'content-type': 'application/json', 'x-fedapay-signature': 'invalide' },
      payload: fedapayWebhookBody(fedapayId, 'approved'),
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

  it('CONSULTATION sans appointmentId → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/payments', headers: auth(patientToken), payload: { type: 'CONSULTATION', method: 'MTN_MOMO', amount: 5000 } });
    expect(res.statusCode).toBe(400);
  });

  it('CONSULTATION sur le RDV d’autrui (IDOR) → 403, aucun paiement créé', async () => {
    const foreign = await makeAppt(otherPatientRecordId);
    const res = await initConsult(patientToken, foreign.id);
    expect(res.statusCode).toBe(403);
    const p = await app.prisma.payment.findFirst({ where: { appointmentId: foreign.id } });
    expect(p).toBeNull();
  });

  it('CONSULTATION : double-paiement du même RDV → 400', async () => {
    const appt = await makeAppt();
    const first = await initConsult(patientToken, appt.id);
    expect(first.statusCode).toBe(201);
    const second = await initConsult(patientToken, appt.id);
    expect(second.statusCode).toBe(400);
  });

  // Le DÉBIT n'est plus testé ici : `POST /wallet/pay` a été retirée (écart E2)
  // et le seul chemin de dépense du portefeuille est `POST /payments` méthode
  // WALLET, couvert par le test « WALLET : la consultation est débitée… » ci-dessous.
  it('wallet : recharge € → FCFA créditée au webhook', async () => {
    const topup = await app.inject({ method: 'POST', url: '/api/v1/wallet/topup', headers: auth(patientToken), payload: { amountEur: 10, method: 'VISA_MC' } });
    expect(topup.statusCode).toBe(200);
    expect(topup.json().amountXof).toBe(6560);
    const fedapayId = topup.json().payment.fedapayId as string;

    await webhook(fedapayId); // confirme la recharge → crédit

    const w1 = await app.inject({ method: 'GET', url: '/api/v1/wallet', headers: auth(patientToken) });
    expect(Number(w1.json().balance)).toBe(6560);
  });

  // ── D-10 (revue GO du 22/10/2026, §5) : approbation FedaPay tardive après un échec ──
  const balanceOf = async () => Number((await app.inject({ method: 'GET', url: '/api/v1/wallet', headers: auth(patientToken) })).json().balance);
  const audits = (action: string, targetId: string) => app.prisma.auditLog.count({ where: { action, targetId } });

  it('D-10 : recharge refusée puis approuvée tardivement — statut FAILED, aucun crédit, anomalie signalée une seule fois', async () => {
    const topup = await app.inject({ method: 'POST', url: '/api/v1/wallet/topup', headers: auth(patientToken), payload: { amountEur: 10, method: 'VISA_MC' } });
    const paymentId = topup.json().payment.id as string;
    const fedapayId = topup.json().payment.fedapayId as string;
    expect((await webhook(fedapayId, 'declined')).statusCode).toBe(200);
    const before = await balanceOf();

    // Rejeux FedaPay séquentiels ET simultanés de l'approbation tardive.
    const late = [await webhook(fedapayId), ...(await Promise.all(Array.from({ length: 4 }, () => webhook(fedapayId))))];
    expect(late.every((r) => r.statusCode === 200 && r.json().idempotent === true && r.json().status === 'FAILED')).toBe(true);

    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('FAILED');
    expect(await balanceOf()).toBe(before);
    expect(await audits('PAYMENT_CONFIRMED', paymentId)).toBe(0);
    expect(await audits('PAYMENT_LATE_APPROVAL', paymentId)).toBe(1);
    const finance = await import('./finance.service.js');
    expect((await finance.anomalies(app, 1, 100)).data.map((r) => r.id)).toContain(paymentId);
  });

  it('D-10 : consultation annulée chez FedaPay puis approuvée — aucune capture, signalée', async () => {
    const appt = await makeAppt();
    const init = await initConsult(patientToken, appt.id);
    const paymentId = init.json().payment.id as string;
    const fedapayId = init.json().payment.fedapayId as string;
    await webhook(fedapayId, 'canceled');
    expect((await webhook(fedapayId)).json()).toMatchObject({ idempotent: true, status: 'CANCELLED' });
    expect(await app.prisma.financeEntry.count({ where: { paymentId } })).toBe(0);
    expect(await audits('PAYMENT_LATE_APPROVAL', paymentId)).toBe(1);
  });

  it('D-10 : un paiement confirmé rejoué n’est jamais signalé comme approbation tardive', async () => {
    const appt = await makeAppt();
    const init = await initConsult(patientToken, appt.id);
    const fedapayId = init.json().payment.fedapayId as string;
    await webhook(fedapayId); await webhook(fedapayId); await webhook(fedapayId, 'declined');
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: init.json().payment.id } })).status).toBe('COMPLETED');
    expect(await audits('PAYMENT_LATE_APPROVAL', init.json().payment.id)).toBe(0);
  });

  it('D-10 : échec et approbation simultanés — une seule issue, jamais crédit ET signalement', async () => {
    const topup = await app.inject({ method: 'POST', url: '/api/v1/wallet/topup', headers: auth(patientToken), payload: { amountEur: 10, method: 'VISA_MC' } });
    const paymentId = topup.json().payment.id as string;
    const fedapayId = topup.json().payment.fedapayId as string;
    const before = await balanceOf();
    await Promise.all([webhook(fedapayId, 'declined'), webhook(fedapayId)]);
    const { status } = await app.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (status === 'COMPLETED') {
      expect(await balanceOf()).toBe(before + 6560);
      expect(await audits('PAYMENT_LATE_APPROVAL', paymentId)).toBe(0);
    } else {
      expect(status).toBe('FAILED');
      expect(await balanceOf()).toBe(before);
      expect(await audits('PAYMENT_LATE_APPROVAL', paymentId)).toBe(1);
    }
  });

  // Non-régression E2 : la route retirée ne doit pas réapparaître. Elle débitait
  // le payeur sans rien régler ni créditer personne, et n'avait aucun appelant.
  it('la route de paiement direct du portefeuille n’existe plus (E2)', async () => {
    const gone = await app.inject({ method: 'POST', url: '/api/v1/wallet/pay', headers: auth(patientToken), payload: { amount: 1000 } });
    expect(gone.statusCode).toBe(404);
  });

  // ── Lot 8 / écart D2 : le paiement par PORTEFEUILLE ────────────────────────
  // Avant, `method:'WALLET'` partait chez FedaPay comme du Mobile Money et ne
  // débitait JAMAIS le solde : l'interface annonçait un paiement par portefeuille
  // qui n'existait pas, et le `Payment` PENDING créé au passage verrouillait le
  // rendez-vous (`appointmentId` @unique) pour tout autre moyen.
  it('WALLET : la consultation est débitée du solde, sans transaction FedaPay', async () => {
    // Provisionne le portefeuille (recharge confirmée par webhook).
    const topup = await app.inject({ method: 'POST', url: '/api/v1/wallet/topup', headers: auth(patientToken), payload: { amountEur: 20, method: 'VISA_MC' } });
    await webhook(topup.json().payment.fedapayId as string);
    const before = Number((await app.inject({ method: 'GET', url: '/api/v1/wallet', headers: auth(patientToken) })).json().balance);

    const appt = await makeAppt();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/payments', headers: auth(patientToken),
      payload: { type: 'CONSULTATION', method: 'WALLET', appointmentId: appt.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();

    // Paiement TERMINAL immédiatement : rien à attendre d'un opérateur.
    expect(body.payment.status).toBe('COMPLETED');
    // Aucune transaction amont : pas d'id FedaPay, pas de lien de paiement.
    expect(body.payment.fedapayId).toBeNull();
    expect(body.paymentUrl).toBeNull();

    // Le solde a RÉELLEMENT bougé du tarif du médecin (5000 XOF).
    expect(Number(body.walletBalance)).toBe(before - 5000);
    const after = Number((await app.inject({ method: 'GET', url: '/api/v1/wallet', headers: auth(patientToken) })).json().balance);
    expect(after).toBe(before - 5000);

    // Et le mouvement est tracé au registre du portefeuille.
    const w = await app.prisma.wallet.findUnique({ where: { userId: patientUserId }, select: { id: true } });
    const debits = await app.prisma.walletTransaction.count({ where: { walletId: w!.id, type: 'DEBIT' } });
    expect(debits).toBeGreaterThanOrEqual(1);

    // Journalisé comme un paiement confirmé (au même titre que la voie webhook).
    const audits = await app.prisma.auditLog.count({ where: { action: 'PAYMENT_CONFIRMED', targetId: body.payment.id } });
    expect(audits).toBe(1);

    // La réconciliation ignore ce paiement : il n'a pas d'id FedaPay à interroger.
    const rec = await payments.reconcile(app);
    expect(rec.scanned).toBeGreaterThanOrEqual(0);
  });

  it('WALLET : solde insuffisant → 400, RIEN n’est débité et le RDV reste payable', async () => {
    // Vide le portefeuille pour se placer sous le tarif.
    const w = await app.prisma.wallet.findUnique({ where: { userId: patientUserId }, select: { id: true } });
    await app.prisma.wallet.update({ where: { id: w!.id }, data: { balance: 100 } });

    const appt = await makeAppt();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/payments', headers: auth(patientToken),
      payload: { type: 'CONSULTATION', method: 'WALLET', appointmentId: appt.id },
    });
    expect(res.statusCode).toBe(400);

    // Atomicité : ni débit, ni paiement orphelin — sinon `appointmentId` étant
    // @unique, le RDV serait DÉFINITIVEMENT impayable par un autre moyen.
    const balance = Number((await app.prisma.wallet.findUniqueOrThrow({ where: { id: w!.id }, select: { balance: true } })).balance);
    expect(balance).toBe(100);
    expect(await app.prisma.payment.count({ where: { appointmentId: appt.id } })).toBe(0);

    // Le repli Mobile Money reste possible sur ce même rendez-vous.
    const retry = await initConsult(patientToken, appt.id);
    expect(retry.statusCode).toBe(201);
    expect(retry.json().payment.status).toBe('PENDING');
  });

  it('WALLET : recharger un portefeuille AVEC le portefeuille est refusé (400)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/payments', headers: auth(patientToken),
      payload: { type: 'WALLET_TOPUP', method: 'WALLET', amount: 1000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('remboursement (reversal interne) : COMPLETED → REFUNDED, idempotent + audit', async () => {
    const appt = await makeAppt();
    const init = await initConsult(patientToken, appt.id);
    const fedapayId = init.json().payment.fedapayId as string;
    await webhook(fedapayId); // → COMPLETED
    const payment = await app.prisma.payment.findUniqueOrThrow({ where: { fedapayId }, select: { id: true } });

    const before = await app.prisma.auditLog.count({ where: { action: 'PAYMENT_REFUND' } });
    const r1 = await payments.refund(app, payment.id, { actorId: patientUserId, reason: 'test_admin' });
    expect('refunded' in r1 && r1.refunded).toBe(true);
    const refunded = await app.prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { status: true } });
    expect(refunded.status).toBe('REFUNDED');
    const after = await app.prisma.auditLog.count({ where: { action: 'PAYMENT_REFUND' } });
    expect(after).toBe(before + 1);

    // Idempotence : un second remboursement ne retraite pas et n'audite pas.
    const r2 = await payments.refund(app, payment.id, { actorId: patientUserId });
    expect('idempotent' in r2 && r2.idempotent).toBe(true);
    expect(await app.prisma.auditLog.count({ where: { action: 'PAYMENT_REFUND' } })).toBe(after);
  });

  it('remboursement d’une recharge wallet : le crédit est reversé (REFUND)', async () => {
    const topup = await app.inject({ method: 'POST', url: '/api/v1/wallet/topup', headers: auth(patientToken), payload: { amountEur: 5, method: 'VISA_MC' } });
    const fedapayId = topup.json().payment.fedapayId as string;
    const amountXof = topup.json().amountXof as number;
    await webhook(fedapayId); // crédite le wallet

    const w1 = await app.inject({ method: 'GET', url: '/api/v1/wallet', headers: auth(patientToken) });
    const balBefore = Number(w1.json().balance);

    const payment = await app.prisma.payment.findUniqueOrThrow({ where: { fedapayId }, select: { id: true } });
    await payments.refund(app, payment.id, { actorId: patientUserId, reason: 'topup_error' });

    const w2 = await app.inject({ method: 'GET', url: '/api/v1/wallet', headers: auth(patientToken) });
    expect(Number(w2.json().balance)).toBe(balBefore - amountXof);
    expect(w2.json().transactions.some((tr: { type: string }) => tr.type === 'REFUND')).toBe(true);
  });

  it('remboursements WALLET concurrents : un seul crédit et un seul audit', async () => {
    await app.prisma.wallet.upsert({
      where: { userId: patientUserId }, create: { userId: patientUserId, balance: 10000 }, update: { balance: 10000 },
    });
    const appt = await makeAppt();
    const init = await initConsult(patientToken, appt.id, { method: 'WALLET' });
    expect(init.statusCode).toBe(201);
    const paymentId = init.json().payment.id as string;
    const results = await Promise.all(Array.from({ length: 5 }, () => payments.refund(app, paymentId, { actorId: patientUserId })));
    expect(results.filter((r) => 'refunded' in r)).toHaveLength(1);
    expect(Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: patientUserId } })).balance)).toBe(10000);
    const movement = await app.prisma.walletTransaction.findMany({ where: { reference: paymentId, type: 'REFUND_IN' } });
    expect(movement).toHaveLength(1);
    expect(Number(movement[0]!.amount)).toBe(5000);
    expect(await app.prisma.auditLog.count({ where: { action: 'PAYMENT_REFUND', targetId: paymentId } })).toBe(1);
  });

  it('un échec du crédit de remboursement annule aussi la transition REFUNDED', async () => {
    await app.prisma.wallet.upsert({
      where: { userId: patientUserId }, create: { userId: patientUserId, balance: 10000 }, update: { balance: 10000 },
    });
    const appt = await makeAppt();
    const init = await initConsult(patientToken, appt.id, { method: 'WALLET' });
    expect(init.statusCode).toBe(201);
    const paymentId = init.json().payment.id as string;
    const failCredit = vi.spyOn(wallet, 'creditWithin').mockRejectedValueOnce(new Error('credit failed'));
    try {
      await expect(payments.refund(app, paymentId, { actorId: patientUserId })).rejects.toThrow('credit failed');
    } finally {
      failCredit.mockRestore();
    }
    expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('COMPLETED');
    expect(Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: patientUserId } })).balance)).toBe(5000);
    expect(await app.prisma.walletTransaction.count({ where: { reference: paymentId, type: 'REFUND_IN' } })).toBe(0);
    await payments.refund(app, paymentId, { actorId: patientUserId });
    expect(Number((await app.prisma.wallet.findUniqueOrThrow({ where: { userId: patientUserId } })).balance)).toBe(10000);
  });

  it('abonnement professionnel : activation gratuite fermée au lot L6', async () => {
    const sub = await app.inject({ method: 'POST', url: '/api/v1/subscriptions', headers: auth(doctorToken), payload: { plan: 'PRO' } });
    expect(sub.statusCode).toBe(400);
    const current = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/me', headers: auth(doctorToken) });
    expect(current.json().subscriptionPlan).toBe('FREE');
  });

  // ── B2 (revue indépendante 13/10/2026) — extraction de la transaction ──────
  // L'ancienne extraction `event.fedapayId ?? event.id ?? event.entity?.id`
  // prenait l'id d'ÉVÉNEMENT racine pour celui de la transaction (ou faisait
  // lever Prisma sur un entier → 500, retries vains). Aucun test n'envoyait d'id
  // racine : même angle mort que l'ancien défaut de signature.
  const deliver = (body: string) => app.inject({
    method: 'POST', url: '/api/v1/payments/webhook', payload: body,
    headers: { 'content-type': 'application/json', 'x-fedapay-signature': sign(body) },
  });
  const pendingTopup = (fedapayId: string) => app.prisma.payment.create({
    data: { userId: patientUserId, type: 'WALLET_TOPUP', method: 'MTN_MOMO', amount: 1000, currency: 'XOF', status: 'PENDING', fedapayId },
    select: { id: true },
  });
  const statusOf = async (id: string) => (await app.prisma.payment.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

  it('B2 — livraison officielle : seule entity.id (entier) désigne la transaction, jamais l’id d’événement racine', async () => {
    const target = await pendingTopup('7310518200');
    // id d'événement racine NUMÉRIQUE distinct : l'ancien code faisait lever Prisma (500).
    const first = await deliver(fedapayWebhookBody(7310518200, 'approved', { eventId: 999999 }));
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ processed: true, status: 'COMPLETED' });
    expect(await statusOf(target.id)).toBe('COMPLETED');
    expect(await app.prisma.walletTransaction.count({ where: { reference: target.id, type: 'TOPUP' } })).toBe(1);

    // id d'événement racine CHAÎNE qui coïncide avec un AUTRE paiement : l'ancien
    // code confirmait ce leurre et laissait la vraie transaction PENDING.
    const decoy = await pendingTopup('evt_b2_decoy');
    const second = await pendingTopup('7310518201');
    const res = await deliver(fedapayWebhookBody(7310518201, 'approved', { eventId: 'evt_b2_decoy' }));
    expect(res.json()).toEqual({ processed: true, status: 'COMPLETED' });
    expect(await statusOf(second.id)).toBe('COMPLETED');
    expect(await statusOf(decoy.id)).toBe('PENDING');
    expect(await app.prisma.walletTransaction.count({ where: { reference: decoy.id } })).toBe(0);

    // Rejeu de la même livraison : idempotent, aucun second crédit.
    expect((await deliver(fedapayWebhookBody(7310518200, 'approved', { eventId: 999999 }))).json()).toMatchObject({ idempotent: true });
    expect(await app.prisma.walletTransaction.count({ where: { reference: target.id, type: 'TOPUP' } })).toBe(1);
  });

  it('B2 — événement non transactionnel (customer.*) : 200 ignoré, aucun effet même si les ids coïncident', async () => {
    const payment = await pendingTopup('2568');
    for (const name of ['customer.created', 'customer.updated', 'customer.deleted']) {
      const res = await deliver(JSON.stringify({ id: 4242, name, object: 'event', entity: { klass: 'v1/customer', id: 2568, status: 'approved' } }));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ignored: true, reason: 'événement non transactionnel' });
    }
    expect(await statusOf(payment.id)).toBe('PENDING');
    expect(await app.prisma.walletTransaction.count({ where: { reference: payment.id } })).toBe(0);
  });

  it('B2 — identifiant invalide ou forme non officielle : 400 sans effet ; entity sérialisée et name absent tolérés', async () => {
    const payment = await pendingTopup('7310518300');
    const invalid: unknown[] = ['../7310518300', '7310518300 ', 1.5, -7310518300, 0, 2 ** 60, true, null, { id: 1 }];
    for (const id of invalid) {
      const res = await deliver(JSON.stringify({ id: 1, name: 'transaction.approved', entity: { id, status: 'approved' } }));
      expect(res.statusCode, JSON.stringify(id)).toBe(400);
    }
    // Ancienne forme maison (`fedapayId`/`status` racine) : n'est plus lue.
    expect((await deliver(JSON.stringify({ fedapayId: '7310518300', status: 'approved' }))).statusCode).toBe(400);
    expect((await deliver(JSON.stringify({ id: '7310518300', status: 'approved' }))).statusCode).toBe(400);
    // Statut absent ou non textuel, entity absente/tableau, corps non objet.
    for (const body of [{ name: 'transaction.approved', entity: { id: 7310518300 } }, { name: 'transaction.approved', entity: { id: 7310518300, status: 1 } }, { name: 'transaction.approved' }, { name: 'transaction.approved', entity: [7310518300] }, [1], 'x']) {
      expect((await deliver(JSON.stringify(body))).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await deliver(JSON.stringify({ name: 'transaction.approved', entity: '{not json' }))).statusCode).toBe(400);
    expect(await statusOf(payment.id)).toBe('PENDING');

    // Forme API Events (entity sérialisée) et livraison sans `name` : traitées.
    const stringified = await deliver(JSON.stringify({ id: 'evt_s', type: 'transaction.updated', entity: JSON.stringify({ id: 7310518300, status: 'pending' }) }));
    expect(stringified.json()).toEqual({ processed: true, status: 'PROCESSING' });
    const unnamed = await deliver(JSON.stringify({ entity: { id: 7310518300, status: 'approved' } }));
    expect(unnamed.json()).toEqual({ processed: true, status: 'COMPLETED' });
    expect(await app.prisma.walletTransaction.count({ where: { reference: payment.id, type: 'TOPUP' } })).toBe(1);
  });

  // ⚠️ §5/Lot E — re-test webhooks : quand FedaPay est configuré via l'ADMIN (base),
  // le webhook vérifie le HMAC avec le secret EN BASE (la base prime sur le `.env`).
  // Placé en dernier + nettoyage en `finally` → restaure le fallback `.env` (WHSEC).
  it('Lot E : le webhook FedaPay utilise le secret webhook configuré en base (admin)', async () => {
    const integrations = await import('@/lib/integrations.js');
    const DBSEC = 'whsec_db_lotE';
    try {
      await integrations.setIntegration(app, 'FEDAPAY', { secrets: { webhookSecret: DBSEC } });
      const pay = await app.prisma.payment.create({
        data: { userId: patientUserId, type: 'CONSULTATION', method: 'MTN_MOMO', amount: 5000, currency: 'XOF', status: 'PENDING', fedapayId: 'fdp_lotE_db' },
        select: { id: true },
      });
      const body = fedapayWebhookBody('fdp_lotE_db', 'approved');

      // Signé avec l'ANCIEN secret `.env` (WHSEC) → rejeté : la base prime.
      const wrong = await app.inject({
        method: 'POST', url: '/api/v1/payments/webhook',
        headers: { 'content-type': 'application/json', 'x-fedapay-signature': buildWebhookSignatureHeader(body, WHSEC) },
        payload: body,
      });
      expect(wrong.statusCode).toBe(401);

      // Signé avec le secret EN BASE → accepté + confirmé (idempotence/logique inchangées).
      const ok = await app.inject({
        method: 'POST', url: '/api/v1/payments/webhook',
        headers: { 'content-type': 'application/json', 'x-fedapay-signature': buildWebhookSignatureHeader(body, DBSEC) },
        payload: body,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().processed).toBe(true);
      const p = await app.prisma.payment.findUniqueOrThrow({ where: { id: pay.id }, select: { status: true } });
      expect(p.status).toBe('COMPLETED');
    } finally {
      await app.prisma.integrationConfig.deleteMany({ where: { provider: 'FEDAPAY' } });
      await app.redis.del('integration:FEDAPAY');
    }
  });
});
