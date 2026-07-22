// ─────────────────────────────────────────────────────────────
// Admin — tableau de bord : scopes de l'appelant + métriques globales.
// (Sous-module de /api/v1/admin — cf. admin.routes.ts.)
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

import { getCached } from '@/lib/cache.js';
import { loadAdminScopes } from '@/lib/rbac.js';

import { adminGuards } from './admin.shared.js';

// Métriques du tableau de bord : 5 agrégats pleine-table par affichage — coût
// croissant avec les données. Cache court (agrégats anonymes uniquement, aucune
// PII ni médical → §4-safe) ; l'uptime reste calculé À CHAQUE requête (donnée
// vivante, et propre à chaque worker PM2 de toute façon).
const METRICS_CACHE_KEY = 'admin:metrics';
const METRICS_CACHE_TTL = 30;

export default async function adminDashboardRoutes(app: FastifyInstance) {
  const { admin } = adminGuards(app);

  // Scopes de l'appelant (pour le gating de la nav côté front).
  app.get('/me', admin, async (request) => {
    const { scopes, suspended } = await loadAdminScopes(request);
    return { scopes, suspended };
  });

  // Tableau de bord : métriques globales (tout admin authentifié).
  app.get('/metrics', admin, async () => {
    const metrics = await getCached(app, METRICS_CACHE_KEY, METRICS_CACHE_TTL, async () => {
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
      };
    });
    return { ...metrics, uptimeSeconds: Math.round(process.uptime()) };
  });
}
