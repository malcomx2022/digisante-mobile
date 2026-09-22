// ─────────────────────────────────────────────────────────────
// Service DMP : entrées du dossier (chiffrées au repos), partages consentis
// (token + expiration), export FHIR (portabilité). Tout accès passe par le
// guard de consentement (P2.3) et est journalisé (DMP_ACCESS / DMP_DENIED /
// DATA_EXPORT). L'admin ne peut JAMAIS lire le contenu médical (cloisonnement).
// ─────────────────────────────────────────────────────────────
import { randomBytes } from 'node:crypto';

import type { MedicalRecordType, Role, ShareType } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '@/lib/audit.js';
import { openMedicalData, sealMedicalData } from '@/lib/crypto.js';
import { assertDmpAccess, resolveDmpScope } from '@/lib/dmp-consent.js';
import { badRequest, forbidden, notFound } from '@/lib/errors.js';
import { readEncryptedFile, storeEncryptedFile } from '@/lib/filestore.js';
import { checksumOf, decodeUpload } from '@/lib/upload.js';

interface Actor {
  sub: string;
  role: Role;
}

/** Résout le patient cible : le patient agit sur SON dossier ; le soignant fournit patientId. */
async function resolveTargetPatient(app: FastifyInstance, actor: Actor, patientId?: string): Promise<string> {
  if (actor.role === 'PATIENT') {
    const own = await app.prisma.patient.findUnique({ where: { userId: actor.sub }, select: { id: true } });
    if (!own) throw forbidden('Profil patient requis');
    return own.id;
  }
  if (!patientId) throw badRequest('patientId requis');
  return patientId;
}

interface CreateRecordInput {
  patientId?: string;
  type: MedicalRecordType;
  title: string;
  data?: unknown;
  shareToken?: string;
}

/** Crée une entrée de DMP (contenu chiffré au repos). */
export async function createRecord(app: FastifyInstance, actor: Actor, input: CreateRecordInput, ip?: string | null) {
  const patientId = await resolveTargetPatient(app, actor, input.patientId);
  await assertDmpAccess(app, { actorId: actor.sub, role: actor.role, patientId, shareToken: input.shareToken, ip });

  const sealed = sealMedicalData(input.data ?? null);
  return app.prisma.medicalRecord.create({
    data: {
      patientId,
      type: input.type,
      title: input.title,
      data: sealed.data === undefined ? undefined : (sealed.data as object),
      encryptedData: sealed.encryptedData,
    },
    select: { id: true, type: true, title: true, createdAt: true },
  });
}

/** Liste les entrées d'un patient (accès consenti), contenu déchiffré. */
export async function listRecords(
  app: FastifyInstance,
  actor: Actor,
  params: { patientId?: string; shareToken?: string },
  ip?: string | null,
) {
  const patientId = await resolveTargetPatient(app, actor, params.patientId);
  // Portée par-entrée (§4) : un soignant ne reçoit QUE ses entrées consenties.
  const scope = await resolveDmpScope(app, { actorId: actor.sub, role: actor.role, patientId, shareToken: params.shareToken, ip });

  const records = await app.prisma.medicalRecord.findMany({
    where: scope.recordIds === 'ALL' ? { patientId } : { patientId, id: { in: [...scope.recordIds] } },
    orderBy: { createdAt: 'desc' },
    // Le décompte évite un appel par entrée juste pour savoir s'il y a des pièces.
    include: { _count: { select: { documents: true } } },
  });
  return records.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    data: openMedicalData(r),
    documentCount: r._count.documents,
    createdAt: r.createdAt,
  }));
}

/** Récupère une entrée précise (accès consenti). */
export async function getRecord(app: FastifyInstance, actor: Actor, recordId: string, shareToken: string | undefined, ip?: string | null) {
  const record = await app.prisma.medicalRecord.findUnique({
    where: { id: recordId },
    include: { documents: { select: { id: true, filename: true, mimeType: true, size: true } } },
  });
  if (!record) throw notFound('Entrée de dossier introuvable');
  // Portée par-entrée (§4) : l'accès à CETTE entrée précise doit être consenti.
  const scope = await resolveDmpScope(app, { actorId: actor.sub, role: actor.role, patientId: record.patientId, shareToken, ip });
  if (scope.recordIds !== 'ALL' && !scope.recordIds.has(record.id)) {
    await writeAudit(app.prisma, { action: 'DMP_DENIED', actorId: actor.sub, targetId: record.patientId, ip, meta: { reason: 'RECORD_NOT_SHARED', recordId: record.id, role: actor.role } });
    throw forbidden('Cette entrée n’est pas partagée avec vous');
  }
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    data: openMedicalData(record),
    documents: record.documents,
    createdAt: record.createdAt,
  };
}

