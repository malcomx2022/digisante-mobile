// ─────────────────────────────────────────────────────────────
// Service Éducation (CMS) : workflow Brouillon → Relecture médicale →
// Traductions → Publié. La relecture médicale exige un professionnel VÉRIFIÉ.
// Publication par langue via le champ translations (Json).
// ─────────────────────────────────────────────────────────────
import type { ContentCategory, Lang } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { badRequest, forbidden, notFound } from '@/lib/errors.js';
import { canTransition, type ContentStatus } from './education.rules.js';

/** Crée un article en brouillon (admin). */
export async function create(
  app: FastifyInstance,
  input: { title: string; body: string; category: ContentCategory; tags?: string[] },
) {
  return app.prisma.healthContent.create({
    data: { title: input.title, body: input.body, category: input.category, tags: input.tags ?? [], status: 'DRAFT' },
  });
}

async function load(app: FastifyInstance, id: string) {
  const content = await app.prisma.healthContent.findUnique({ where: { id } });
  if (!content) throw notFound('Contenu introuvable');
  return content;
}

function move(current: string, to: ContentStatus) {
  if (!canTransition(current as ContentStatus, to)) {
    throw badRequest(`Transition ${current} → ${to} non autorisée`);
  }
}

/** Soumet un brouillon à la relecture médicale (admin). */
export async function submitForReview(app: FastifyInstance, id: string) {
  const c = await load(app, id);
  move(c.status, 'MEDICAL_REVIEW');
  return app.prisma.healthContent.update({ where: { id }, data: { status: 'MEDICAL_REVIEW' } });
}

/** Relecture médicale par un professionnel VÉRIFIÉ (approbation/rejet). */
export async function medicalReview(app: FastifyInstance, reviewerUserId: string, id: string, approve: boolean) {
  const doctor = await app.prisma.doctor.findUnique({ where: { userId: reviewerUserId }, select: { id: true, verifiedAt: true } });
  if (!doctor) throw forbidden('Profil médecin requis');
  if (!doctor.verifiedAt) throw forbidden('Seul un professionnel vérifié peut valider un contenu médical');

  const c = await load(app, id);
  const to: ContentStatus = approve ? 'TRANSLATION' : 'DRAFT';
  move(c.status, to);
  return app.prisma.healthContent.update({ where: { id }, data: { status: to, reviewedById: doctor.id } });
}

/** Renseigne/MAJ les traductions par langue (admin). */
export async function setTranslations(app: FastifyInstance, id: string, translations: Partial<Record<Lang, { title: string; body: string }>>) {
  await load(app, id);
  return app.prisma.healthContent.update({
    where: { id },
    data: { translations: translations as Prisma.InputJsonValue },
  });
}

/** Publication (admin) : exige l'état TRANSLATION. */
export async function publish(app: FastifyInstance, id: string) {
  const c = await load(app, id);
  move(c.status, 'PUBLISHED');
  return app.prisma.healthContent.update({ where: { id }, data: { status: 'PUBLISHED', isPublished: true } });
}

/** Liste de gestion (admin) : TOUS les contenus, filtre statut/catégorie, paginé. */
export async function listForAdmin(
  app: FastifyInstance,
  params: { status?: ContentStatus; category?: ContentCategory; page: number; pageSize: number },
) {
  const where: Prisma.HealthContentWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.category ? { category: params.category } : {}),
  };
  const [data, total] = await Promise.all([
    app.prisma.healthContent.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    app.prisma.healthContent.count({ where }),
  ]);
  return { data, total, page: params.page, pageSize: params.pageSize };
}

/** Liste des contenus publiés (public), filtre catégorie. */
export async function listPublished(app: FastifyInstance, params: { category?: ContentCategory; page: number; pageSize: number }) {
  const where: Prisma.HealthContentWhereInput = { isPublished: true, ...(params.category ? { category: params.category } : {}) };
  return app.prisma.healthContent.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    skip: (params.page - 1) * params.pageSize,
    take: params.pageSize,
  });
}
