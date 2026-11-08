// ─────────────────────────────────────────────────────────────
// Conformité APDP (loi 2017-20) / RGPD : consentement versionné aux CGU et
// droit à l'effacement.
//
// Effacement = DEMANDE du titulaire, EXÉCUTION par un admin (scope users:write),
// décision du porteur du 7/11/2026 : rien n'est détruit sans action humaine.
// L'exécution anonymise l'identité, ferme le compte et efface les données de
// santé PROPRES au patient (DMP + fichiers, consentements, vaccination, maternité,
// observance, SOS, assurance, messagerie). Restent, pseudonymisés, en attendant
// la politique de conservation (D-8) : audit (5 ans, immuable), paiements/finances,
// rendez-vous, ordonnances, analyses et orientations tenus par les soignants.
// ─────────────────────────────────────────────────────────────
import { TERMS_VERSION } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { writeAudit, writeAuditWithin } from '@/lib/audit.js';
import { badRequest, forbidden, notFound } from '@/lib/errors.js';
import { deleteEncryptedFile } from '@/lib/filestore.js';

/** Enregistre l'acceptation de la version COURANTE des CGU par l'utilisateur. */
export async function acceptTerms(app: FastifyInstance, userId: string, version: string, ip?: string | null) {
  if (version !== TERMS_VERSION) throw badRequest('Version des conditions périmée : rechargez la page');
  const user = await app.prisma.user.update({
    where: { id: userId },
    data: { termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() },
    select: { termsVersion: true, termsAcceptedAt: true },
  });
  // Métadonnées seulement : la preuve du consentement est la version + la date.
  await writeAudit(app.prisma, { action: 'TERMS_ACCEPTED', actorId: userId, targetId: userId, ip, meta: { version: TERMS_VERSION } });
  return user;
}

const requestSelect = { id: true, status: true, requestedAt: true, processedAt: true, rejectReason: true } as const;

/** Dernière demande d'effacement de l'utilisateur courant (ou null). */
export async function myDeletionRequest(app: FastifyInstance, userId: string) {
  return app.prisma.accountDeletionRequest.findFirst({ where: { userId }, orderBy: { requestedAt: 'desc' }, select: requestSelect });
}

/**
 * Demande d'effacement par le titulaire. Idempotente : une demande déjà en
 * attente est renvoyée telle quelle (verrou du compte : pas de doublon concurrent).
 * Un compte admin ne s'efface pas par ce circuit (gestion des admins).
 */
export async function requestDeletion(app: FastifyInstance, userId: string, ip?: string | null) {
  return app.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, deletedAt: true } });
    if (!user || user.deletedAt) throw notFound('Compte introuvable');
    if (user.role === 'ADMIN') throw forbidden('Un compte administrateur se retire par la gestion des admins');
    const pending = await tx.accountDeletionRequest.findFirst({ where: { userId, status: 'PENDING' }, select: requestSelect });
    if (pending) return pending;
    const created = await tx.accountDeletionRequest.create({ data: { userId }, select: requestSelect });
    await writeAuditWithin(tx, { action: 'ACCOUNT_DELETION_REQUEST', actorId: userId, targetId: userId, ip, meta: { requestId: created.id, role: user.role } });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/** File admin : identité et statut uniquement (§4 : aucune donnée médicale). */
export async function listDeletionRequests(app: FastifyInstance, status?: 'PENDING' | 'COMPLETED' | 'REJECTED') {
  const rows = await app.prisma.accountDeletionRequest.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }],
    take: 100,
    select: {
      ...requestSelect,
      processedById: true,
      user: { select: { id: true, role: true, phone: true, deletedAt: true, profile: { select: { firstName: true, lastName: true } } } },
    },
  });
  return rows.map(({ user, ...r }) => ({
    ...r,
    user: { id: user.id, role: user.role, phone: user.deletedAt ? null : user.phone, name: user.profile && !user.deletedAt ? `${user.profile.firstName} ${user.profile.lastName}` : null },
  }));
}

/** Refus motivé d'une demande (ex. obligation légale de conservation). */
export async function rejectDeletion(app: FastifyInstance, adminId: string, requestId: string, reason: string, ip?: string | null) {
  return app.prisma.$transaction(async (tx) => {
    const changed = await tx.accountDeletionRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'REJECTED', processedAt: new Date(), processedById: adminId, rejectReason: reason },
    });
    if (changed.count !== 1) throw badRequest('Seule une demande en attente peut être refusée');
    const req = await tx.accountDeletionRequest.findUniqueOrThrow({ where: { id: requestId }, select: { ...requestSelect, userId: true } });
    // Le motif est un texte libre : jamais en méta d'audit (lisible par l'admin).
    await writeAuditWithin(tx, { action: 'ACCOUNT_DELETION_REJECT', actorId: adminId, targetId: req.userId, ip, meta: { requestId } });
    return req;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/**
 * Exécution de l'effacement (irréversible). Une seule transaction : verrou de la
 * demande puis du compte, effacement des données de santé du patient, anonymisation
 * de l'identité, fermeture du compte (SUSPENDED + deletedAt : toute requête et tout
 * refresh sont refusés), demande COMPLETED et audit. Les fichiers chiffrés des
 * pièces DMP sont supprimés APRÈS validation (B4 : jamais de fichier référencé manquant).
 */
