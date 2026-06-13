// ─────────────────────────────────────────────────────────────
// Routes Utilisateurs (préfixe /api/v1/users) — profil de l'utilisateur courant.
// Langues parlées (spokenLangs) éditables ici (🗣 fiche personne, CLAUDE.md §5).
// ─────────────────────────────────────────────────────────────
import { langSchema } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { notFound } from '@/lib/errors.js';
import { zParse } from '@/lib/validation.js';

const deviceSchema = z.object({
  fcmToken: z.string().trim().min(1).max(512),
});

const updateMeSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.string().max(40).optional(),
  address: z.string().max(255).optional(),
  emergencyContact: z.string().max(80).optional(),
  avatarUrl: z.string().url().optional(),
  spokenLangs: z.array(langSchema).max(5).optional(),
  lang: langSchema.optional(),
});

const meInclude = {
  profile: true,
  patient: { select: { id: true, bloodGroup: true } },
  doctor: { select: { id: true, speciality: true, verifiedAt: true } },
} as const;

export default async function usersRoutes(app: FastifyInstance) {
  // Profil complet de l'utilisateur courant.
  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    const me = await app.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { id: true, phone: true, email: true, role: true, status: true, lang: true, ...meInclude },
    });
    if (!me) throw notFound('Utilisateur introuvable');
    return me;
  });

  // Mise à jour du profil + langue d'UI + langues parlées.
  app.patch('/me', { preHandler: [app.authenticate] }, async (request) => {
    const input = zParse(updateMeSchema, request.body);
    const { lang, ...profileFields } = input;

    const updated = await app.prisma.user.update({
      where: { id: request.user.sub },
      data: {
        ...(lang ? { lang } : {}),
        ...(Object.keys(profileFields).length > 0
          ? { profile: { update: profileFields } }
          : {}),
      },
      select: { id: true, phone: true, email: true, role: true, status: true, lang: true, ...meInclude },
    });
    return updated;
  });

  // Enregistrement du token push FCM de l'appareil courant.
  // Sans cet endpoint, aucune notification push ne peut être délivrée.
  app.post('/me/device', { preHandler: [app.authenticate] }, async (request) => {
    const { fcmToken } = zParse(deviceSchema, request.body);
    const updated = await app.prisma.user.update({
      where: { id: request.user.sub },
      data: { fcmToken },
      select: { id: true, role: true, fcmToken: true },
    });
    return updated;
  });
}
