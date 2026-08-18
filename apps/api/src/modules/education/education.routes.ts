// ─────────────────────────────────────────────────────────────
// Routes Éducation (préfixe /api/v1/education).
// ─────────────────────────────────────────────────────────────
import { CONTENT_CATEGORIES, langSchema, paginationSchema } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole, requireScope } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import { CONTENT_STATUSES } from './education.rules.js';
import * as education from './education.service.js';

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1),
  category: z.enum(CONTENT_CATEGORIES),
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
});
const reviewSchema = z.object({ approve: z.boolean() });
const translationsSchema = z.object({
  translations: z.record(langSchema, z.object({ title: z.string(), body: z.string() })),
});
const listSchema = paginationSchema.extend({ category: z.enum(CONTENT_CATEGORIES).optional() });
const manageListSchema = listSchema.extend({ status: z.enum(CONTENT_STATUSES).optional() });
const idParams = z.object({ id: z.string().cuid() });

export default async function educationRoutes(app: FastifyInstance) {
  const admin = { preHandler: [app.authenticate, requireRole('ADMIN'), requireScope('education:write')] };
  const doctor = { preHandler: [app.authenticate, requireRole('MEDECIN')] };

  // Catalogue public des contenus publiés.
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const q = zParse(listSchema, request.query);
    return education.listPublished(app, { category: q.category, page: q.page, pageSize: q.pageSize });
  });

  // Liste de gestion (admin) — TOUS les statuts (pipeline éditorial).
  app.get('/manage', admin, async (request) => {
    const q = zParse(manageListSchema, request.query);
    return education.listForAdmin(app, { status: q.status, category: q.category, page: q.page, pageSize: q.pageSize });
  });

  app.post('/', admin, async (request, reply) => {
    const input = zParse(createSchema, request.body);
    return reply.code(201).send(await education.create(app, input));
  });

  app.post('/:id/submit-review', admin, async (request) => {
    const { id } = zParse(idParams, request.params);
    return education.submitForReview(app, id);
  });

  // File de relecture (médecin vérifié) : sans elle, le médecin n'avait AUCUN
  // moyen de savoir quels contenus attendent sa validation — `/manage` est
  // réservée à l'admin — et le pipeline restait bloqué en MEDICAL_REVIEW (D3).
  app.get('/review-queue', doctor, async (request) => {
    const q = zParse(paginationSchema, request.query);
    return education.listForReview(app, request.user.sub, { page: q.page, pageSize: q.pageSize });
  });

  app.post('/:id/medical-review', doctor, async (request) => {
    const { id } = zParse(idParams, request.params);
    const { approve } = zParse(reviewSchema, request.body);
    return education.medicalReview(app, request.user.sub, id, approve);
  });

  app.patch('/:id/translations', admin, async (request) => {
    const { id } = zParse(idParams, request.params);
    const { translations } = zParse(translationsSchema, request.body);
    return education.setTranslations(app, id, translations);
  });

  app.post('/:id/publish', admin, async (request) => {
    const { id } = zParse(idParams, request.params);
    return education.publish(app, id);
  });
}
