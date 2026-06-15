// ─────────────────────────────────────────────────────────────
// Avis & notes des médecins. Un patient peut noter un médecin UNIQUEMENT après
// une consultation TERMINÉE (anti-faux avis). Une note par couple (patient, médecin).
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

import { forbidden } from '@/lib/errors.js';

async function patientIdOf(app: FastifyInstance, userId: string): Promise<string> {
  const p = await app.prisma.patient.findUnique({ where: { userId }, select: { id: true } });
  if (!p) throw forbidden('Profil patient requis');
  return p.id;
}

/** Le patient a-t-il eu un RDV TERMINÉ avec ce médecin ? (condition pour noter) */
export async function canReview(app: FastifyInstance, patientId: string, doctorId: string): Promise<boolean> {
  const count = await app.prisma.appointment.count({ where: { patientId, doctorId, status: 'COMPLETED' } });
  return count > 0;
}

const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

/** Crée ou met à jour l'avis du patient sur un médecin (éligibilité requise). */
export async function upsertReview(
  app: FastifyInstance,
  userId: string,
  doctorId: string,
  input: { rating: number; comment?: string },
) {
  const patientId = await patientIdOf(app, userId);
  if (!(await canReview(app, patientId, doctorId))) {
    throw forbidden('Vous pourrez noter ce médecin après une consultation terminée');
  }
  return app.prisma.doctorReview.upsert({
    where: { doctorId_patientId: { doctorId, patientId } },
    create: { doctorId, patientId, rating: input.rating, comment: input.comment ?? null },
    update: { rating: input.rating, comment: input.comment ?? null },
    select: { id: true, rating: true, comment: true, updatedAt: true },
  });
}

/** Liste des avis d'un médecin + résumé (moyenne, nombre). */
export async function listReviews(app: FastifyInstance, doctorId: string) {
  const [reviews, agg] = await Promise.all([
    app.prisma.doctorReview.findMany({
      where: { doctorId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        rating: true,
        comment: true,
        updatedAt: true,
        patient: { select: { user: { select: { profile: { select: { firstName: true } } } } } },
      },
    }),
    app.prisma.doctorReview.aggregate({ where: { doctorId }, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  return {
    summary: { average: round1(agg._avg.rating), count: agg._count._all },
    reviews: reviews.map((r) => ({
      rating: r.rating,
      comment: r.comment,
      name: r.patient.user.profile?.firstName ?? '—',
      at: r.updatedAt,
    })),
  };
}

export interface RatingSummary {
  average: number | null;
  count: number;
}

/** Note moyenne + nombre par médecin (pour l'annuaire). */
export async function ratingByDoctor(app: FastifyInstance, doctorIds: string[]): Promise<Map<string, RatingSummary>> {
  if (doctorIds.length === 0) return new Map();
  const groups = await app.prisma.doctorReview.groupBy({
    by: ['doctorId'],
    where: { doctorId: { in: doctorIds } },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.doctorId, { average: round1(g._avg.rating), count: g._count._all }]));
}
