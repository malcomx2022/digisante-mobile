// ─────────────────────────────────────────────────────────────
// Admin — gestion des utilisateurs (SANS contenu DMP médical, §4) :
// liste filtrée serveur + suspension / réactivation.
// (Sous-module de /api/v1/admin — cf. admin.routes.ts.)
// ─────────────────────────────────────────────────────────────
import { LANGS, paginationSchema, ROLES, USER_STATUSES } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit.js';
import { forbidden, notFound } from '@/lib/errors.js';
import { paginate } from '@/lib/http.js';
import { zParse } from '@/lib/validation.js';

import { adminGuards, idParams } from './admin.shared.js';

// Filtres serveur de la liste utilisateurs (recherche + rôle/statut/langue).
const usersQuery = paginationSchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  lang: z.enum(LANGS).optional(),
});

export default async function adminUsersRoutes(app: FastifyInstance) {
  const { withScope } = adminGuards(app);

  app.get('/users', withScope('users:read'), async (request) => {
    const q = zParse(usersQuery, request.query);
    const where: Prisma.UserWhereInput = {};
    if (q.role) where.role = q.role;
    if (q.status) where.status = q.status;
    if (q.lang) where.lang = q.lang;
    if (q.q) {
      // Recherche insensible à la casse sur téléphone, e-mail, prénom, nom.
      where.OR = [
        { phone: { contains: q.q, mode: 'insensitive' } },
        { email: { contains: q.q, mode: 'insensitive' } },
        { profile: { is: { firstName: { contains: q.q, mode: 'insensitive' } } } },
        { profile: { is: { lastName: { contains: q.q, mode: 'insensitive' } } } },
      ];
    }
    const [items, total] = await Promise.all([
      app.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, phone: true, email: true, role: true, status: true, lang: true, createdAt: true, profile: { select: { firstName: true, lastName: true } } },
      }),
      app.prisma.user.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  app.post('/users/:id/suspend', withScope('users:write'), async (request) => {
    const { id } = zParse(idParams, request.params);
    const user = await app.prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!user) throw notFound('Utilisateur introuvable');
    // Les comptes ADMIN se gèrent par /admin/admins (scope admin:manage, garde-fous
    // anti-verrouillage) : `users:write` ne doit pas permettre de suspendre un
    // SUPER_ADMIN, ni soi-même.
    if (user.role === 'ADMIN' || id === request.user.sub) {
      throw forbidden('Compte administrateur : gérer via la console des administrateurs');
    }
    const updated = await app.prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' }, select: { id: true, status: true } });
    await writeAudit(app.prisma, { action: 'USER_SUSPEND', actorId: request.user.sub, targetId: id, ip: request.ip });
    return updated;
  });

  app.post('/users/:id/activate', withScope('users:write'), async (request) => {
    const { id } = zParse(idParams, request.params);
    const user = await app.prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!user) throw notFound('Utilisateur introuvable');
    // Les comptes ADMIN se gèrent par /admin/admins (scope admin:manage, garde-fous
    // anti-verrouillage) : `users:write` ne doit pas permettre de réactiver un
    // SUPER_ADMIN, ni soi-même.
    if (user.role === 'ADMIN' || id === request.user.sub) {
      throw forbidden('Compte administrateur : gérer via la console des administrateurs');
    }
    const updated = await app.prisma.user.update({ where: { id }, data: { status: 'ACTIVE' }, select: { id: true, status: true } });
    await writeAudit(app.prisma, { action: 'USER_ACTIVATE', actorId: request.user.sub, targetId: id, ip: request.ip });
    return updated;
  });
}