// ── Pièces jointes d'une entrée de DMP (§4) ──────────────────────────────────
// Le fichier est chiffré AES-256-GCM sur le disque du VPS (même filestore que
// les pièces KYC) ; `encryptedUrl` ne stocke qu'un identifiant de stockage
// opaque — jamais une URL publique. `checksum` porte le SHA-256 du contenu EN
// CLAIR : il permet de détecter une altération après déchiffrement.
//
// Contrôle d'accès : STRICTEMENT le même que pour l'entrée qui les porte
// (`resolveDmpScope` + appartenance à la portée). Un soignant qui n'a pas
// l'entrée dans sa portée ne peut ni joindre ni télécharger ses pièces —
// sinon la minimisation par-entrée serait contournable par les fichiers.

/** Résout l'entrée et vérifie qu'elle est DANS la portée de l'acteur, ou lève 403. */
async function assertRecordInScope(app: FastifyInstance, actor: Actor, recordId: string, shareToken: string | undefined, ip?: string | null) {
  const record = await app.prisma.medicalRecord.findUnique({ where: { id: recordId }, select: { id: true, patientId: true } });
  if (!record) throw notFound('Entrée de dossier introuvable');

  const scope = await resolveDmpScope(app, { actorId: actor.sub, role: actor.role, patientId: record.patientId, shareToken, ip });
  if (scope.recordIds !== 'ALL' && !scope.recordIds.has(record.id)) {
    await writeAudit(app.prisma, {
      action: 'DMP_DENIED',
      actorId: actor.sub,
      targetId: record.patientId,
      ip,
      meta: { reason: 'RECORD_NOT_SHARED', recordId: record.id, role: actor.role },
    });
    throw forbidden('Cette entrée n’est pas partagée avec vous');
  }
  return record;
}

interface AddDocumentInput {
  mimeType: string;
  filename: string;
  dataBase64: string;
  maxBytes: number;
  shareToken?: string;
}

/** Joint un fichier (chiffré au repos) à une entrée du dossier. */
export async function addDocument(app: FastifyInstance, actor: Actor, recordId: string, input: AddDocumentInput, ip?: string | null) {
  const record = await assertRecordInScope(app, actor, recordId, input.shareToken, ip);

  const content = decodeUpload(input.dataBase64, input.mimeType, input.maxBytes);
  const storageId = await storeEncryptedFile(content);

  const doc = await app.prisma.document.create({
    data: {
      medicalRecordId: record.id,
      filename: input.filename,
      mimeType: input.mimeType,
      size: content.length,
      encryptedUrl: storageId,
      checksum: checksumOf(content),
    },
    select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
  });

  await writeAudit(app.prisma, {
    action: 'DMP_DOCUMENT_ADD',
    actorId: actor.sub,
    targetId: record.patientId,
    ip,
    // Métadonnées seulement : ni le contenu, ni le titre de l'entrée (§4).
    meta: { recordId: record.id, documentId: doc.id, mimeType: doc.mimeType, size: doc.size },
  });
  return doc;
}

/** Lit une pièce jointe (déchiffrée) — portée identique à celle de son entrée. */
export async function readDocumentFile(app: FastifyInstance, actor: Actor, documentId: string, shareToken: string | undefined, ip?: string | null) {
  const doc = await app.prisma.document.findUnique({
    where: { id: documentId },
    select: { filename: true, mimeType: true, encryptedUrl: true, checksum: true, medicalRecordId: true },
  });
  if (!doc) throw notFound('Pièce jointe introuvable');

  await assertRecordInScope(app, actor, doc.medicalRecordId, shareToken, ip);

  const content = await readEncryptedFile(doc.encryptedUrl).catch(() => {
    throw notFound('Fichier indisponible');
  });
  // Le tag GCM couvre déjà l'altération du fichier chiffré ; le checksum protège
  // en plus contre une substitution d'enregistrement en base (mauvais storageId).
  if (checksumOf(content) !== doc.checksum) throw notFound('Fichier indisponible');

  return { content, mimeType: doc.mimeType, filename: doc.filename };
}

