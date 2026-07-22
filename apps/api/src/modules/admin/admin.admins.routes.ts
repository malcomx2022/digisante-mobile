// ─────────────────────────────────────────────────────────────
// Admin — gestion des administrateurs (RBAC) — scope `admin:manage`.
// Promotion d'un compte, édition des scopes, suspension / réactivation, avec
// garde-fous anti-verrouillage (pas de retrait de son propre droit, pas
// d'auto-suspension). (Sous-module de /api/v1/admin — cf. admin.routes.ts.)
// ─────────────────────────────────────────────────────────────
import {
  type AdminPreset,
  type AdminScope,
  ADMIN_PRESET_NAMES,
  ADMIN_PRESETS,
  ADMIN_SCOPES,
  normalizeBeninPhone,
  paginationSchema,
} from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit.js';
import { badRequest, notFound } from '@/lib/errors.js';
import { paginate } from '@/lib/http.js';
import { zParse } from '@/lib/validation.js';

import { adminGuards, idParams } from './admin.shared.js';

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

export default async function adminAdminsRoutes(app: FastifyInstance) {
  const { withScope } = adminGuards(app);

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
