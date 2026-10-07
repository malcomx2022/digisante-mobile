// ─────────────────────────────────────────────────────────────
// Routes Professionnels (préfixe /api/v1/professionals).
// Fiche publique (badge « vérifié ») + édition de sa fiche par le médecin.
// ─────────────────────────────────────────────────────────────
import { langSchema, paginationSchema } from '@digisante/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getCached } from '@/lib/cache.js';
import { forbidden, notFound } from '@/lib/errors.js';
import { paginate } from '@/lib/http.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as reviews from './professionals.reviews.js';
import * as finance from '@/modules/payments/finance.service.js';

// ── Cache de l'annuaire (endpoint patient le plus sollicité : 3 requêtes DB/hit) ──
// Uniquement les pages de NAVIGATION (sans filtre libre) : les valeurs de `q`/
// `speciality` sont non bornées → les mettre en clé laisserait n'importe quel
// utilisateur gonfler Redis de clés poubelles. La clé (lang×page×pageSize) est
// bornée, la réponse est IDENTIQUE pour tous (le tri « parle ma langue » est
// côté client, §8) et ne contient que la fiche professionnelle PUBLIQUE des
// médecins vérifiés (annuaire assumé — aucune donnée patient/santé, §4).
// TTL court : pas d'invalidation croisée (édition de fiche, avis, KYC) — une
// modification apparaît sous ≤ 60 s, imperceptible pour un annuaire.
const LIST_CACHE_TTL = 60;
const LIST_CACHE_MAX_PAGE = 10; // profondeur réaliste de navigation (borne les clés)

const updateProSchema = z.object({
  speciality: z.string().trim().min(2).max(120).optional(),
  slotDuration: z.number().int().min(5).max(120).optional(),
  consultFee: z.number().nonnegative().optional(),
  bio: z.string().max(2000).optional(),
});

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

const listSchema = paginationSchema.extend({
  speciality: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).optional(),
  lang: langSchema.optional(), // langue parlée par le médecin (barrière linguistique, §4/§5)
});

const idParams = z.object({ id: z.string().cuid() });

export default async function professionalsRoutes(app: FastifyInstance) {
  const doctor = { preHandler: [app.authenticate, requireRole('MEDECIN')] };
  app.get('/me/revenue', doctor, async (request) => finance.stats(app, request.user.sub, zParse(finance.periodSchema, request.query)));
  app.get('/me/revenue/export', doctor, async (request) => finance.exportJournal(app, request.user.sub, zParse(finance.periodSchema, request.query)));
  // Annuaire des professionnels VÉRIFIÉS (D-05), paginé + filtres.
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const q = zParse(listSchema, request.query);

    const build = async () => {
      const and: Prisma.DoctorWhereInput[] = [{ verifiedAt: { not: null } }];
      if (q.speciality) and.push({ speciality: { contains: q.speciality, mode: 'insensitive' } });
      if (q.lang) and.push({ user: { profile: { spokenLangs: { has: q.lang } } } });
      if (q.q) {
        and.push({
          OR: [
            { speciality: { contains: q.q, mode: 'insensitive' } },
            { user: { profile: { OR: [{ firstName: { contains: q.q, mode: 'insensitive' } }, { lastName: { contains: q.q, mode: 'insensitive' } }] } } },
          ],
        });
      }
      const where: Prisma.DoctorWhereInput = { AND: and };
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
      const ratings = await reviews.ratingByDoctor(app, items.map((d) => d.id));
      const data = items.map((d) => ({
        id: d.id,
        speciality: d.speciality,
        consultFee: d.consultFee,
        isVerified: true,
        profile: d.user.profile,
        rating: ratings.get(d.id) ?? { average: null, count: 0 },
      }));
      return paginate(data, total, q.page, q.pageSize);
    };

    // Recherches libres (`q`/`speciality`) et pages profondes : jamais en cache
    // (clés non bornées) — exécution directe.
    if (q.q || q.speciality || q.page > LIST_CACHE_MAX_PAGE) return build();
    return getCached(app, `professionals:list:${q.lang ?? 'all'}:${q.page}:${q.pageSize}`, LIST_CACHE_TTL, build);
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
    const { summary } = await reviews.listReviews(app, id);

    // Le patient peut-il noter ce médecin ? (RDV terminé)
    let canReview = false;
    if (request.user.role === 'PATIENT') {
      const patient = await app.prisma.patient.findUnique({ where: { userId: request.user.sub }, select: { id: true } });
      if (patient) canReview = await reviews.canReview(app, patient.id, id);
    }

    return {
      ...rest,
      isVerified: verifiedAt !== null, // badge « vérifié » → consultations payantes débloquées
      profile: user.profile,
      lang: user.lang,
      rating: summary,
      canReview,
    };
  });

  // Avis d'un médecin (liste + résumé).
  app.get('/:id/reviews', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = zParse(idParams, request.params);
    return reviews.listReviews(app, id);
  });

  // Noter un médecin (patient ayant eu une consultation terminée).
  app.post('/:id/reviews', { preHandler: [app.authenticate, requireRole('PATIENT')] }, async (request, reply) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(reviewSchema, request.body);
    return reply.code(201).send(await reviews.upsertReview(app, request.user.sub, id, input));
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
