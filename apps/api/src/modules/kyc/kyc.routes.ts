// ─────────────────────────────────────────────────────────────
// Routes KYC (préfixe /api/v1/kyc). RBAC : professionnels pour la soumission,
// ADMIN pour la revue. Audit KYC_APPROVE / KYC_REJECT côté service.
// ─────────────────────────────────────────────────────────────
import { KYC_DOCUMENT_TYPES, KYC_STATUSES, paginationSchema } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import { CAREGIVER_ROLES } from './kyc.service.js';
import * as kyc from './kyc.service.js';

const documentSchema = z.object({
  type: z.enum(KYC_DOCUMENT_TYPES),
  fileUrl: z.string().url(),
});

const reviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'NEEDS_REVISION']),
  notes: z.string().max(2000).optional(),
  checklist: z.record(z.unknown()).optional(),
});

const queueSchema = paginationSchema.extend({
  status: z.enum(KYC_STATUSES).optional(),
});

const idParams = z.object({ id: z.string().cuid() });

export default async function kycRoutes(app: FastifyInstance) {
  const caregiver = { preHandler: [app.authenticate, requireRole(...CAREGIVER_ROLES)] };
  const admin = { preHandler: [app.authenticate, requireRole('ADMIN')] };

  // ── Professionnel : gestion de son dossier ──
  app.post('/', caregiver, async (request, reply) => {
    const submission = await kyc.getOrCreateSubmission(app, request.user.sub);
    return reply.code(201).send(submission);
  });

  app.post('/documents', caregiver, async (request, reply) => {
    const input = zParse(documentSchema, request.body);
    const doc = await kyc.addDocument(app, request.user.sub, input);
    return reply.code(201).send(doc);
  });

  app.post('/submit', caregiver, async (request) => {
    return kyc.submitForReview(app, request.user.sub);
  });

  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    return kyc.getMySubmission(app, request.user.sub);
  });

  // ── Admin : file d'attente et revue ──
  app.get('/submissions', admin, async (request) => {
    const q = zParse(queueSchema, request.query);
    return kyc.listQueue(app, { status: q.status, page: q.page, pageSize: q.pageSize });
  });

  // Détail d'un dossier (pièces justificatives + aperçu CNOM) pour la revue.
  app.get('/submissions/:id', admin, async (request) => {
    const { id } = zParse(idParams, request.params);
    return kyc.getSubmissionForReview(app, id);
  });

  // Coche/décoche une pièce comme vérifiée (checklist).
  app.post('/documents/:id/verify', admin, async (request) => {
    const { id } = zParse(idParams, request.params);
    const { verified } = zParse(z.object({ verified: z.boolean() }), request.body);
    return kyc.setDocumentVerified(app, id, verified);
  });

  app.post('/submissions/:id/review', admin, async (request) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(reviewSchema, request.body);
    return kyc.reviewSubmission(app, request.user.sub, id, input, request.ip);
  });
}
