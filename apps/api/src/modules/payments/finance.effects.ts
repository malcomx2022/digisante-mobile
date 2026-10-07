// L7 : effets financiers locaux, toujours dans la transaction du paiement.
import { Prisma } from '@prisma/client';
import { conflict } from '@/lib/errors.js';
import { writeAuditWithin } from '@/lib/audit.js';
import { computeCommission } from '@/services/fedapay.js';

export async function lockFinance(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(4021958)`;
}

export async function captureWithin(tx: Prisma.TransactionClient, paymentId: string) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: {
    type: true, status: true, amount: true, currency: true, appointment: { select: { doctorId: true } },
  } });
  if (payment.type !== 'CONSULTATION' || payment.status !== 'COMPLETED' || !payment.appointment) return;
  if (payment.currency !== 'XOF' || payment.amount.lte(0)) throw conflict('Paiement de consultation incohérent');
  const { commission, net } = computeCommission(payment.amount.toNumber());
  await tx.financeEntry.create({ data: { paymentId, doctorId: payment.appointment.doctorId,
    kind: 'CAPTURE', gross: payment.amount, commission, net, occurredAt: new Date() } });
}

/** Le verrou finance précède les verrous paiement/wallet/docteur. */
export async function assertRefundNotReserved(tx: Prisma.TransactionClient, paymentId: string) {
  await lockFinance(tx);
  const reserved = await tx.financeOperationItem.findFirst({ where: { paymentId,
    operation: { kind: 'PAYOUT', state: { in: ['REQUESTED', 'EXECUTING'] } } } });
  if (reserved) throw conflict('Reversement réservé : annuler la demande ou rapprocher l’exécution avant remboursement');
}

export async function refundFinanceWithin(tx: Prisma.TransactionClient, paymentId: string, actorId: string) {
  const capture = await tx.financeEntry.findUnique({ where: { paymentId_kind: { paymentId, kind: 'CAPTURE' } } });
  if (capture) await tx.financeEntry.create({ data: { paymentId, doctorId: capture.doctorId, kind: 'REFUND',
    gross: capture.gross, commission: capture.commission, net: capture.net, occurredAt: new Date() } });
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { amount: true, currency: true, method: true, fedapayId: true } });
  // WALLET = restitution interne. Sans référence fournisseur : anomalie à rapprocher.
  if (payment.method !== 'WALLET' && payment.fedapayId && payment.currency === 'XOF') {
    const operation = await tx.financeOperation.create({ data: { requestId: `refund:${paymentId}`, kind: 'REFUND',
      doctorId: capture?.doctorId ?? null, amount: payment.amount, requestedBy: actorId,
      items: { create: { paymentId, providerReference: payment.fedapayId, amount: payment.amount } } } });
    await writeAuditWithin(tx, { action: 'FINANCE_REQUEST', actorId, targetId: operation.id, meta: { kind: 'REFUND' } });
  }
}
