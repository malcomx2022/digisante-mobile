// ─────────────────────────────────────────────────────────────
// Routes Professionnels (préfixe /api/v1/professionals).
// Fiche publique (badge « vérifié ») + édition de sa fiche par le médecin.
// ─────────────────────────────────────────────────────────────
import { paginationSchema } from '@digisante/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { forbidden, notFound } from '@/lib/errors.js';
import { paginate } from '@/lib/http.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';

const updateProSchema = z.object({
  speciality: z.string().trim().min(2).max(120).optional(),
  slotDuration: z.number().int().min(5).max(120).optional(),
  consultFee: z.number().nonnegative().optional(),
  bio: z.string().max(2000).optional(),
});

const listSchema = paginationSchema.extend({
  speciality: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).optional(),
});

const idParams = z.object({ id: z.string().cuid() });

export default async function professionalsRoutes(app: FastifyInstance) {
  // Annuaire des professionnels VÉRIFIÉS (D-05), paginé + filtres.
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const q = zParse(listSchema, request.query);
    const where: Prisma.DoctorWhereInput = {
      verifiedAt: { not: null },
      ...(q.speciality ? { speciality: { contains: q.speciality, mode: 'insensitive' } } : {}),
      ...(q.q
        ? {
            OR: [
              { speciality: { contains: q.q, mode: 'insensitive' } },
              { user: { profile: { OR: [{ firstName: { contains: q.q, mode: 'insensitive' } }, { lastName: { contains: q.q, mode: 'insensitive' } }] } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      app.prisma.doctor.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          speciality: true,
          consultFee: true,
          user: { select: { profile: { select: { firstName: true, lastName: true, spokenLangs: true, avatarUrl: true } } } },
        },
      }),
      app.prisma.doctor.count({ where }),
    ]);
    const data = items.map((d) => ({ id: d.id, speciality: d.speciality, consultFee: d.consultFee, isVerified: true, profile: d.user.profile }));
    return paginate(data, total, q.page, q.pageSize);
  });

  // Fiche publique d'un professionnel (authentifié).
  app.get('/:id', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = zParse(idParams, request.params);
    const doctor = await app.prisma.doctor.findUnique({
      where: { id },
      select: {
        id: true,
        speciality: true,
        consultFee: true,
        bio: true,
        verifiedAt: true,
        user: { select: { lang: true, profile: { select: { firstName: true, lastName: true, spokenLangs: true, avatarUrl: true } } } },
      },
    });
    if (!doctor) throw notFound('Professionnel introuvable');

    const { verifiedAt, user, ...rest } = doctor;
    return {
      ...rest,
      isVerified: verifiedAt !== null, // badge « vérifié » → consultations payantes débloquées
      profile: user.profile,
      lang: user.lang,
    };
  });

  // Mise à jour de sa propre fiche professionnelle (MEDECIN).
  app.patch('/me', { preHandler: [app.authenticate, requireRole('MEDECIN')] }, async (request) => {
    const input = zParse(updateProSchema, request.body);
    const doctor = await app.prisma.doctor.findUnique({
      where: { userId: request.user.sub },
      select: { id: true },
    });
    if (!doctor) throw forbidden('Aucune fiche médecin associée à ce compte');

    return app.prisma.doctor.update({
      where: { id: doctor.id },
      data: input,
      select: { id: true, speciality: true, slotDuration: true, consultFee: true, bio: true, verifiedAt: true },
    });
  });
}
