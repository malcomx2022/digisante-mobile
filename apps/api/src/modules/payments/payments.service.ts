// ─────────────────────────────────────────────────────────────
// Service Paiements FedaPay. ⚠️ GELÉ une fois validé (CLAUDE.md §5).
// Webhook : HMAC vérifié AVANT traitement, idempotence par fedapayId/statut.
// Une recharge confirmée (WALLET_TOPUP) crédite le portefeuille.
// ─────────────────────────────────────────────────────────────
import type { PaymentMethod, PaymentType } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '@/lib/audit.js';
import { isFedapayConfigured } from '@/lib/env.js';
import { badRequest, unauthorized } from '@/lib/errors.js';
import * as wallet from '@/modules/wallet/wallet.service.js';
import {
  computeCommission,
  createTransaction,
  getTransactionStatus,
  mapFedapayStatus,
  verifyWebhookSignature,
} from '@/services/fedapay.js';

type ResolvableStatus = 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'PROCESSING';

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
  // Idempotence : un paiement déjà terminal n'est pas retraité.
  if (['COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED'].includes(payment.status)) {
    return { idempotent: true, status: payment.status };
  }

  await app.prisma.payment.update({ where: { id: payment.id }, data: { status } });

  if (status === 'COMPLETED') {
    await writeAudit(app.prisma, {
      action: 'PAYMENT_CONFIRMED',
      actorId: payment.userId,
      targetId: payment.id,
      ip,
      meta: { fedapayId: payment.fedapayId, type: payment.type, source },
    });
    // Recharge de portefeuille → crédit du solde.
    if (payment.type === 'WALLET_TOPUP') {
      await wallet.credit(app, payment.userId, payment.amount.toNumber(), payment.id, 'Recharge wallet');
    }
  }

  return { processed: true, status };
}

interface InitiateInput {
  type: PaymentType;
  method: PaymentMethod;
  amount: number;
  appointmentId?: string;
}

/** Initie un paiement : crée la transaction FedaPay + l'enregistrement local. */
export async function initiate(app: FastifyInstance, userId: string, input: InitiateInput) {
  if (input.amount <= 0) throw badRequest('Montant invalide');
  const { commission, net } = computeCommission(input.amount);

  const tx = await createTransaction({
    amount: input.amount,
    method: input.method,
    description: `${input.type} (${input.amount} XOF)`,
    log: app.log,
  });

  const payment = await app.prisma.payment.create({
    data: {
      userId,
      appointmentId: input.appointmentId,
      type: input.type,
      method: input.method,
      amount: new Prisma.Decimal(input.amount),
      currency: 'XOF',
      status: 'PENDING',
      fedapayId: tx.fedapayId,
    },
    select: { id: true, fedapayId: true, amount: true, status: true },
  });

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

  // 2) Extraction normalisée { fedapayId, status }.
  let event: { fedapayId?: string; id?: string; status?: string; entity?: { id?: string; status?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw badRequest('Charge de webhook illisible');
  }
  const fedapayId = event.fedapayId ?? event.id ?? event.entity?.id;
  const rawStatus = event.status ?? event.entity?.status;
  if (!fedapayId || !rawStatus) throw badRequest('Webhook incomplet');

  const status = mapFedapayStatus(rawStatus);
  if (!status) return { ignored: true, reason: 'statut non géré' };

  const payment = await app.prisma.payment.findUnique({ where: { fedapayId } });
  if (!payment) return { ignored: true, reason: 'paiement inconnu' };

  // 3) Résolution idempotente + effets (logique partagée avec la réconciliation).
  return applyPaymentStatus(app, payment, status, ip, 'webhook');
}

/**
 * Réconciliation quotidienne (cron) : pour chaque paiement PENDING ancien (> 1 h),
 * interroge FedaPay et résout son statut via la même logique que le webhook.
 * Si FedaPay n'est pas configuré, balayage seul (aucune résolution).
 */
export async function reconcile(app: FastifyInstance) {
  const threshold = new Date(Date.now() - 60 * 60 * 1000); // > 1 h
  const pendings = await app.prisma.payment.findMany({
    where: { status: 'PENDING', createdAt: { lt: threshold }, fedapayId: { not: null } },
    select: { id: true, userId: true, type: true, status: true, fedapayId: true, amount: true },
  });

  if (!isFedapayConfigured) {
    app.log.info({ job: 'reconcile', scanned: pendings.length }, 'réconciliation FedaPay (balayage — non configuré)');
    return { scanned: pendings.length, resolved: 0 };
  }

  let resolved = 0;
  for (const payment of pendings) {
    if (!payment.fedapayId) continue;
    const raw = await getTransactionStatus(payment.fedapayId, app.log);
    if (!raw) continue;
    const status = mapFedapayStatus(raw);
    if (!status || status === 'PROCESSING') continue; // on ne résout que les statuts terminaux
    const result = await applyPaymentStatus(app, payment, status, null, 'reconcile');
    if ('processed' in result) resolved += 1;
  }

  app.log.info({ job: 'reconcile', scanned: pendings.length, resolved }, 'réconciliation FedaPay');
  return { scanned: pendings.length, resolved };
}
