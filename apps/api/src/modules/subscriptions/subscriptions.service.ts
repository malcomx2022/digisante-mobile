import { DOCTOR_SUBSCRIPTION_CATALOG, isFedapayCheckoutUrl, type PaymentMethod } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { openSecret, sealSecret } from '@/lib/crypto.js';
import { badGateway, badRequest, conflict, forbidden, notFound } from '@/lib/errors.js';
import { resolveConfiguredSecrets } from '@/lib/integrations.js';
import { paymentCallbackUrl } from '@/lib/payment-return.js';
import { createTransaction } from '@/services/fedapay.js';

const offer = DOCTOR_SUBSCRIPTION_CATALOG.plans[1];
const pendingStatuses = ['PENDING', 'PROCESSING'] as const;
export const catalog = () => ({ ...DOCTOR_SUBSCRIPTION_CATALOG, autoRenew: false, disabledPlans: ['STARTER', 'CLINIC'] });

async function doctorFor(app: FastifyInstance, userId: string) {
  const doctor = await app.prisma.doctor.findUnique({ where: { userId } });
  if (!doctor) throw forbidden('Profil médecin requis');
  return doctor;
}

export async function current(app: FastifyInstance, userId: string) {
  const doctor = await doctorFor(app, userId);
  const now = new Date();
  const [paid, pending] = await Promise.all([
    app.prisma.subscriptionOrder.findMany({ where: { doctorId: doctor.id, revokedAt: null, startsAt: { not: null }, endsAt: { gt: now }, payment: { status: 'COMPLETED' } },
      orderBy: { startsAt: 'asc' }, select: { startsAt: true, endsAt: true } }),
    app.prisma.subscriptionOrder.findFirst({ where: { doctorId: doctor.id, revokedAt: null, payment: { status: { in: [...pendingStatuses] } } }, include: { payment: { select: { status: true } } } }),
  ]);
  const active = paid.find((order) => order.startsAt && order.startsAt <= now);
  let currentPeriodEnd = active?.endsAt ?? null;
  // Un renouvellement futur ne masque jamais le trou laissé par un remboursement.
  for (const order of paid) {
    if (!currentPeriodEnd || !order.startsAt || !order.endsAt || order.startsAt > currentPeriodEnd) break;
    if (order.endsAt > currentPeriodEnd) currentPeriodEnd = order.endsAt;
  }
  return {
    subscriptionPlan: active ? 'PRO' : 'FREE',
    subscriptionStatus: active ? 'ACTIVE' : doctor.subscriptionPlan !== 'FREE' ? 'EXPIRED' : 'ACTIVE',
    currentPeriodStart: active?.startsAt ?? null, currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(active && doctor.subscriptionCancelledAt), autoRenew: false,
    rights: active ? offer.rights : DOCTOR_SUBSCRIPTION_CATALOG.plans[0].rights,
    pending: pending ? { id: pending.id, paymentId: pending.paymentId, status: pending.payment.status, amount: pending.amount.toString(), currency: pending.currency } : null,
  };
}

export async function history(app: FastifyInstance, userId: string) {
  const doctor = await doctorFor(app, userId);
  return app.prisma.subscriptionOrder.findMany({ where: { doctorId: doctor.id }, orderBy: { createdAt: 'desc' }, take: 50,
    select: { id: true, plan: true, catalogVersion: true, amount: true, currency: true, startsAt: true, endsAt: true, revokedAt: true, createdAt: true, payment: { select: { id: true, status: true, method: true } } } });
}

export async function checkout(app: FastifyInstance, userId: string, orderId: string) {
  const doctor = await doctorFor(app, userId);
  if (!doctor.verifiedAt) throw forbidden('Médecin vérifié requis');
  const order = await app.prisma.subscriptionOrder.findFirst({ where: { id: orderId, doctorId: doctor.id }, include: { payment: true } });
  if (!order) throw notFound('Commande introuvable');
  let paymentUrl: string | null = null;
  if ((pendingStatuses as readonly string[]).includes(order.payment.status) && !order.revokedAt && order.checkoutUrl) {
    try { paymentUrl = openSecret(order.checkoutUrl) as string; } catch { throw badGateway('Lien de paiement indisponible'); }
  }
  return { orderId: order.id, revoked: Boolean(order.revokedAt), payment: { id: order.paymentId, status: order.payment.status, amount: order.amount, currency: order.currency }, paymentUrl };
}

