// ─────────────────────────────────────────────────────────────
// Admin — finances (LECTURE SEULE — la logique paiement reste GELÉE §5).
// Tableau de bord (volumes, réconciliation, wallets), remboursement (reversal
// interne §5-encadré) et journal webhooks dérivé de l'audit.
// ⚠️ §5 : ce sous-module ne fait que RELOCALISER les routes existantes — la
// logique de paiement (payments.service) est INCHANGÉE. Toute modification de
// cette logique (pas de sa localisation) exige revue + re-tests webhooks.
// (Sous-module de /api/v1/admin — cf. admin.routes.ts.)
// ─────────────────────────────────────────────────────────────
import { paginationSchema } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { paginate } from '@/lib/http.js';
import { zParse } from '@/lib/validation.js';
import * as payments from '@/modules/payments/payments.service.js';

import { adminGuards, idParams } from './admin.shared.js';

// Tableau de bord finances : fenêtre d'observation (jours).
const financeQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
// Remboursement admin : motif libre optionnel.
const refundBody = z.object({ reason: z.string().trim().max(200).optional() });

export default async function adminFinanceRoutes(app: FastifyInstance) {
  const { withScope } = adminGuards(app);

  // Tableau de bord : volumes par statut/méthode, file de réconciliation, wallets.
  // Aucune écriture, aucun déclenchement : pure consultation (scope finance:read).
  app.get('/finance/overview', withScope('finance:read'), async (request) => {
    const { days } = zParse(financeQuery, request.query);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // Même critère que la réconciliation cron (PENDING ancien > 1 h avec fedapayId).
    const recThreshold = new Date(Date.now() - 60 * 60 * 1000);
    const recWhere = { status: 'PENDING' as const, createdAt: { lt: recThreshold }, fedapayId: { not: null } };
    const [byStatus, byMethod, backlog, oldest, recentCompleted, walletAgg, walletActive, walletMoves] = await Promise.all([
      app.prisma.payment.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { amount: true } }),
      app.prisma.payment.groupBy({ by: ['method'], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { amount: true } }),
      app.prisma.payment.count({ where: recWhere }),
      app.prisma.payment.findMany({ where: recWhere, orderBy: { createdAt: 'asc' }, take: 20, select: { id: true, amount: true, method: true, type: true, fedapayId: true, createdAt: true } }),
      // Paiements confirmés récents — cibles potentielles d'un remboursement admin.
      app.prisma.payment.findMany({ where: { status: 'COMPLETED' }, orderBy: { updatedAt: 'desc' }, take: 10, select: { id: true, amount: true, method: true, type: true, createdAt: true } }),
      app.prisma.wallet.aggregate({ _sum: { balance: true }, _count: { _all: true } }),
      app.prisma.wallet.count({ where: { balance: { gt: 0 } } }),
      app.prisma.walletTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, type: true, amount: true, reference: true, createdAt: true } }),
    ]);
    return {
      periodDays: days,
      currency: 'XOF',
      payments: {
        byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all, volume: r._sum.amount ?? 0 })),
        byMethod: byMethod.map((r) => ({ method: r.method, count: r._count._all, volume: r._sum.amount ?? 0 })),
        recentCompleted,
      },
      reconciliation: { backlog, oldest },
      wallets: { totalBalance: walletAgg._sum.balance ?? 0, count: walletAgg._count._all, active: walletActive, recentMovements: walletMoves },
    };
  });

  // Remboursement (reversal interne) d'un paiement confirmé — ⚠️ §5, scope
  // finance:write. Aucun appel FedaPay externe : marque REFUNDED, reverse le
  // crédit wallet le cas échéant, journalise PAYMENT_REFUND (idempotent).
  app.post('/finance/payments/:id/refund', withScope('finance:write'), async (request) => {
    const { id } = zParse(idParams, request.params);
    const { reason } = zParse(refundBody, request.body);
    return payments.refund(app, id, { actorId: request.user.sub, ip: request.ip, reason });
  });

  // Journal des webhooks FedaPay — DÉRIVÉ de l'audit immuable (aucune table
  // dédiée, donc aucune écriture sur le chemin webhook gelé §5). Couvre les
  // confirmations (PAYMENT_CONFIRMED, source webhook/reconcile) et les
  // signatures rejetées (AUTH_FAIL source fedapay_webhook).
  app.get('/finance/webhooks', withScope('webhooks:read'), async (request) => {
    const q = zParse(paginationSchema, request.query);
    const where: Prisma.AuditLogWhereInput = {
      OR: [
        { action: 'PAYMENT_CONFIRMED' },
        { AND: [{ action: 'AUTH_FAIL' }, { meta: { path: ['source'], equals: 'fedapay_webhook' } }] },
      ],
    };
    const [rows, total] = await Promise.all([
      app.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, action: true, ip: true, meta: true, createdAt: true } }),
      app.prisma.auditLog.count({ where }),
    ]);
    const items = rows.map((r) => {
      const meta = (r.meta ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        action: r.action,
        outcome: r.action === 'AUTH_FAIL' ? ('rejected' as const) : ('accepted' as const),
        source: typeof meta.source === 'string' ? meta.source : null,
        fedapayId: typeof meta.fedapayId === 'string' ? meta.fedapayId : null,
        ip: r.ip,
        createdAt: r.createdAt,
      };
    });
    return paginate(items, total, q.page, q.pageSize);
  });
}
