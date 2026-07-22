// ─────────────────────────────────────────────────────────────
// Admin — tableau de bord : scopes de l'appelant + métriques globales.
// (Sous-module de /api/v1/admin — cf. admin.routes.ts.)
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

import { loadAdminScopes } from '@/lib/rbac.js';

import { adminGuards } from './admin.shared.js';

export default async function adminDashboardRoutes(app: FastifyInstance) {
  const { admin } = adminGuards(app);

  // Scopes de l'appelant (pour le gating de la nav côté front).
  app.get('/me', admin, async (request) => {
    const { scopes, suspended } = await loadAdminScopes(request);
    return { scopes, suspended };
  });

  // Tableau de bord : métriques globales (tout admin authentifié).
  app.get('/metrics', admin, async () => {
    const [usersByRole, consultationsActive, consultationsTotal, paymentAgg, kycPending] = await Promise.all([
      app.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      app.prisma.consultation.count({ where: { status: 'ACTIVE' } }),
      app.prisma.consultation.count(),
      app.prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'COMPLETED' } }),
      app.prisma.kycSubmission.count({ where: { status: 'UNDER_REVIEW' } }),
    ]);
    return {
      users: Object.fromEntries(usersByRole.map((u) => [u.role, u._count._all])),
      consultations: { active: consultationsActive, total: consultationsTotal },
      payments: { completedVolume: paymentAgg._sum.amount ?? 0, currency: 'XOF' },
      kyc: { pendingReview: kycPending },
      uptimeSeconds: Math.round(process.uptime()),
    };
  });
}
