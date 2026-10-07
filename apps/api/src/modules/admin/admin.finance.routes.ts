// ─────────────────────────────────────────────────────────────
// Admin — finances : supervision, remboursements internes et opérations manuelles L7.
// Aucune lecture DMP ni transfert fournisseur automatique. Scopes finance:read/write,
// états et montants serveur ; audit transactionnel dans les services financiers.
// Les modifications du chemin paiement restent soumises à revue/re-tests §3.5 ;
// voir REVUE_L7_2026-10.md et CONTRAT_Finances_L7.md.
// Sous-module /api/v1/admin, agrégé par admin.routes.ts.
// ─────────────────────────────────────────────────────────────
import { paginationSchema } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { paginate } from '@/lib/http.js';
import { zParse } from '@/lib/validation.js';
import * as payments from '@/modules/payments/payments.service.js';
import * as finance from '@/modules/payments/finance.service.js';

import { adminGuards, idParams } from './admin.shared.js';

// Tableau de bord finances : fenêtre d'observation (jours).
const financeQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
// Remboursement admin : motif libre optionnel.
const refundBody = z.object({ reason: z.string().trim().max(200).optional() });

export default async function adminFinanceRoutes(app: FastifyInstance) {
  const { withScope } = adminGuards(app);
  app.get('/finance/operations', withScope('finance:read'), async (request) => {
    const q = zParse(paginationSchema, request.query);
    return finance.operations(app, q.page, q.pageSize);
  });
  app.get('/finance/anomalies', withScope('finance:read'), async (request) => {
    const q = zParse(paginationSchema, request.query);
    return finance.anomalies(app, q.page, q.pageSize);
  });
  app.get('/finance/eligible', withScope('finance:read'), async (request) => {
    const q = zParse(paginationSchema.extend({ doctorId: z.string().cuid() }), request.query);
    return finance.eligible(app, q.doctorId, q.page, q.pageSize);
  });
  app.post('/finance/payments/:id/external-refund', withScope('finance:write'), async (request) => finance.requestExternalRefund(app, request.user.sub, zParse(idParams, request.params).id));
  app.post('/finance/payouts', withScope('finance:write'), async (request) => finance.requestPayout(app, request.user.sub, zParse(finance.payoutSchema, request.body)));
  app.post('/finance/operations/:id/start', withScope('finance:write'), async (request) => finance.transition(app, request.user.sub, zParse(idParams, request.params).id, 'start'));
  app.post('/finance/operations/:id/cancel', withScope('finance:write'), async (request) => finance.transition(app, request.user.sub, zParse(idParams, request.params).id, 'cancel'));
  app.post('/finance/operations/:id/complete', withScope('finance:write'), async (request) => finance.transition(app, request.user.sub, zParse(idParams, request.params).id, 'complete', zParse(finance.proofSchema, request.body).proofRef));

  // Tableau de bord : volumes par statut/méthode, file de réconciliation, wallets.
  // Aucune écriture, aucun déclenchement : pure consultation (scope finance:read).
  app.get('/finance/overview', withScope('finance:read'), async (request) => {
    const { days } = zParse(financeQuery, request.query);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // Même critère que le cron (PENDING/PROCESSING anciens avec fedapayId).
    const recWhere = payments.reconciliationWhere();
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