/** FREE = arrêt à l'échéance ; pas de remboursement externe automatique. */
export async function cancel(app: FastifyInstance, userId: string) {
  const doctor = await doctorFor(app, userId);
  await app.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${doctor.id} FOR UPDATE`;
    await tx.doctor.update({ where: { id: doctor.id }, data: { subscriptionCancelledAt: new Date() } });
    // Un règlement fournisseur tardif reste traçable, sans accorder de droits.
    await tx.subscriptionOrder.updateMany({ where: { doctorId: doctor.id, startsAt: null, revokedAt: null }, data: { revokedAt: new Date(), checkoutUrl: null } });
  });
  return current(app, userId);
}

export async function subscribe(app: FastifyInstance, userId: string, input: { plan: string; method?: PaymentMethod; requestId?: string }) {
  if (input.plan === 'FREE') return cancel(app, userId);
  if (input.plan !== 'PRO') throw badRequest('Plan indisponible pendant le pilote');
  if (!input.method || !input.requestId) throw badRequest('Méthode et requestId requis pour un plan payant');
  // A8 (revue GO du 22/10/2026, décision du porteur) : un médecin n'a pas de
  // portefeuille (aucun n'est créé à l'inscription, aucune recharge dans l'espace
  // PRO) ; le choix « Wallet » échouait toujours. Refus explicite AVANT tout effet :
  // l'abonnement se règle par Mobile Money ou carte via FedaPay.
  if (input.method === 'WALLET') throw badRequest('L’abonnement PRO se règle par Mobile Money ou carte, pas par le portefeuille');
  const method = input.method;
  const doctor = await doctorFor(app, userId);
  const cfg = await resolveConfiguredSecrets(app, 'FEDAPAY');
  const result = await app.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${doctor.id} FOR UPDATE`;
    const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { doctor: true, profile: true } });
    if (owner.status !== 'ACTIVE' || owner.role !== 'MEDECIN' || !owner.doctor?.verifiedAt) throw forbidden('Médecin actif et vérifié requis');
    const existing = await tx.subscriptionOrder.findUnique({ where: { doctorId_requestId: { doctorId: doctor.id, requestId: input.requestId! } }, include: { payment: true } });
    if (existing) {
      if (existing.payment.method !== method || existing.plan !== input.plan) throw conflict('requestId déjà utilisé pour une autre commande');
      return { id: existing.id, paymentId: existing.paymentId, created: false };
    }
    const pending = await tx.subscriptionOrder.findFirst({ where: { doctorId: doctor.id, revokedAt: null, payment: { status: { in: [...pendingStatuses] } } } });
    if (pending) throw conflict('Un paiement d’abonnement est déjà en attente', { orderId: pending.id });
    if (!cfg?.secretKey || !cfg.webhookSecret) throw badGateway('Paiement FedaPay non configuré');
    const payment = await tx.payment.create({ data: { userId, type: 'SUBSCRIPTION', method, amount: new Prisma.Decimal(offer.amount), currency: 'XOF', status: 'PENDING' } });
    const order = await tx.subscriptionOrder.create({ data: { doctorId: doctor.id, requestId: input.requestId!, paymentId: payment.id, plan: 'PRO', catalogVersion: DOCTOR_SUBSCRIPTION_CATALOG.version, amount: payment.amount, currency: 'XOF', periodMonths: offer.periodMonths } });
    const upstream = await createTransaction({ amount: offer.amount, method, description: 'Abonnement médecin PRO — 1 mois', log: app.log, secretKey: cfg.secretKey,
      callbackUrl: paymentCallbackUrl('SUBSCRIPTION'), merchantReference: payment.id,
      customer: { firstname: owner.profile?.firstName, lastname: owner.profile?.lastName, phone: owner.phone, email: owner.email ?? undefined }, timeoutMs: 8000 });
    if (!isFedapayCheckoutUrl(upstream.paymentUrl)) throw badGateway('Lien FedaPay invalide');
    await tx.payment.update({ where: { id: payment.id }, data: { fedapayId: upstream.fedapayId } });
    await tx.subscriptionOrder.update({ where: { id: order.id }, data: { checkoutUrl: sealSecret(upstream.paymentUrl) } });
    return { id: order.id, paymentId: payment.id, created: true };
  }, { timeout: 25_000, maxWait: 20_000 });
  return checkout(app, userId, result.id);
}
