// ─────────────────────────────────────────────────────────────
// Service Paiements FedaPay. ⚠️ GELÉ une fois validé (CLAUDE.md §5).
// Webhook : HMAC vérifié AVANT traitement, idempotence par fedapayId/statut.
// Une recharge confirmée (WALLET_TOPUP) crédite le portefeuille.
// ─────────────────────────────────────────────────────────────
import type { PaymentMethod, PaymentType } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { writeAudit, writeAuditWithin } from '@/lib/audit.js';
import { env } from '@/lib/env.js';
import { badRequest, forbidden, notFound, unauthorized } from '@/lib/errors.js';
import { resolveConfiguredSecrets } from '@/lib/integrations.js';
import * as wallet from '@/modules/wallet/wallet.service.js';
import { activateWithin, revokeWithin } from '@/modules/subscriptions/subscriptions.effects.js';
import {
  computeCommission,
  createTransaction,
  getTransactionStatus,
  mapFedapayStatus,
  parseFedapayTransactionId,
  verifyWebhookSignature,
} from '@/services/fedapay.js';
import { assertRefundNotReserved, captureWithin, lockFinance, refundFinanceWithin } from './finance.effects.js';

type ResolvableStatus = 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'PROCESSING';

/** Statuts terminaux : un paiement qui les atteint n'est plus jamais retraité. */
const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED'] as const;

// Une souscription PRO concurrente garde User/Doctor jusqu'à 25 s ; ces phases
// locales doivent pouvoir attendre ses verrous, sans appel fournisseur en transaction.
const PAYMENT_TX = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 };

/**
 * Applique un statut résolu à un paiement, de façon IDEMPOTENTE, avec les effets
 * de bord associés (audit PAYMENT_CONFIRMED, crédit wallet sur WALLET_TOPUP).
 * Source unique de vérité, partagée par le webhook ET la réconciliation.
 * ⚠️ Logique validée (§5) — comportement couvert par les tests webhook/wallet.
 */
async function applyPaymentStatus(
  app: FastifyInstance,
  payment: { id: string; userId: string; type: PaymentType; status: string; fedapayId: string | null; amount: Prisma.Decimal },
  status: ResolvableStatus,
  ip: string | null | undefined,
  source: 'webhook' | 'reconcile',
): Promise<{ idempotent: true; status: string } | { processed: true; status: string }> {
  // Idempotence (lecture rapide) : un paiement déjà terminal n'est pas retraité.
  if ((TERMINAL_STATUSES as readonly string[]).includes(payment.status)) {
    return { idempotent: true, status: payment.status };
  }

  // Idempotence (GARANTIE) : la lecture ci-dessus peut être périmée — deux livraisons
  // simultanées du même webhook (retries FedaPay, webhook ∥ réconciliation, PM2 ×2)
  // la passaient toutes deux et créditaient la recharge PLUSIEURS fois. La transition
  // est donc CONDITIONNELLE (`status ∉ terminaux`) : PostgreSQL ré-évalue la condition
  // après le verrou de ligne, une seule livraison la gagne. Le crédit est dans la
  // MÊME transaction : pas de COMPLETED sans crédit, ni de crédit sans transition.
  const topupWalletId =
    status === 'COMPLETED' && payment.type === 'WALLET_TOPUP'
      ? (await wallet.getOrCreateWallet(app, payment.userId)).id
      : null;
  const won = await app.prisma.$transaction(async (tx) => {
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { notIn: [...TERMINAL_STATUSES] } },
      data: { status },
    });
    if (count === 0) return false;
    if (topupWalletId) await wallet.creditWithin(tx, topupWalletId, payment.amount.toNumber(), payment.id, 'Recharge wallet');
    if (status === 'COMPLETED') await captureWithin(tx, payment.id);
    if (status === 'COMPLETED') {
      if (payment.type === 'SUBSCRIPTION') await activateWithin(tx, payment.id);
      await writeAuditWithin(tx, { action: 'PAYMENT_CONFIRMED', actorId: payment.userId, targetId: payment.id, ip, meta: { fedapayId: payment.fedapayId, type: payment.type, source } });
    }
    return true;
  });
  if (!won) {
    const current = await app.prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    return { idempotent: true, status: current?.status ?? payment.status };
  }

  return { processed: true, status };
}

