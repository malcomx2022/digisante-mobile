// ─────────────────────────────────────────────────────────────
// Service KYC : soumission de dossier professionnel + workflow de revue admin.
// Conformité : KYC_APPROVE / KYC_REJECT journalisés (audit chaîné). L'approbation
// pose le badge « vérifié » (Doctor.verifiedAt) qui débloque les consultations payantes.
// ─────────────────────────────────────────────────────────────
import type { KycDocumentType } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '@/lib/audit.js';
import { badRequest, forbidden, notFound } from '@/lib/errors.js';
import { paginate } from '@/lib/http.js';
import { verifyOrderNumber } from './kyc.cnom.js';

/** Rôles soignants soumis à vérification KYC. */
export const CAREGIVER_ROLES = ['MEDECIN', 'PHARMACIE', 'LABORATOIRE'] as const;

/** Statuts d'un dossier encore éditable par le professionnel. */
const OPEN_STATUSES: Prisma.KycSubmissionWhereInput['status'] = { in: ['NOT_SUBMITTED', 'NEEDS_REVISION'] };

/** Récupère le dossier ouvert du professionnel, ou le crée. */
export async function getOrCreateSubmission(app: FastifyInstance, userId: string) {
  const existing = await app.prisma.kycSubmission.findFirst({
    where: { userId, status: OPEN_STATUSES },
    include: { documents: true },
  });
  if (existing) return existing;
  return app.prisma.kycSubmission.create({
    data: { userId, status: 'NOT_SUBMITTED' },
    include: { documents: true },
  });
}

/** Ajoute une pièce justificative au dossier ouvert du professionnel. */
export async function addDocument(
  app: FastifyInstance,
  userId: string,
  input: { type: KycDocumentType; fileUrl: string },
) {
  const submission = await app.prisma.kycSubmission.findFirst({
    where: { userId, status: OPEN_STATUSES },
    select: { id: true },
  });
  if (!submission) throw badRequest('Aucun dossier KYC ouvert. Créez d’abord un dossier.');

  return app.prisma.kycDocument.create({
    data: { submissionId: submission.id, type: input.type, fileUrl: input.fileUrl },
  });
}

/** Finalise la soumission : passe le dossier en revue (UNDER_REVIEW). */
export async function submitForReview(app: FastifyInstance, userId: string, ip?: string | null) {
  const submission = await app.prisma.kycSubmission.findFirst({
    where: { userId, status: OPEN_STATUSES },
    include: { _count: { select: { documents: true } } },
  });
  if (!submission) throw badRequest('Aucun dossier KYC ouvert à soumettre.');
  if (submission._count.documents === 0) {
    throw badRequest('Ajoutez au moins une pièce justificative avant de soumettre.');
  }

  const updated = await app.prisma.kycSubmission.update({
    where: { id: submission.id },
    data: { status: 'UNDER_REVIEW', submittedAt: new Date() },
    include: { documents: true },
  });

  // §4 : journaliser la soumission (cycle de vie complet du dossier soignant).
  await writeAudit(app.prisma, {
    action: 'KYC_SUBMIT',
    actorId: userId,
    targetId: userId,
    ip,
    meta: { submissionId: submission.id, documents: submission._count.documents },
  });

  return updated;
}

/** Dossier KYC courant du professionnel (le plus récent). */
export async function getMySubmission(app: FastifyInstance, userId: string) {
  const submission = await app.prisma.kycSubmission.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { documents: true, reviews: { orderBy: { createdAt: 'desc' } } },
  });
  if (!submission) throw notFound('Aucun dossier KYC');
  return submission;
}

/** File d'attente de revue (ADMIN), paginée. */
export async function listQueue(
  app: FastifyInstance,
  params: { status?: string; page: number; pageSize: number },
) {
  const where: Prisma.KycSubmissionWhereInput = {
    status: (params.status as Prisma.KycSubmissionWhereInput['status']) ?? 'UNDER_REVIEW',
  };
  const [items, total] = await Promise.all([
    app.prisma.kycSubmission.findMany({
      where,
      orderBy: { submittedAt: 'asc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: {
        user: { select: { id: true, phone: true, role: true, profile: { select: { firstName: true, lastName: true } } } },
        _count: { select: { documents: true } },
      },
    }),
    app.prisma.kycSubmission.count({ where }),
  ]);
  return paginate(items, total, params.page, params.pageSize);
}

