// ─────────────────────────────────────────────────────────────
// Admin — support / OTP : console centrée compte (SANS contenu médical, §4).
// Infos compte + verrou OTP (Redis) + activité d'audit + notes internes ;
// déverrouillage OTP (scope otp:write). (Sous-module de /api/v1/admin.)
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { writeAudit } from '@/lib/audit.js';
import { notFound } from '@/lib/errors.js';
import { zParse } from '@/lib/validation.js';

import { adminGuards, idParams } from './admin.shared.js';

const noteBody = z.object({ body: z.string().trim().min(1).max(2000) });

export default async function adminSupportRoutes(app: FastifyInstance) {
  const { withScope } = adminGuards(app);

  // Console d'un compte : infos + verrou OTP + activité d'audit + notes internes.
  app.get('/support/account/:id', withScope('support:write'), async (request) => {
    const { id } = zParse(idParams, request.params);
    const user = await app.prisma.user.findUnique({
      where: { id },
      select: { id: true, phone: true, email: true, role: true, status: true, lang: true, createdAt: true, profile: { select: { firstName: true, lastName: true } } },
    });
    if (!user) throw notFound('Compte introuvable');
    const [locked, attempts, notes, activity] = await Promise.all([
      app.redis.get(`otp:lock:${user.phone}`),
      app.redis.get(`otp:attempts:${user.phone}`),
      app.prisma.supportNote.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      app.prisma.auditLog.findMany({
        where: {
          OR: [
            { targetId: id },
            { AND: [{ action: { in: ['AUTH_FAIL', 'AUTH_LOCKOUT'] } }, { meta: { path: ['phone'], equals: user.phone } }] },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, action: true, ip: true, createdAt: true },
      }),
    ]);
    return { user, lockout: { locked: Boolean(locked), attempts: Number(attempts ?? 0) }, notes, activity };
  });

  // Déverrouillage OTP : purge le verrou Redis (lock + compteur + fenêtre d'envoi).
  app.post('/support/account/:id/unlock', withScope('otp:write'), async (request) => {
    const { id } = zParse(idParams, request.params);
    const user = await app.prisma.user.findUnique({ where: { id }, select: { id: true, phone: true } });
    if (!user) throw notFound('Compte introuvable');
    await app.redis.del(`otp:lock:${user.phone}`, `otp:attempts:${user.phone}`, `otp:send:${user.phone}`);
    await writeAudit(app.prisma, { action: 'OTP_RESET', actorId: request.user.sub, targetId: id, ip: request.ip, meta: { phone: user.phone } });
    return { unlocked: true };
  });

  // Note interne de support (opérationnelle uniquement, jamais de médical §4).
  app.post('/support/account/:id/notes', withScope('support:write'), async (request) => {
    const { id } = zParse(idParams, request.params);
    const { body } = zParse(noteBody, request.body);
    const user = await app.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw notFound('Compte introuvable');
    return app.prisma.supportNote.create({ data: { userId: id, authorId: request.user.sub, body } });
  });
}