/**
 * Remboursement INTERNE d'un paiement (reversal côté système — AUCUN appel
 * FedaPay externe ; le retour d'argent côté opérateur reste une étape manuelle
 * tracée). Idempotent : un paiement déjà REFUNDED n'est pas retraité ; seul un
 * paiement COMPLETED est remboursable. WALLET_TOPUP : reversal du crédit
 * (REFUND sortant). Paiement WALLET : restitution du débit (REFUND_IN entrant).
 * Tracé par audit PAYMENT_REFUND.
 * ⚠️ §5 — couvert par les tests refund + la non-régression des webhooks.
 */
export async function refund(
  app: FastifyInstance,
  paymentId: string,
  opts: { actorId: string; ip?: string | null; reason?: string },
): Promise<{ idempotent: true; status: string } | { refunded: true; status: string }> {
  return app.prisma.$transaction((tx) => refundWithin(tx, paymentId, opts), PAYMENT_TX);
}

/** Même reversal interne, dans la transaction de l'appelant (annulation du RDV). */
export async function refundWithin(
  tx: Prisma.TransactionClient,
  paymentId: string,
  opts: { actorId: string; ip?: string | null; reason?: string },
): Promise<{ idempotent: true; status: string } | { refunded: true; status: string }> {
  // Toujours avant paiement/doctor/wallet ; l'appelant peut déjà tenir ce verrou.
  await lockFinance(tx);
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, userId: true, type: true, method: true, status: true, amount: true, fedapayId: true },
  });
  if (!payment) throw notFound('Paiement introuvable');
  if (payment.status === 'REFUNDED') return { idempotent: true, status: 'REFUNDED' };
  if (payment.status !== 'COMPLETED') throw badRequest('Seul un paiement confirmé peut être remboursé');

  // Transition CONDITIONNELLE COMPLETED → REFUNDED (double-clic admin, deux
  // administrateurs, annulation de RDV ∥ action admin) + reversal dans la même
  // transaction : un seul remboursement effectif, jamais de double reversal.
  await assertRefundNotReserved(tx, payment.id);
  const { count } = await tx.payment.updateMany({ where: { id: payment.id, status: 'COMPLETED' }, data: { status: 'REFUNDED' } });
  if (count === 0) return { idempotent: true, status: 'REFUNDED' };
  if (payment.type === 'SUBSCRIPTION') await revokeWithin(tx, payment.id);
  if (payment.type === 'WALLET_TOPUP' || payment.method === 'WALLET') {
    const refundWallet = await tx.wallet.upsert({ where: { userId: payment.userId },
      create: { userId: payment.userId, balance: 0, currency: 'XOF' }, update: {} });
    if (payment.type === 'WALLET_TOPUP') {
      await wallet.refundWithin(tx, refundWallet.id, payment.amount.toNumber(), payment.id, opts.reason ?? 'Remboursement');
    } else {
      await wallet.creditWithin(tx, refundWallet.id, payment.amount.toNumber(), payment.id, opts.reason ?? 'Remboursement', 'REFUND_IN');
    }
  }
  await refundFinanceWithin(tx, payment.id, opts.actorId);
  await writeAuditWithin(tx, {
    action: 'PAYMENT_REFUND', actorId: opts.actorId, targetId: payment.id, ip: opts.ip,
    meta: { fedapayId: payment.fedapayId, type: payment.type, amount: payment.amount.toString(), reason: opts.reason ?? null },
  });
  return { refunded: true, status: 'REFUNDED' };
}

interface InitiateInput {
  type: PaymentType;
  method: PaymentMethod;
  amount?: number;
  appointmentId?: string;
}

async function payableAppointment(client: Pick<Prisma.TransactionClient, 'appointment'>, userId: string, appointmentId: string) {
  const appt = await client.appointment.findUnique({ where: { id: appointmentId }, select: {
    status: true, patient: { select: { userId: true } }, doctor: { select: { consultFee: true } }, payment: { select: { id: true } },
  } });
  if (!appt) throw notFound('Rendez-vous introuvable');
  if (appt.patient.userId !== userId) throw forbidden('Ce rendez-vous ne vous appartient pas');
  if (appt.status === 'CANCELLED' || appt.status === 'COMPLETED') throw badRequest('Ce rendez-vous ne peut plus être payé');
  if (appt.payment) throw badRequest('Ce rendez-vous a déjà un paiement associé');
  return appt;
}

