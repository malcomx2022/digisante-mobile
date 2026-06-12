// ─────────────────────────────────────────────────────────────
// Routes Professionnels (préfixe /api/v1/professionals).
// Fiche publique (badge « vérifié ») + édition de sa fiche par le médecin.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { forbidden, notFound } from '@/lib/errors.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';

const updateProSchema = z.object({
  speciality: z.string().trim().min(2).max(120).optional(),
  slotDuration: z.number().int().min(5).max(120).optional(),
  consultFee: z.number().nonnegative().optional(),
  bio: z.string().max(2000).optional(),
});

const idParams = z.object({ id: z.string().cuid() });

export default async function professionalsRoutes(app: FastifyInstance) {
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