/** Détail d'un dossier pour la revue admin : pièces justificatives + aperçu CNOM
 *  (heuristique de format) pour les médecins. Identité/pièces uniquement — §4 :
 *  l'admin ne touche jamais au contenu médical du DMP. */
export async function getSubmissionForReview(app: FastifyInstance, submissionId: string) {
  const submission = await app.prisma.kycSubmission.findUnique({
    where: { id: submissionId },
    include: {
      user: { select: { id: true, phone: true, role: true, profile: { select: { firstName: true, lastName: true } }, doctor: { select: { licenseNumber: true } } } },
      documents: { select: { id: true, type: true, fileUrl: true, verified: true }, orderBy: { createdAt: 'asc' } },
      reviews: { select: { decision: true, notes: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!submission) throw notFound('Dossier KYC introuvable');

  const cnom = submission.user.doctor ? await verifyOrderNumber(submission.user.doctor.licenseNumber) : null;
  return { ...submission, cnom };
}

/** Coche/décoche une pièce justificative comme vérifiée (matérialise la checklist). */
export async function setDocumentVerified(app: FastifyInstance, documentId: string, verified: boolean) {
  const doc = await app.prisma.kycDocument.findUnique({ where: { id: documentId }, select: { id: true } });
  if (!doc) throw notFound('Pièce justificative introuvable');
  return app.prisma.kycDocument.update({
    where: { id: documentId },
    data: { verified, verifiedAt: verified ? new Date() : null },
    select: { id: true, verified: true, verifiedAt: true },
  });
}

interface ReviewInput {
  decision: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION';
  notes?: string;
  checklist?: Record<string, unknown>;
}

/** Décision de revue admin : approuve/rejette, pose le badge, journalise. */
export async function reviewSubmission(
  app: FastifyInstance,
  adminId: string,
  submissionId: string,
  input: ReviewInput,
  ip?: string | null,
) {
  const submission = await app.prisma.kycSubmission.findUnique({
    where: { id: submissionId },
    include: { user: { select: { id: true, role: true, doctor: { select: { id: true, licenseNumber: true } } } } },
  });
  if (!submission) throw notFound('Dossier KYC introuvable');
  if (submission.status !== 'UNDER_REVIEW') {
    throw forbidden('Seuls les dossiers en revue peuvent être traités');
  }

  // Contre-vérification CNOM (stub) pour les médecins.
  const cnom = submission.user.doctor
    ? await verifyOrderNumber(submission.user.doctor.licenseNumber)
    : null;

  const checklist = { ...(input.checklist ?? {}), cnom };

  await app.prisma.$transaction(async (tx) => {
    await tx.kycReview.create({
      data: {
        submissionId,
        reviewerId: adminId,
        decision: input.decision === 'NEEDS_REVISION' ? 'NEEDS_REVISION' : input.decision,
        notes: input.notes,
        checklist: checklist as Prisma.InputJsonValue,
      },
    });

    await tx.kycSubmission.update({
      where: { id: submissionId },
      data: {
        status: input.decision,
        reviewedAt: new Date(),
        rejectionReason: input.decision === 'REJECTED' ? (input.notes ?? 'Non précisé') : null,
      },
    });

    if (input.decision === 'APPROVED') {
      await tx.user.update({ where: { id: submission.user.id }, data: { status: 'ACTIVE' } });
      if (submission.user.doctor) {
        // Badge « vérifié » → débloque les consultations payantes.
        await tx.doctor.update({ where: { id: submission.user.doctor.id }, data: { verifiedAt: new Date() } });
      }
    }
  });

  // §4 : TOUTE décision de revue est journalisée — approbation, rejet ET renvoi
  // pour correction (NEEDS_REVISION) — traçabilité complète des actions admin.
  const AUDIT_ACTION = { APPROVED: 'KYC_APPROVE', REJECTED: 'KYC_REJECT', NEEDS_REVISION: 'KYC_REVISION' } as const;
  await writeAudit(app.prisma, {
    action: AUDIT_ACTION[input.decision],
    actorId: adminId,
    targetId: submission.user.id,
    ip,
    meta: { submissionId, decision: input.decision, cnom },
  });

  return { submissionId, status: input.decision, cnom };
}