async function lockPayableAppointment(tx: Prisma.TransactionClient, userId: string, appointmentId: string) {
  await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId} FOR UPDATE`;
  return payableAppointment(tx, userId, appointmentId);
}

async function lockActivePayer(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (user?.status !== 'ACTIVE') throw forbidden('Compte actif requis pour le paiement');
}

/**
 * Initie un paiement : crée la transaction FedaPay + l'enregistrement local.
 * ⚠️ §5 — le webhook/HMAC/idempotence/crédit wallet sont inchangés. Durcissement :
 *  - une CONSULTATION DOIT référencer un RDV du patient ; le montant est le tarif
 *    du médecin (autoritatif serveur), jamais une valeur choisie par le client ;
 *  - `appointmentId` est refusé pour les autres types (non applicable) ;
 *  - le RDV doit appartenir à l'appelant et ne pas déjà porter de paiement.
 */
export async function initiate(app: FastifyInstance, userId: string, input: InitiateInput) {
  if (input.type === 'SUBSCRIPTION') throw badRequest('Utiliser le parcours abonnements médecin');
  let amount = input.amount;

  if (input.type === 'CONSULTATION') {
    if (!input.appointmentId) throw badRequest('Un rendez-vous (appointmentId) est requis pour payer une consultation');
    const appt = await payableAppointment(app.prisma, userId, input.appointmentId);
    // Montant AUTORITATIF serveur : tarif du médecin, la valeur client est ignorée.
    amount = appt.doctor.consultFee.toNumber();
  } else if (input.appointmentId) {
    throw badRequest('appointmentId non applicable à ce type de paiement');
  }

  if (amount == null || amount <= 0) throw badRequest('Montant invalide');
  const { commission, net } = computeCommission(amount);

  // Identité du PAYEUR (jamais de donnée de santé, §4) : préremplit la page de
  // paiement hébergée. Sans elle, le payeur ressaisit son numéro et la conversion
  // en Mobile Money chute.
  const payer = await app.prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, email: true, profile: { select: { firstName: true, lastName: true } } },
  });

  // ── Paiement par PORTEFEUILLE (lot 8) ──────────────────────────────────────
  // Avant août 2026, `method: 'WALLET'` partait chez FedaPay comme n'importe
  // quelle méthode Mobile Money : le solde n'était JAMAIS débité alors que
  // l'interface annonçait un paiement par portefeuille. Le portefeuille était
  // rechargeable et jamais dépensable.
  //
  // Le débit et l'enregistrement du paiement sont validés ou annulés ENSEMBLE :
  // un solde insuffisant annule tout (aucun `Payment` créé, donc le rendez-vous
  // reste payable par un autre moyen — `Payment.appointmentId` étant @unique, un
  // enregistrement orphelin l'aurait verrouillé définitivement).
  if (input.method === 'WALLET') {
    if (input.type === 'WALLET_TOPUP') {
      throw badRequest('Une recharge de portefeuille ne peut pas être payée par le portefeuille');
    }

    const result = await app.prisma.$transaction(async (trx) => {
      await lockActivePayer(trx, userId);
      if (input.type === 'CONSULTATION') await lockPayableAppointment(trx, userId, input.appointmentId!);
      const debited = await wallet.debit(
        app,
        userId,
        { amount, description: `${input.type} (${amount} XOF)` },
        trx,
      );
      const created = await trx.payment.create({
        data: {
          userId,
          appointmentId: input.appointmentId,
          type: input.type,
          method: 'WALLET',
          amount: new Prisma.Decimal(amount),
          currency: 'XOF',
          // Aucun mouvement externe à attendre : le paiement est terminal
          // immédiatement. Pas de `fedapayId` → il sort du périmètre de la
          // réconciliation, qui ne balaie que les PENDING porteurs d'un id FedaPay.
          status: 'COMPLETED',
        },
        select: { id: true, fedapayId: true, amount: true, status: true },
      });
      await captureWithin(trx, created.id);
      await writeAuditWithin(trx, { action: 'PAYMENT_CONFIRMED', actorId: userId,
        targetId: created.id, meta: { type: input.type, method: 'WALLET', source: 'wallet', reference: debited.reference } });
      return { payment: created, balance: debited.balance, reference: debited.reference };
    }, PAYMENT_TX);

    return {
      payment: result.payment,
      paymentUrl: null,
      commission,
      net,
      walletBalance: result.balance,
    };
  }

  // §5/Lot E : clé secrète résolue (base chiffrée → `.env`). Absente ⇒ stub (inchangé).
  const cfg = await resolveConfiguredSecrets(app, 'FEDAPAY');
  const tx = await createTransaction({
    amount,
    method: input.method,
    description: `${input.type} (${amount} XOF)`,
    log: app.log,
    secretKey: cfg?.secretKey ?? null,
    // Retour du payeur après la page hébergée FedaPay (même origine que le web).
    callbackUrl: env.CORS_ORIGIN ? `${env.CORS_ORIGIN.split(',')[0]}/patient/appointments` : null,
    // Référence lisible dans le tableau de bord FedaPay pour le rapprochement.
    // On n'a pas encore l'id du paiement local à ce stade (il est créé après la
    // transaction amont) : le RDV est la seule référence stable disponible ici.
    merchantReference: input.appointmentId ?? null,
    customer: payer
      ? {
          firstname: payer.profile?.firstName,
          lastname: payer.profile?.lastName,
          email: payer.email ?? undefined,
          phone: payer.phone,
        }
      : null,
  });

  // Réseau hors verrou : si le RDV est annulé entre-temps, aucune écriture locale
  // ni checkout n'est rendu. La transaction amont impayée doit être rapprochée.
  const payment = await app.prisma.$transaction(async (trx) => {
    await lockActivePayer(trx, userId);
    if (input.type === 'CONSULTATION') await lockPayableAppointment(trx, userId, input.appointmentId!);
    return trx.payment.create({
      data: {
        userId,
        appointmentId: input.appointmentId,
        type: input.type,
        method: input.method,
        amount: new Prisma.Decimal(amount),
        currency: 'XOF',
        status: 'PENDING',
        fedapayId: tx.fedapayId,
      },
      select: { id: true, fedapayId: true, amount: true, status: true },
    });
  }, PAYMENT_TX);

  return { payment, paymentUrl: tx.paymentUrl, commission, net };
}

/**
 * Traite un webhook FedaPay. Vérifie d'abord la signature HMAC (sinon 401),
 * puis applique le statut de façon idempotente.
 */
export async function handleWebhook(
  app: FastifyInstance,
  rawBody: string,
  signature: string | undefined,
  secret: string | undefined,
  ip?: string | null,
) {
  // 1) HMAC AVANT tout traitement.
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    await writeAudit(app.prisma, { action: 'AUTH_FAIL', ip, meta: { source: 'fedapay_webhook', reason: 'bad_signature' } });
    throw unauthorized('Signature de webhook invalide');
  }

  // 2) Extraction de la TRANSACTION — forme officielle d'une livraison FedaPay :
  //    `{ name: 'transaction.approved', entity: { id, status, … } }` (exemples
  //    docs.fedapay.com « webhooks » sur `event.name` ; intégrations officielles
  //    PMPro `$event->entity->id` et Odoo `data['entity']['id']`).
  //
  //    ⚠️ B2 (revue indépendante 13/10/2026) : l'ancienne extraction
  //    `event.fedapayId ?? event.id ?? event.entity?.id` prenait l'identifiant
  //    d'ÉVÉNEMENT (`id` racine) à la place de celui de la transaction, et un `id`
  //    entier faisait lever Prisma (500, retries vains) : confirmations, CAPTURE
  //    L7, activation L6 et crédits ne passaient plus que par la réconciliation.
  //    Seul `entity.id` désigne la transaction ; `id`, `fedapayId` et `status`
  //    racine ne sont JAMAIS lus.
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw badRequest('Charge de webhook illisible');
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw badRequest('Webhook incomplet');
  const { name, type } = event as { name?: unknown; type?: unknown };
  const eventName = typeof name === 'string' ? name : typeof type === 'string' ? type : undefined;
  // Un endpoint reçoit par défaut TOUS les événements du compte (customer.*…).
  // Les refuser ferait rejouer FedaPay indéfiniment : accusé de réception, sans effet.
  if (eventName !== undefined && !eventName.startsWith('transaction.')) {
    return { ignored: true, reason: 'événement non transactionnel' };
  }
  let entity = (event as { entity?: unknown }).entity;
  if (typeof entity === 'string') {
    // Forme de l'API Events (`entity` sérialisée en chaîne) — tolérée par prudence.
    try {
      entity = JSON.parse(entity);
    } catch {
      throw badRequest('Charge de webhook illisible');
    }
  }
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) throw badRequest('Webhook incomplet');
  const { id: rawId, status: rawStatus } = entity as { id?: unknown; status?: unknown };
  // Même borne qu'à la création : chaîne sûre comme clé `Payment.fedapayId`.
  const fedapayId = parseFedapayTransactionId(rawId);
  if (!fedapayId || typeof rawStatus !== 'string' || !rawStatus) throw badRequest('Webhook incomplet');

  const status = mapFedapayStatus(rawStatus);
  if (!status) return { ignored: true, reason: 'statut non géré' };

  const payment = await app.prisma.payment.findUnique({ where: { fedapayId } });
  if (!payment) return { ignored: true, reason: 'paiement inconnu' };

  // 3) Résolution idempotente + effets (logique partagée avec la réconciliation).
  return applyPaymentStatus(app, payment, status, ip, 'webhook');
}

/** Critère commun au cron et à la file de supervision financière. */
export function reconciliationWhere(now = Date.now()): Prisma.PaymentWhereInput {
  return {
    status: { in: ['PENDING', 'PROCESSING'] },
    createdAt: { lt: new Date(now - 60 * 60 * 1000) },
    fedapayId: { not: null },
  };
}

/**
 * Réconciliation quotidienne (cron) : paiements PENDING ou PROCESSING anciens (> 1 h),
 * interroge FedaPay et résout son statut via la même logique que le webhook.
 * Si FedaPay n'est pas configuré, balayage seul (aucune résolution).
 */
export async function reconcile(app: FastifyInstance) {
  const pendings = await app.prisma.payment.findMany({
    where: reconciliationWhere(),
    // Ordre déterministe : les plus anciens d'abord (les plus en retard).
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, userId: true, type: true, status: true, fedapayId: true, amount: true },
  });

  // §5/Lot E : clé secrète résolue (base chiffrée → `.env`). Absente ⇒ balayage seul.
  const cfg = await resolveConfiguredSecrets(app, 'FEDAPAY');
  if (!cfg) {
    app.log.info({ job: 'reconcile', scanned: pendings.length }, 'réconciliation FedaPay (balayage — non configuré)');
    return { scanned: pendings.length, resolved: 0, failed: 0 };
  }

  let resolved = 0;
  let failed = 0;
  for (const payment of pendings) {
    if (!payment.fedapayId) continue;
    // B2 : un paiement en échec (P2028, interblocage, conflit d'activation L6 ou
    // de capture L7…) n'interrompt plus le lot. Sa transaction est annulée en
    // entier par `applyPaymentStatus` ; il reste PENDING/PROCESSING et sera repris
    // au prochain passage. Journal : identifiant seul, l'erreur passe par le
    // sérialiseur `err` (messages Prisma minimisés), jamais de charge utile.
    try {
      const raw = await getTransactionStatus(payment.fedapayId, app.log, cfg.secretKey);
      if (!raw) continue;
      const status = mapFedapayStatus(raw);
      if (!status || status === 'PROCESSING') continue; // on ne résout que les statuts terminaux
      const result = await applyPaymentStatus(app, payment, status, null, 'reconcile');
      if ('processed' in result) resolved += 1;
    } catch (err) {
      failed += 1;
      app.log.error({ err, paymentId: payment.id, job: 'reconcile' }, '[FedaPay] réconciliation : paiement en échec, lot poursuivi');
    }
  }

  app.log.info({ job: 'reconcile', scanned: pendings.length, resolved, failed }, 'réconciliation FedaPay');
  return { scanned: pendings.length, resolved, failed };
}