/** Supprime une pièce jointe. Réservé au PATIENT PROPRIÉTAIRE de l'entrée. */
export async function removeDocument(app: FastifyInstance, patientUserId: string, documentId: string, ip?: string | null) {
  const doc = await app.prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, medicalRecord: { select: { id: true, patient: { select: { userId: true } } } } },
  });
  if (!doc) throw notFound('Pièce jointe introuvable');
  if (doc.medicalRecord.patient.userId !== patientUserId) throw forbidden('Seul le patient propriétaire peut supprimer');

  await app.prisma.document.delete({ where: { id: doc.id } });
  await writeAudit(app.prisma, {
    action: 'DMP_DOCUMENT_REMOVE',
    actorId: patientUserId,
    targetId: doc.medicalRecord.id,
    ip,
    meta: { documentId: doc.id },
  });
  // Le fichier chiffré reste sur disque (aucun secret n'en sort : sans la ligne
  // en base, plus personne ne peut le retrouver). La purge disque relève du cron
  // de maintenance du VPS.
  return { removed: true };
}

/** Partage consenti d'une entrée par le patient propriétaire (token + expiration). */
export async function shareRecord(
  app: FastifyInstance,
  patientUserId: string,
  recordId: string,
  input: { shareType: ShareType; ttlHours: number },
  ip?: string | null,
) {
  const record = await app.prisma.medicalRecord.findUnique({ where: { id: recordId }, select: { id: true, patient: { select: { userId: true } } } });
  if (!record) throw notFound('Entrée de dossier introuvable');
  if (record.patient.userId !== patientUserId) throw forbidden('Seul le patient propriétaire peut partager');

  const shareToken = randomBytes(24).toString('hex');
  const shareExpiry = new Date(Date.now() + input.ttlHours * 3600_000);
  await app.prisma.medicalRecord.update({
    where: { id: recordId },
    data: { shareToken, shareType: input.shareType, shareExpiry },
  });
  await writeAudit(app.prisma, { action: 'DMP_SHARE', actorId: patientUserId, targetId: recordId, ip, meta: { shareType: input.shareType, ttlHours: input.ttlHours } });
  return { shareToken, shareType: input.shareType, expiresAt: shareExpiry };
}

/** Résout le Patient.id du propriétaire courant (ou lève). */
async function ownPatientId(app: FastifyInstance, patientUserId: string): Promise<string> {
  const own = await app.prisma.patient.findUnique({ where: { userId: patientUserId }, select: { id: true } });
  if (!own) throw forbidden('Profil patient requis');
  return own.id;
}

/** Liste les soignants disposant (ou ayant disposé) d'un consentement sur le dossier du patient. */
export async function listConsents(app: FastifyInstance, patientUserId: string) {
  const patientId = await ownPatientId(app, patientUserId);
  const now = new Date();
  const consents = await app.prisma.consent.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    select: {
      granteeId: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      grantee: {
        select: {
          role: true,
          profile: { select: { firstName: true, lastName: true } },
          doctor: { select: { speciality: true } },
        },
      },
      _count: { select: { records: true } },
    },
  });
  return consents.map((c) => ({
    granteeId: c.granteeId,
    name: c.grantee.profile ? `${c.grantee.profile.firstName} ${c.grantee.profile.lastName}`.trim() : '—',
    role: c.grantee.role,
    speciality: c.grantee.doctor?.speciality ?? null,
    expiresAt: c.expiresAt,
    grantedAt: c.createdAt,
    active: !c.revokedAt && c.expiresAt > now,
    revokedAt: c.revokedAt,
    // Nombre d'entrées effectivement partagées avec ce soignant (portée §4).
    recordCount: c._count.records,
  }));
}

