// ─────────────────────────────────────────────────────────────
// Admin — audit trail (consultation seule ; la table reste append-only, §4).
// (Sous-module de /api/v1/admin — cf. admin.routes.ts.)
// ─────────────────────────────────────────────────────────────
import { paginationSchema } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { paginate } from '@/lib/http.js';
import { zParse } from '@/lib/validation.js';

import { adminGuards } from './admin.shared.js';

const auditQuery = paginationSchema.extend({ action: z.string().optional() });

export default async function adminAuditRoutes(app: FastifyInstance) {
  const { withScope } = adminGuards(app);

  // Audit trail (consultation seule — la table reste append-only).
  app.get('/audit', withScope('audit:read'), async (request) => {
    const q = zParse(auditQuery, request.query);
    const where = q.action ? { action: q.action } : {};
    const [items, total] = await Promise.all([
      app.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      app.prisma.auditLog.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });
}
