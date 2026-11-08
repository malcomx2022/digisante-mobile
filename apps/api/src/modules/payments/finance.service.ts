// L7 — recettes comptables locales, exports minimisés et opérations MANUELLES.
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAuditWithin } from '@/lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '@/lib/errors.js';
import { requireProWithin } from '@/modules/subscriptions/subscriptions.effects.js';
import { lockFinance } from './finance.effects.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const date = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
});
export const periodSchema = z.object({ from: day, to: day }).strict().refine((q) => {
  const span = Date.parse(q.to) - Date.parse(q.from);
  return span >= 0 && span < 366 * 86_400_000;
}, 'Période de 1 à 366 jours requise');
export type Period = z.infer<typeof periodSchema>;
export function periodBounds(period: Period) {
  return { gte: new Date(`${period.from}T00:00:00+01:00`), lt: new Date(Date.parse(`${period.to}T00:00:00+01:00`) + 86_400_000) };
}

async function doctorGuard(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true, role: true, doctor: { select: { id: true, verifiedAt: true } } } });
  if (user?.status !== 'ACTIVE' || user.role !== 'MEDECIN' || !user.doctor?.verifiedAt) throw forbidden('Médecin actif et vérifié requis');
  await requireProWithin(tx, userId);
  return user.doctor.id;
}

async function journalTotals(tx: Prisma.TransactionClient, doctorId: string, occurredAt?: Prisma.DateTimeFilter) {
  const groups = await tx.financeEntry.groupBy({ by: ['kind'], where: { doctorId, occurredAt }, _sum: { gross: true, commission: true, net: true }, _count: { _all: true } });
  const capture = groups.find((g) => g.kind === 'CAPTURE'); const refund = groups.find((g) => g.kind === 'REFUND');
  const gross = capture?._sum.gross ?? new Prisma.Decimal(0);
  const refunds = refund?._sum.gross ?? new Prisma.Decimal(0);
  const commission = (capture?._sum.commission ?? new Prisma.Decimal(0)).minus(refund?._sum.commission ?? 0);
  return { gross: gross.toString(), refunds: refunds.toString(), commission: commission.toString(), net: gross.minus(refunds).minus(commission).toString(), confirmedCount: capture?._count._all ?? 0, refundedCount: refund?._count._all ?? 0 };
}

async function balance(tx: Prisma.TransactionClient, doctorId: string) {
  const total = await journalTotals(tx, doctorId);
  const operations = await tx.financeOperation.groupBy({ by: ['state'], where: { doctorId, kind: 'PAYOUT' }, _sum: { amount: true } });
  const paid = operations.find((g) => g.state === 'EXECUTED')?._sum.amount ?? new Prisma.Decimal(0);
  const reserved = operations.filter((g) => ['REQUESTED', 'EXECUTING'].includes(g.state)).reduce((s, g) => s.plus(g._sum.amount ?? 0), new Prisma.Decimal(0));
  return { netEarned: total.net, paid: paid.toString(), reserved: reserved.toString(), due: new Prisma.Decimal(total.net).minus(paid).toString(), available: new Prisma.Decimal(total.net).minus(paid).minus(reserved).toString() };
}