export async function executeDeletion(app: FastifyInstance, adminId: string, requestId: string, ip?: string | null) {
  const { fileIds, result } = await app.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM account_deletion_requests WHERE id = ${requestId} FOR UPDATE`;
    const request = await tx.accountDeletionRequest.findUnique({ where: { id: requestId }, select: { status: true, userId: true } });
    if (!request) throw notFound('Demande introuvable');
    if (request.status !== 'PENDING') throw badRequest('Seule une demande en attente peut être exécutée');
    const userId = request.userId;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, deletedAt: true, patient: { select: { id: true } }, communityWorker: { select: { id: true } } },
    });
    if (user.role === 'ADMIN') throw forbidden('Un compte administrateur se retire par la gestion des admins');
    if (user.deletedAt) throw badRequest('Compte déjà effacé');

    const counts = { records: 0, files: 0 };
    let files: string[] = [];
    const patientId = user.patient?.id;
    if (patientId) {
      const docs = await tx.document.findMany({ where: { medicalRecord: { patientId } }, select: { encryptedUrl: true } });
      files = docs.map((d) => d.encryptedUrl);
      counts.files = files.length;
      // Données de santé propres au patient (cascades : pièces, liens de consentement,
      // doses, visites CPN, messages).
      counts.records = (await tx.medicalRecord.deleteMany({ where: { patientId } })).count;
      await tx.consent.deleteMany({ where: { patientId } });
      await tx.vaccinationSubject.deleteMany({ where: { patientId } });
      await tx.pregnancy.deleteMany({ where: { patientId } });
      await tx.medicationIntake.deleteMany({ where: { patientId } });
      await tx.medicationReminder.deleteMany({ where: { patientId } });
      await tx.sos.deleteMany({ where: { patientId } });
      await tx.patientInsurance.deleteMany({ where: { patientId } });
      await tx.chatThread.deleteMany({ where: { patientId } });
    }
    if (user.communityWorker) {
      // Roster et observations tenus par l'ASC sur des tiers : effacés avec son compte.
      await tx.ascBeneficiary.deleteMany({ where: { ascId: user.communityWorker.id } });
    }
    await tx.notification.deleteMany({ where: { recipientId: userId } });
    await tx.beneficiary.deleteMany({ where: { ownerId: userId } });
    await tx.mutationReceipt.deleteMany({ where: { userId } });
    // Accès DMP accordés à ce compte (s'il était soignant) : retirés.
    await tx.consent.deleteMany({ where: { granteeId: userId } });

    await tx.profile.updateMany({
      where: { userId },
      data: { firstName: 'Compte', lastName: 'supprimé', dateOfBirth: null, gender: null, address: null, emergencyContact: null, avatarUrl: null, spokenLangs: [] },
    });
    const now = new Date();
    await tx.user.update({
      where: { id: userId },
      // Identifiant non joignable et unique ; ne correspond à aucun numéro valide.
      data: { phone: `deleted:${userId}`, email: null, fcmToken: null, passwordHash: null, status: 'SUSPENDED', deletedAt: now },
    });
    await tx.accountDeletionRequest.update({ where: { id: requestId }, data: { status: 'COMPLETED', processedAt: now, processedById: adminId } });
    await writeAuditWithin(tx, {
      action: 'ACCOUNT_DELETION_EXECUTED',
      actorId: adminId,
      targetId: userId,
      ip,
      meta: { requestId, role: user.role, recordsDeleted: counts.records, filesDeleted: counts.files },
    });
    return { fileIds: files, result: { requestId, status: 'COMPLETED' as const, ...counts } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60_000 });

  // Fichiers chiffrés : effacés après la validation des lignes. Un échec disque est
  // journalisé (identifiant seulement) : le fichier orphelin est illisible sans sa ligne.
  let failed = 0;
  for (const id of fileIds) {
    try {
      await deleteEncryptedFile(id);
    } catch (err) {
      failed += 1;
      app.log.error({ err, requestId }, '[effacement] fichier chiffré non supprimé du magasin');
    }
  }
  return { ...result, filesNotDeleted: failed };
}
