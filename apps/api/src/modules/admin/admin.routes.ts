// ─────────────────────────────────────────────────────────────
// Routes Admin (préfixe /api/v1/admin). RBAC : ADMIN.
// Métriques, consultation de l'audit trail, gestion des utilisateurs.
// IMPORTANT : l'admin n'accède JAMAIS au contenu médical du DMP (cloisonnement).
// ─────────────────────────────────────────────────────────────
import { paginationSchema } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit.js';
import { notFound } from '@/lib/errors.js';
import { paginate } from '@/lib/http.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';

const auditQuery = paginationSchema.extend({ action: z.string().optional() });
const idParams = z.object({ id: z.string().cuid() });

export default async function adminRoutes(app: FastifyInstance) {
  const admin = { preHandler: [app.authenticate, requireRole('ADMIN')] };

  // Tableau de bord : métriques globales.
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

  // Audit trail (consultation seule — la table reste append-only).
  app.get('/audit', admin, async (request) => {
    const q = zParse(auditQuery, request.query);
    const where = q.action ? { action: q.action } : {};
    const [items, total] = await Promise.all([
      app.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      app.prisma.auditLog.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  // Gestion des utilisateurs (SANS contenu DMP médical).
  app.get('/users', admin, async (request) => {
    const q = zParse(paginationSchema, request.query);
    const [items, total] = await Promise.all([
      app.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, phone: true, email: true, role: true, status: true, lang: true, createdAt: true, profile: { select: { firstName: true, lastName: true } } },
      }),
      app.prisma.user.count(),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  app.post('/users/:id/suspend', admin, async (request) => {
    const { id } = zParse(idParams, request.params);
    const user = await app.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw notFound('Utilisateur introuvable');
    const updated = await app.prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' }, select: { id: true, status: true } });
    await writeAudit(app.prisma, { action: 'USER_SUSPEND', actorId: request.user.sub, targetId: id, ip: request.ip });
    return updated;
  });

  app.post('/users/:id/activate', admin, async (request) => {
    const { id } = zParse(idParams, request.params);
    const user = await app.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw notFound('Utilisateur introuvable');
    const updated = await app.prisma.user.update({ where: { id }, data: { status: 'ACTIVE' }, select: { id: true, status: true } });
    await writeAudit(app.prisma, { action: 'USER_ACTIVATE', actorId: request.user.sub, targetId: id, ip: request.ip });
    return updated;
  });
}