export async function stats(app: FastifyInstance, userId: string, period: Period) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await app.prisma.$transaction(async (tx) => {
        const doctorId = await doctorGuard(tx, userId); const range = periodBounds(period);
        const revenue = await journalTotals(tx, doctorId, range);
        const appointments = await tx.appointment.groupBy({ by: ['status'], where: { doctorId, scheduledAt: range }, _count: { _all: true } });
        const reviews = await tx.doctorReview.aggregate({ where: { doctorId, createdAt: range }, _count: { _all: true }, _avg: { rating: true } });
        const paid = await tx.financeOperation.aggregate({ where: { doctorId, kind: 'PAYOUT', state: 'EXECUTED', executedAt: range }, _sum: { amount: true } });
        const [legacy] = await tx.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM payments p JOIN appointments a ON a.id = p."appointmentId" WHERE a."doctorId" = ${doctorId} AND p.type = 'CONSULTATION' AND p.status IN ('COMPLETED', 'REFUNDED') AND NOT EXISTS (SELECT 1 FROM finance_entries e WHERE e."paymentId" = p.id AND e.kind = 'CAPTURE')`;
        const total = appointments.reduce((s, a) => s + a._count._all, 0);
        const cancelled = appointments.find((a) => a.status === 'CANCELLED')?._count._all ?? 0;
        return { period: { ...period, timeZone: 'Africa/Lagos' }, currency: 'XOF', revenue, paidInPeriod: (paid._sum.amount ?? 0).toString(), balance: await balance(tx, doctorId),
          activity: { scheduled: total, completed: appointments.find((a) => a.status === 'COMPLETED')?._count._all ?? 0, cancelled, cancellationRate: total ? cancelled / total : null }, satisfaction: { count: reviews._count._all, average: reviews._avg.rating }, legacyUnproven: legacy?.count ?? 0 };
      }, { isolationLevel: 'RepeatableRead' });
    } catch (error) {
      // FOR SHARE peut observer un médecin modifié après le snapshot ; reprendre
      // toute cette lecture conserve la cohérence des agrégats sans rejouer d'effet.
      const serializationFailure = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001'));
      if (!serializationFailure || attempt >= 2) throw error;
    }
  }
}

/** Neutralisation des formules tableur, y compris préfixes invisibles. */
export function csvCell(value: string) {
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function exportJournal(app: FastifyInstance, userId: string, period: Period) {
  return app.prisma.$transaction(async (tx) => {
    const doctorId = await doctorGuard(tx, userId);
    const where = { doctorId, occurredAt: periodBounds(period) };
    const entries = await tx.financeEntry.findMany({ where, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], take: 10_001,
      select: { paymentId: true, kind: true, gross: true, commission: true, net: true, currency: true, occurredAt: true } });
    if (entries.length > 10_000) throw badRequest('Réduire la période : maximum 10 000 écritures');
    const rows = entries.map((e) => [e.paymentId, e.kind, e.occurredAt.toISOString(), e.gross.toString(), e.commission.toString(), e.net.toString(), e.currency]);
    await writeAuditWithin(tx, { action: 'FINANCE_EXPORT', actorId: userId, targetId: doctorId, meta: { count: rows.length } });
    return { filename: `revenus-${period.from}-${period.to}.csv`, content: '\uFEFF' + [['payment_reference', 'event', 'occurred_at_utc', 'gross_xof', 'commission_xof', 'net_xof', 'currency'], ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n'), fiscal: false };
  });
}

export async function receipt(app: FastifyInstance, userId: string, paymentId: string) {
  const payment = await app.prisma.payment.findFirst({ where: { id: paymentId, userId }, select: { id: true, amount: true, currency: true, type: true, status: true, method: true, createdAt: true } });
  if (!payment) throw notFound('Paiement introuvable');
  if (!['COMPLETED', 'REFUNDED'].includes(payment.status)) throw conflict('Paiement non confirmé');
  const entry = await app.prisma.financeEntry.findUnique({ where: { paymentId_kind: { paymentId, kind: 'CAPTURE' } }, select: { occurredAt: true } });
  return { fiscal: false, ...payment, confirmedAt: entry?.occurredAt ?? null };
}

const operationSelect = { id: true, requestId: true, kind: true, state: true, doctorId: true, amount: true, currency: true, requestedBy: true, executingBy: true, executedBy: true, createdAt: true, executingAt: true, executedAt: true, proofRef: true, items: { select: { paymentId: true, providerReference: true, amount: true } } } as const;
export const payoutSchema = z.object({ requestId: z.string().uuid(), doctorId: z.string().cuid(), paymentIds: z.array(z.string().cuid()).min(1).max(100).refine((a) => new Set(a).size === a.length) }).strict();
// Message explicite (recette L10 C7) : renvoyé tel quel par l'UI ; règle inchangée.
export const proofSchema = z.object({ proofRef: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{5,119}$/, 'Référence de preuve : 6 à 120 caractères (lettres, chiffres, _ . : -), commençant par une lettre ou un chiffre') }).strict();

export async function eligible(app: FastifyInstance, doctorId: string, page: number, pageSize: number) {
  return app.prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ paymentId: string; net: Prisma.Decimal; gross: Prisma.Decimal }[]>`
      SELECT e."paymentId", e.net - COALESCE(allocated.amount, 0) AS net, e.gross FROM finance_entries e
      JOIN payments p ON p.id = e."paymentId" JOIN appointments a ON a.id = p."appointmentId"
      LEFT JOIN LATERAL (SELECT sum(i.amount) AS amount FROM finance_operation_items i JOIN finance_operations o ON o.id = i."operationId" WHERE i."paymentId" = e."paymentId" AND o.kind = 'PAYOUT' AND o.state <> 'CANCELLED') allocated ON true
      WHERE e."doctorId" = ${doctorId} AND e.kind = 'CAPTURE' AND p.status = 'COMPLETED'
      AND a.status = 'COMPLETED' AND a."doctorId" = ${doctorId}
      AND NOT EXISTS (SELECT 1 FROM finance_entries r WHERE r."paymentId" = e."paymentId" AND r.kind = 'REFUND')
      AND e.net > COALESCE(allocated.amount, 0)
      ORDER BY e."occurredAt", e.id LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`;
    return { doctorId, balance: await balance(tx, doctorId), data: rows.slice(0, pageSize), hasMore: rows.length > pageSize, page };
  }, { isolationLevel: 'RepeatableRead' });
}

/** Rattrapage explicite d'un REFUNDED historique, sans fabriquer de revenu. */
export async function requestExternalRefund(app: FastifyInstance, actorId: string, paymentId: string) {
  return app.prisma.$transaction(async (tx) => {
    await financeAdminGuard(tx, actorId); await lockFinance(tx);
    const existing = await tx.financeOperation.findUnique({ where: { requestId: `refund:${paymentId}` }, select: operationSelect });
    if (existing) return existing;
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, select: { status: true, method: true, fedapayId: true, currency: true, amount: true } });
    if (!payment) throw notFound('Paiement introuvable');
    if (payment.status !== 'REFUNDED' || payment.method === 'WALLET' || !payment.fedapayId || payment.currency !== 'XOF') throw conflict('Remboursement externe non attribuable');
    const operation = await tx.financeOperation.create({ data: { requestId: `refund:${paymentId}`, kind: 'REFUND', amount: payment.amount, requestedBy: actorId, items: { create: { paymentId, providerReference: payment.fedapayId, amount: payment.amount } } }, select: operationSelect });
    await writeAuditWithin(tx, { action: 'FINANCE_REQUEST', actorId, targetId: operation.id, meta: { kind: 'REFUND', legacy: true } });
    return operation;
  });
}

async function financeAdminGuard(tx: Prisma.TransactionClient, actorId: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM admin_profiles WHERE "userId" = ${actorId} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, status: true, adminProfile: { select: { scopes: true, suspendedAt: true } } } });
  if (user?.role !== 'ADMIN' || user.status !== 'ACTIVE' || !user.adminProfile?.scopes.includes('finance:write') || user.adminProfile.suspendedAt) throw forbidden('Administrateur finance actif requis');
}

export async function requestPayout(app: FastifyInstance, actorId: string, input: z.infer<typeof payoutSchema>) {
  return app.prisma.$transaction(async (tx) => {
    await financeAdminGuard(tx, actorId); await lockFinance(tx);
    const requestHash = createHash('sha256').update(JSON.stringify([input.doctorId, [...input.paymentIds].sort()])).digest('hex');
    const prior = await tx.financeOperation.findUnique({ where: { requestId: input.requestId }, select: { ...operationSelect, requestHash: true } });
    if (prior) {
      if (prior.kind !== 'PAYOUT' || prior.doctorId !== input.doctorId || prior.requestHash !== requestHash) throw conflict('Clé utilisée pour une autre demande');
      return tx.financeOperation.findUniqueOrThrow({ where: { id: prior.id }, select: operationSelect });
    }
    const doctor = await tx.doctor.findFirst({ where: { id: input.doctorId, verifiedAt: { not: null }, user: { role: 'MEDECIN', status: 'ACTIVE' } }, select: { id: true } });
    if (!doctor) throw badRequest('Médecin actif et vérifié requis');
    const captures = await tx.financeEntry.findMany({ where: { doctorId: doctor.id, kind: 'CAPTURE', paymentId: { in: input.paymentIds } } });
    const valid = await tx.payment.count({ where: { id: { in: input.paymentIds }, status: 'COMPLETED', type: 'CONSULTATION', currency: 'XOF', appointment: { doctorId: doctor.id, status: 'COMPLETED' } } });
    const allocated = await tx.financeOperationItem.groupBy({ by: ['paymentId'], where: { paymentId: { in: input.paymentIds }, operation: { kind: 'PAYOUT', state: { not: 'CANCELLED' } } }, _sum: { amount: true } });
    const refunded = await tx.financeEntry.count({ where: { paymentId: { in: input.paymentIds }, kind: 'REFUND' } });
    if (captures.length !== input.paymentIds.length || valid !== input.paymentIds.length || refunded) throw conflict('Paiements non éligibles');
    const remaining = captures.map((e) => ({ paymentId: e.paymentId, amount: e.net.minus(allocated.find((a) => a.paymentId === e.paymentId)?._sum.amount ?? 0) })).sort((a, b) => a.paymentId.localeCompare(b.paymentId));
    if (remaining.some((e) => e.amount.lte(0))) throw conflict('Paiement déjà réservé/reversé');
    const maximum = remaining.reduce((s, e) => s.plus(e.amount), new Prisma.Decimal(0));
    const amount = Prisma.Decimal.min(maximum, (await balance(tx, doctor.id)).available);
    if (amount.lte(0)) throw conflict('Solde net disponible insuffisant');
    // Trop-perçu antérieur : compensation sur la créance globale, sans perte de reliquat.
    let left = amount;
    const items = remaining.flatMap((e) => { const part = Prisma.Decimal.min(left, e.amount); left = left.minus(part); return part.gt(0) ? [{ paymentId: e.paymentId, amount: part }] : []; });
    const operation = await tx.financeOperation.create({ data: { requestId: input.requestId, requestHash, doctorId: doctor.id, kind: 'PAYOUT', amount, requestedBy: actorId, items: { create: items } }, select: operationSelect });
    await writeAuditWithin(tx, { action: 'FINANCE_REQUEST', actorId, targetId: operation.id, meta: { kind: 'PAYOUT', count: input.paymentIds.length } });
    return operation;
  });
}

export async function transition(app: FastifyInstance, actorId: string, id: string, action: 'start' | 'cancel' | 'complete', proofRef?: string) {
  return app.prisma.$transaction(async (tx) => {
    await financeAdminGuard(tx, actorId); await lockFinance(tx);
    const operation = await tx.financeOperation.findUnique({ where: { id }, select: operationSelect });
    if (!operation) throw notFound('Opération introuvable');
    const desired = action === 'start' ? 'EXECUTING' : action === 'cancel' ? 'CANCELLED' : 'EXECUTED';
    if (operation.state === desired) {
      if (action === 'start' && operation.executingBy !== actorId) throw conflict('Exécution déjà attribuée à un autre administrateur');
      if (action === 'complete' && operation.proofRef !== proofRef) throw conflict('Preuve différente de la clôture existante');
      return operation;
    }
    if (operation.state !== (action === 'complete' ? 'EXECUTING' : 'REQUESTED')) throw conflict('Transition financière interdite');
    if (action === 'cancel' && operation.kind === 'REFUND') throw conflict('Obligation de remboursement : rapprocher et clôturer');
    // Une exécution incertaine reste EXECUTING : jamais de remise en file automatique.
    if (action === 'complete' && (!proofRef || await tx.financeOperation.findUnique({ where: { proofRef } }))) throw conflict('Référence de preuve requise et unique');
    const updated = await tx.financeOperation.update({ where: { id }, data: { state: desired,
      ...(action === 'start' ? { executingAt: new Date(), executingBy: actorId } : {}),
      ...(action === 'complete' ? { executedAt: new Date(), executedBy: actorId, proofRef } : {}) }, select: operationSelect });
    await writeAuditWithin(tx, { action: `FINANCE_${desired}`, actorId, targetId: id, meta: { kind: operation.kind } });
    return updated;
  });
}

export async function operations(app: FastifyInstance, page: number, pageSize: number) {
  return app.prisma.$transaction(async (tx) => {
    const [data, total] = await Promise.all([tx.financeOperation.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, select: operationSelect }), tx.financeOperation.count()]);
    return { data, total, page, pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}

/** Héritage non prouvé, retours opérateur non attribués et approbations fournisseur tardives (D-10), sans identité médicale. */
export async function anomalies(app: FastifyInstance, page: number, pageSize: number) {
  const rows = await app.prisma.$queryRaw<{ id: string; amount: Prisma.Decimal; currency: string; status: string; type: string; method: string; providerReference: string | null; doctorId: string | null }[]>`
    SELECT p.id, p.amount, p.currency, p.status, p.type, p.method, p."fedapayId" AS "providerReference", a."doctorId"
    FROM payments p LEFT JOIN appointments a ON a.id = p."appointmentId"
    WHERE (p.type = 'CONSULTATION' AND p.status IN ('COMPLETED', 'REFUNDED') AND NOT EXISTS (SELECT 1 FROM finance_entries e WHERE e."paymentId" = p.id AND e.kind = 'CAPTURE'))
    OR (p.type = 'CONSULTATION' AND p.status = 'COMPLETED' AND a.status = 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM finance_entries e WHERE e."paymentId" = p.id AND e.kind = 'REFUND'))
    OR (p.status = 'REFUNDED' AND p.method <> 'WALLET' AND NOT EXISTS (SELECT 1 FROM finance_operation_items i JOIN finance_operations o ON o.id = i."operationId" WHERE i."paymentId" = p.id AND o.kind = 'REFUND'))
    OR (p.status IN ('FAILED', 'CANCELLED') AND EXISTS (SELECT 1 FROM audit_logs l WHERE l.action = 'PAYMENT_LATE_APPROVAL' AND l."targetId" = p.id))
    ORDER BY p."createdAt", p.id LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`;
  return { data: rows.slice(0, pageSize), hasMore: rows.length > pageSize, page };
}
