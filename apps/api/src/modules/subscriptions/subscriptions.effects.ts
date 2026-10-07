// Effets L6 : toujours DANS la transaction financière (§5).
import type { Prisma } from '@prisma/client';
import { badRequest, forbidden } from '@/lib/errors.js';

/** Mois calendaire Africa/Lagos (UTC+1), dernier jour borné, heure conservée. */
export function addCalendarMonth(start: Date): Date {
  const local = new Date(start.getTime() + 3_600_000);
  const day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + 1);
  const last = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  local.setUTCDate(Math.min(day, last));
  return new Date(local.getTime() - 3_600_000);
}

export async function activateWithin(tx: Prisma.TransactionClient, paymentId: string, now = new Date()) {
  const initial = await tx.subscriptionOrder.findUnique({ where: { paymentId }, select: { doctorId: true } });
  if (!initial) return;
  await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${initial.doctorId} FOR UPDATE`;
  const order = await tx.subscriptionOrder.findUnique({ where: { paymentId }, include: { payment: true } });
  // Aucun plan ne peut être déduit des paiements isolés historiques.
  if (!order || order.revokedAt || order.startsAt) return;
  if (order.plan !== 'PRO' || order.periodMonths !== 1 || order.amount.lte(0) ||
      order.payment.type !== 'SUBSCRIPTION' || order.payment.status !== 'COMPLETED' ||
      !order.payment.amount.equals(order.amount) || order.payment.currency !== order.currency) throw badRequest('Contrat abonnement/paiement incohérent');
  const tail = await tx.subscriptionOrder.findFirst({
    where: { doctorId: order.doctorId, revokedAt: null, endsAt: { gt: now }, payment: { status: 'COMPLETED' } },
    orderBy: { endsAt: 'desc' }, select: { endsAt: true },
  });
  const startsAt = tail?.endsAt ?? now;
  await tx.subscriptionOrder.update({ where: { id: order.id }, data: { startsAt, endsAt: addCalendarMonth(startsAt), checkoutUrl: null } });
  await tx.doctor.update({ where: { id: order.doctorId }, data: { subscriptionPlan: 'PRO', subscriptionStatus: 'ACTIVE', subscriptionCancelledAt: null } });
}

export async function revokeWithin(tx: Prisma.TransactionClient, paymentId: string) {
  const order = await tx.subscriptionOrder.findUnique({ where: { paymentId } });
  if (!order) return;
  await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${order.doctorId} FOR UPDATE`;
  await tx.subscriptionOrder.update({ where: { id: order.id }, data: { revokedAt: new Date(), checkoutUrl: null } });
}

/** Droit courant sans cron, JWT ni colonnes historiques. */
export async function requireProWithin(tx: Prisma.TransactionClient, userId: string, now = new Date()) {
  const doctor = await tx.doctor.findUnique({ where: { userId }, select: { id: true } });
  if (!doctor) throw forbidden('Profil médecin requis');
  await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${doctor.id} FOR SHARE`;
  const paid = await tx.subscriptionOrder.findFirst({
    where: { doctorId: doctor.id, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now }, payment: { status: 'COMPLETED', type: 'SUBSCRIPTION' } }, select: { id: true },
  });
  if (!paid) throw forbidden('Un abonnement PRO payé et en cours est requis');
}
