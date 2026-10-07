// L2 : dossier administratif laboratoire, sans relation vers des données cliniques.
import type { KycDocumentType } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { writeAuditWithin } from '@/lib/audit.js';
import { badRequest, forbidden, notFound } from '@/lib/errors.js';
import { storeEncryptedFile } from '@/lib/filestore.js';
import { lockLaboratoryAccount } from '@/lib/laboratory-access.js';
import { decodeUpload } from '@/lib/upload.js';

export const LAB_REQUIRED_DOCUMENTS = ['NATIONAL_ID', 'PRACTICE_LICENSE'] as const;
export interface LabIdentity { name: string; address: string; phone: string; licenseNumber: string }
const editable = (status: string) => ['NOT_SUBMITTED', 'NEEDS_REVISION'].includes(status);

export async function isLaboratory(app: FastifyInstance, userId: string) {
  return (await app.prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role === 'LABORATOIRE';
}

async function current(tx: Prisma.TransactionClient, userId: string) {
  return tx.kycSubmission.findFirst({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { documents: true } });
}

export async function profile(app: FastifyInstance, userId: string) {
  return app.prisma.$transaction(async (tx) => {
    const user = await lockLaboratoryAccount(tx, userId);
    const submission = await current(tx, userId);
    return { ...user.lab!, accountStatus: user.status, kycStatus: submission?.status ?? 'NOT_SUBMITTED',
      canProcess: user.status === 'ACTIVE' && Boolean(user.lab!.verifiedAt) };
  });
}

export async function saveIdentity(app: FastifyInstance, userId: string, identity: LabIdentity) {
  return app.prisma.$transaction(async (tx) => {
    const user = await lockLaboratoryAccount(tx, userId);
    const submission = await current(tx, userId);
    if (user.status === 'SUSPENDED' || user.lab!.verifiedAt || (submission && !editable(submission.status))) {
      throw forbidden('Identité modifiable seulement dans un dossier ouvert');
    }
    return tx.lab.update({ where: { userId }, data: identity });
  });
}

export async function open(app: FastifyInstance, userId: string) {
  return app.prisma.$transaction(async (tx) => {
    const user = await lockLaboratoryAccount(tx, userId);
    if (user.status === 'SUSPENDED') throw forbidden('Compte suspendu');
    const submission = await current(tx, userId);
    // Pas de deuxième dossier concurrent, ni d'auto-réouverture après approbation.
    if (submission && submission.status !== 'REJECTED' && !(submission.status === 'APPROVED' && !user.lab!.verifiedAt)) return submission;
    return tx.kycSubmission.create({ data: { userId }, include: { documents: true } });
  });
}

export async function addDocument(app: FastifyInstance, userId: string,
  input: { type: KycDocumentType; mimeType: string; fileName?: string; dataBase64: string; maxBytes: number }) {
  const content = decodeUpload(input.dataBase64, input.mimeType, input.maxBytes);
  return app.prisma.$transaction(async (tx) => {
    const user = await lockLaboratoryAccount(tx, userId);
    const submission = await current(tx, userId);
    if (user.status === 'SUSPENDED' || !submission || !editable(submission.status)) throw badRequest('Aucun dossier KYC ouvert');
    const storageId = await storeEncryptedFile(content);
    return tx.kycDocument.create({ data: { submissionId: submission.id, type: input.type, fileUrl: storageId,
      mimeType: input.mimeType, fileName: input.fileName },
      select: { id: true, type: true, mimeType: true, fileName: true, verified: true, createdAt: true } });
  });
}

export async function submit(app: FastifyInstance, userId: string, ip?: string | null) {
  return app.prisma.$transaction(async (tx) => {
    const user = await lockLaboratoryAccount(tx, userId);
    const submission = await current(tx, userId);
    if (user.status === 'SUSPENDED' || !submission || !editable(submission.status)) throw badRequest('Aucun dossier KYC ouvert');
    const lab = user.lab!;
    if (![lab.name, lab.address, lab.phone, lab.licenseNumber].every((v) => v?.trim())) throw badRequest('Identité de la structure et autorisation requises');
    if (!LAB_REQUIRED_DOCUMENTS.every((type) => submission.documents.some((d) => d.type === type))) {
      throw badRequest('Identité du responsable et autorisation d’exercice requises');
    }
    // Toute nouvelle soumission impose une nouvelle vérification, même après renvoi.
    await tx.kycDocument.updateMany({ where: { submissionId: submission.id }, data: { verified: false, verifiedAt: null } });
    const updated = await tx.kycSubmission.update({ where: { id: submission.id }, data: { status: 'UNDER_REVIEW', submittedAt: new Date(),
      labIdentity: { name: lab.name, address: lab.address, phone: lab.phone, licenseNumber: lab.licenseNumber } }, include: { documents: true } });
    await writeAuditWithin(tx, { action: 'KYC_SUBMIT', actorId: userId, targetId: userId, ip,
      meta: { submissionId: updated.id, documents: updated.documents.length } });
    return updated;
  });
}

export async function verifyDocument(app: FastifyInstance, userId: string, documentId: string, verified: boolean) {
  return app.prisma.$transaction(async (tx) => {
    await lockLaboratoryAccount(tx, userId);
    const doc = await tx.kycDocument.findUnique({ where: { id: documentId }, include: { submission: true } });
    if (!doc) throw notFound('Pièce introuvable');
    if (doc.submission.userId !== userId || doc.submission.status !== 'UNDER_REVIEW') throw forbidden('Dossier hors revue');
    return tx.kycDocument.update({ where: { id: documentId }, data: { verified, verifiedAt: verified ? new Date() : null } });
  });
}

export async function review(app: FastifyInstance, adminId: string, userId: string, submissionId: string,
  input: { decision: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION'; notes?: string; checklist?: Record<string, unknown> }, ip?: string | null) {
  await app.prisma.$transaction(async (tx) => {
    const user = await lockLaboratoryAccount(tx, userId);
    const submission = await current(tx, userId);
    if (!submission || submission.id !== submissionId || submission.status !== 'UNDER_REVIEW') throw forbidden('Dossier hors revue');
    // Une approbation KYC n'est jamais une levée implicite de suspension.
    if (user.status === 'SUSPENDED') throw forbidden('Réactivation administrative préalable requise');
    if (input.decision === 'APPROVED') {
      if (!submission.labIdentity || !LAB_REQUIRED_DOCUMENTS.every((type) => submission.documents.some((d) => d.type === type && d.verified)) || !submission.documents.every((d) => d.verified)) {
        throw badRequest('Identité complète et toutes les pièces vérifiées requises');
      }
    }
    await tx.kycReview.create({ data: { submissionId, reviewerId: adminId, decision: input.decision, notes: input.notes,
      checklist: { requiredDocuments: [...LAB_REQUIRED_DOCUMENTS], allVerified: submission.documents.every((d) => d.verified) } } });
    await tx.kycSubmission.update({ where: { id: submissionId }, data: { status: input.decision, reviewedAt: new Date(),
      rejectionReason: input.decision === 'REJECTED' ? input.notes ?? 'Non précisé' : null } });
    await tx.lab.update({ where: { userId }, data: { verifiedAt: input.decision === 'APPROVED' ? new Date() : null } });
    await tx.user.update({ where: { id: userId }, data: { status: input.decision === 'APPROVED' ? 'ACTIVE' : 'PENDING_KYC' } });
    const action = { APPROVED: 'KYC_APPROVE', REJECTED: 'KYC_REJECT', NEEDS_REVISION: 'KYC_REVISION' } as const;
    await writeAuditWithin(tx, { action: action[input.decision], actorId: adminId, targetId: userId, ip,
      meta: { submissionId, decision: input.decision, role: 'LABORATOIRE' } });
  });
  return { submissionId, status: input.decision, cnom: null };
}