/** Révoque le consentement d'un soignant précis (révocation persistante). */
export async function revokeConsent(
  app: FastifyInstance,
  patientUserId: string,
  granteeId: string,
  ip?: string | null,
) {
  const patientId = await ownPatientId(app, patientUserId);
  const consent = await app.prisma.consent.findUnique({
    where: { patientId_granteeId: { patientId, granteeId } },
    select: { id: true, revokedAt: true },
  });
  if (!consent) throw notFound('Consentement introuvable');
  if (!consent.revokedAt) {
    await app.prisma.consent.update({ where: { id: consent.id }, data: { revokedAt: new Date() } });
    await writeAudit(app.prisma, { action: 'DMP_CONSENT_REVOKE', actorId: patientUserId, targetId: granteeId, ip });
  }
  return { revoked: true };
}

/**
 * Ré-autorise un soignant précédemment révoqué (action DÉLIBÉRÉE du patient) :
 * lève la révocation persistante et fixe une nouvelle expiration. Distinct de la
 * réclamation par token (laquelle reste bloquée après révocation, par sécurité).
 */
export async function regrantConsent(
  app: FastifyInstance,
  patientUserId: string,
  granteeId: string,
  ttlHours: number,
  ip?: string | null,
) {
  const patientId = await ownPatientId(app, patientUserId);
  const consent = await app.prisma.consent.findUnique({
    where: { patientId_granteeId: { patientId, granteeId } },
    select: { id: true },
  });
  if (!consent) throw notFound('Consentement introuvable');

  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  await app.prisma.consent.update({
    where: { id: consent.id },
    data: { revokedAt: null, expiresAt, grantedVia: 'regrant' },
  });
  await writeAudit(app.prisma, {
    action: 'DMP_CONSENT_GRANT',
    actorId: patientUserId,
    targetId: granteeId,
    ip,
    meta: { via: 'regrant', ttlHours },
  });
  return { granteeId, expiresAt };
}

/** Révoque un partage (patient propriétaire). */
export async function revokeShare(app: FastifyInstance, patientUserId: string, recordId: string) {
  const record = await app.prisma.medicalRecord.findUnique({ where: { id: recordId }, select: { patient: { select: { userId: true } } } });
  if (!record) throw notFound('Entrée de dossier introuvable');
  if (record.patient.userId !== patientUserId) throw forbidden('Seul le patient propriétaire peut révoquer');
  // Révoquer le partage retire AUSSI l'entrée des portées déjà réclamées : sinon un
  // soignant qui avait scanné le QR gardait l'accès jusqu'à l'échéance de son
  // consentement, et le patient pensait l'avoir coupé.
  await app.prisma.$transaction([
    app.prisma.medicalRecord.update({ where: { id: recordId }, data: { shareToken: null, shareType: null, shareExpiry: null } }),
    app.prisma.consentRecord.deleteMany({ where: { recordId } }),
  ]);
  return { revoked: true };
}

/** Export FHIR (Bundle JSON) du dossier — portabilité patient. Journalise DATA_EXPORT. */
export async function exportFhir(app: FastifyInstance, actor: Actor, patientIdParam: string | undefined, ip?: string | null) {
  const patientId = await resolveTargetPatient(app, actor, patientIdParam);
  // Portée par-entrée (§4) : un soignant n'exporte QUE ses entrées consenties ;
  // le patient propriétaire exporte tout son dossier (portabilité).
  const scope = await resolveDmpScope(app, { actorId: actor.sub, role: actor.role, patientId, ip });

  const records = await app.prisma.medicalRecord.findMany({
    where: scope.recordIds === 'ALL' ? { patientId } : { patientId, id: { in: [...scope.recordIds] } },
    orderBy: { createdAt: 'asc' },
  });
  await writeAudit(app.prisma, { action: 'DATA_EXPORT', actorId: actor.sub, targetId: patientId, ip, meta: { count: records.length, format: 'FHIR' } });

  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date().toISOString(),
    entry: records.map((r) => ({
      resource: {
        resourceType: 'Observation',
        id: r.id,
        status: 'final',
        category: r.type,
        code: { text: r.title },
        effectiveDateTime: r.createdAt.toISOString(),
        valueAttachment: openMedicalData(r),
      },
    })),
  };
}
