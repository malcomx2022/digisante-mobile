// ─────────────────────────────────────────────────────────────
// Routes Admin (préfixe /api/v1/admin). RBAC : ADMIN + scopes (cf. rbac.ts).
// Métriques, audit, gestion des utilisateurs ET des administrateurs (RBAC).
// IMPORTANT : l'admin n'accède JAMAIS au contenu médical du DMP (cloisonnement).
// ─────────────────────────────────────────────────────────────
import {
  type AdminPreset,
  type AdminScope,
  ADMIN_PRESET_NAMES,
  ADMIN_PRESETS,
  ADMIN_SCOPES,
  LANGS,
  normalizeBeninPhone,
  paginationSchema,
  ROLES,
  USER_STATUSES,
} from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit.js';
import { badRequest, notFound } from '@/lib/errors.js';
import { paginate } from '@/lib/http.js';
import { loadAdminScopes, requireRole, requireScope } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';

const auditQuery = paginationSchema.extend({ action: z.string().optional() });
const idParams = z.object({ id: z.string().cuid() });

// Filtres serveur de la liste utilisateurs (recherche + rôle/statut/langue).
const usersQuery = paginationSchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  lang: z.enum(LANGS).optional(),
});

const presetEnum = z.enum([...ADMIN_PRESET_NAMES] as [AdminPreset, ...AdminPreset[]]);
const scopeEnum = z.enum([...ADMIN_SCOPES] as [AdminScope, ...AdminScope[]]);

const createAdminBody = z.object({ phone: z.string().min(6), preset: presetEnum });
const updateAdminBody = z
  .object({ preset: presetEnum.optional(), scopes: z.array(scopeEnum).optional() })
  .refine((b) => b.preset !== undefined || b.scopes !== undefined, { message: 'preset ou scopes requis' });

// Projection d'un profil admin pour l'UI (jamais de DMP, §4).
const adminSelect = {
  id: true,
  scopes: true,
  preset: true,
  suspendedAt: true,
  createdAt: true,
  user: { select: { id: true, phone: true, status: true, profile: { select: { firstName: true, lastName: true } } } },
} as const;

export default async function adminRoutes(app: FastifyInstance) {
  const admin = { preHandler: [app.authenticate, requireRole('ADMIN')] };
  const withScope = (...scopes: AdminScope[]) => ({
    preHandler: [app.authenticate, requireRole('ADMIN'), requireScope(...scopes)],
  });

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

  // ── Gestion des utilisateurs (SANS contenu DMP médical, §4) ──
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
    const user = await app.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw notFound('Utilisateur introuvable');
    const updated = await app.prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' }, select: { id: true, status: true } });
    await writeAudit(app.prisma, { action: 'USER_SUSPEND', actorId: request.user.sub, targetId: id, ip: request.ip });
    return updated;
  });

  app.post('/users/:id/activate', withScope('users:write'), async (request) => {
    const { id } = zParse(idParams, request.params);
    const user = await app.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw notFound('Utilisateur introuvable');
    const updated = await app.prisma.user.update({ where: { id }, data: { status: 'ACTIVE' }, select: { id: true, status: true } });
    await writeAudit(app.prisma, { action: 'USER_ACTIVATE', actorId: request.user.sub, targetId: id, ip: request.ip });
    return updated;
  });

  // ── Gestion des administrateurs (RBAC) — scope `admin:manage` ──
  app.get('/admins', withScope('admin:manage'), async (request) => {
    const q = zParse(paginationSchema, request.query);
    const [items, total] = await Promise.all([
      app.prisma.adminProfile.findMany({ orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: adminSelect }),
      app.prisma.adminProfile.count(),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  // Promeut un compte EXISTANT (par téléphone) en administrateur, avec un preset.
  app.post('/admins', withScope('admin:manage'), async (request, reply) => {
    const { phone, preset } = zParse(createAdminBody, request.body);
    const user = await app.prisma.user.findUnique({ where: { phone: normalizeBeninPhone(phone) }, select: { id: true, role: true } });
    if (!user) throw notFound('Aucun compte avec ce numéro (le compte doit déjà exister)');
    const scopes = [...ADMIN_PRESETS[preset]];
    const profile = await app.prisma.$transaction(async (tx) => {
      if (user.role !== 'ADMIN') await tx.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
      return tx.adminProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, scopes, preset, createdById: request.user.sub },
        update: { scopes, preset, suspendedAt: null },
        select: adminSelect,
      });
    });
    await writeAudit(app.prisma, { action: 'ADMIN_CREATE', actorId: request.user.sub, targetId: user.id, ip: request.ip, meta: { preset, scopes } });
    return reply.code(201).send(profile);
  });

  // Édite les scopes (via preset ou liste explicite).
  app.patch('/admins/:id', withScope('admin:manage'), async (request) => {
    const { id } = zParse(idParams, request.params);
    const body = zParse(updateAdminBody, request.body);
    const target = await app.prisma.adminProfile.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!target) throw notFound('Profil administrateur introuvable');
    const scopes = body.preset ? [...ADMIN_PRESETS[body.preset]] : body.scopes!;
    // Anti-verrouillage : on ne peut pas retirer SON PROPRE droit de gestion.
    if (target.userId === request.user.sub && !scopes.includes('admin:manage')) {
      throw badRequest('Vous ne pouvez pas retirer votre propre droit de gestion des administrateurs');
    }
    const updated = await app.prisma.adminProfile.update({ where: { id }, data: { scopes, preset: body.preset ?? null }, select: adminSelect });
    await writeAudit(app.prisma, { action: 'ADMIN_SCOPE_CHANGE', actorId: request.user.sub, targetId: target.userId, ip: request.ip, meta: { scopes, preset: body.preset ?? null } });
    return updated;
  });

  app.post('/admins/:id/suspend', withScope('admin:manage'), async (request) => {
    const { id } = zParse(idParams, request.params);
    const target = await app.prisma.adminProfile.findUnique({ where: { id }, select: { userId: true } });
    if (!target) throw notFound('Profil administrateur introuvable');
    if (target.userId === request.user.sub) throw badRequest('Vous ne pouvez pas vous suspendre vous-même');
    const updated = await app.prisma.adminProfile.update({ where: { id }, data: { suspendedAt: new Date() }, select: adminSelect });
    await writeAudit(app.prisma, { action: 'ADMIN_SUSPEND', actorId: request.user.sub, targetId: target.userId, ip: request.ip });
    return updated;
  });

  app.post('/admins/:id/activate', withScope('admin:manage'), async (request) => {
    const { id } = zParse(idParams, request.params);
    const target = await app.prisma.adminProfile.findUnique({ where: { id }, select: { userId: true } });
    if (!target) throw notFound('Profil administrateur introuvable');
    const updated = await app.prisma.adminProfile.update({ where: { id }, data: { suspendedAt: null }, select: adminSelect });
    await writeAudit(app.prisma, { action: 'ADMIN_ACTIVATE', actorId: request.user.sub, targetId: target.userId, ip: request.ip });
    return updated;
  });
}
