// ─────────────────────────────────────────────────────────────
// Routes KYC (préfixe /api/v1/kyc). RBAC : professionnels pour la soumission,
// ADMIN pour la revue. Audit §4 côté service : KYC_SUBMIT (soumission) +
// KYC_APPROVE / KYC_REJECT / KYC_REVISION (toutes les décisions de revue).
// ─────────────────────────────────────────────────────────────
import { KYC_DOCUMENT_TYPES, KYC_STATUSES, paginationSchema } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole, requireScope } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import { CAREGIVER_ROLES } from './kyc.service.js';
import * as kyc from './kyc.service.js';

// Upload RÉEL d'une pièce (P1) : contenu en base64, chiffré AES-256-GCM sur le
// disque du VPS (lib/filestore, §4). ≤ 5 Mo, formats image/PDF uniquement.
const KYC_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const documentSchema = z.object({
  type: z.enum(KYC_DOCUMENT_TYPES),
  mimeType: z.enum(KYC_MIME_TYPES),
  fileName: z.string().trim().max(120).optional(),
  // 5 Mo binaires ≈ 6,9 Mo en base64.
  dataBase64: z.string().min(1).max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 4),
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
  const admin = { preHandler: [app.authenticate, requireRole('ADMIN'), requireScope('kyc:review')] };

  // ── Professionnel : gestion de son dossier ──
  app.post('/', caregiver, async (request, reply) => {
    const submission = await kyc.getOrCreateSubmission(app, request.user.sub);
    return reply.code(201).send(submission);
  });

  // bodyLimit relevé : 5 Mo binaires + surcoût base64 + enveloppe JSON.
  app.post('/documents', { ...caregiver, bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const input = zParse(documentSchema, request.body);
    const doc = await kyc.addDocument(app, request.user.sub, { ...input, maxBytes: MAX_FILE_BYTES });
    return reply.code(201).send(doc);
  });

  // Lecture d'une pièce (déchiffrée à la volée) : PROPRIÉTAIRE du dossier ou
  // admin `kyc:review`. Jamais de cache ni d'URL publique (§4).
  app.get('/documents/:id/file', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = zParse(idParams, request.params);
    const { content, mimeType, fileName } = await kyc.readDocumentFile(app, request, id);
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Disposition', `inline; filename="${(fileName ?? 'document').replace(/[^\w.\- ]/g, '_')}"`);
    return reply.type(mimeType).send(content);
  });

  app.post('/submit', caregiver, async (request) => {
    return kyc.submitForReview(app, request.user.sub, request.ip);
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
