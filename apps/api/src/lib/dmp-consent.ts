// ─────────────────────────────────────────────────────────────
// Consentement DMP (CLAUDE.md §4) — garde réutilisable d'accès au dossier.
// Règles :
//   - le PATIENT accède à SON propre dossier ;
//   - l'ADMIN ne lit JAMAIS le contenu médical (cloisonnement strict) ;
//   - un soignant n'accède au dossier d'un patient QUE via un consentement par
//     SOIGNANT (modèle Consent : couple patient↔grantee, avec expiration) ;
//   - le consentement est RÉCLAMÉ à la présentation d'un token de partage valide,
//     liant l'accès au soignant authentifié ; ensuite l'accès tient sans token ;
//   - la révocation est PERSISTANTE : un soignant révoqué ne peut pas re-réclamer
//     via l'ancien token (le patient gère ses consentements : liste + révocation) ;
//   - tout accès (accordé ou refusé) est journalisé (DMP_ACCESS / DMP_DENIED),
//     ainsi que l'octroi/la révocation (DMP_CONSENT_GRANT / DMP_CONSENT_REVOKE).
// ─────────────────────────────────────────────────────────────
import type { Role } from '@digisante/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from './audit.js';
import { forbidden } from './errors.js';

export interface DmpAccessCtx {
  role: Role;
  /** L'acteur est le patient propriétaire du dossier. */
  isOwner: boolean;
  /** Un partage consenti actif (non expiré) autorise l'accès. */
  hasValidShare: boolean;
}

export interface DmpDecision {
  allowed: boolean;
  reason: 'OWNER' | 'CONSENT' | 'ADMIN_FORBIDDEN' | 'NOT_OWNER' | 'NO_CONSENT';
}

/** Décision d'accès au DMP (fonction PURE, testable). */
export function decideDmpAccess(ctx: DmpAccessCtx): DmpDecision {
  // Cloisonnement admin : aucun accès au contenu médical, même avec partage.
  if (ctx.role === 'ADMIN') return { allowed: false, reason: 'ADMIN_FORBIDDEN' };
  if (ctx.role === 'PATIENT' && ctx.isOwner) return { allowed: true, reason: 'OWNER' };
  // Un patient ne lit pas le dossier d'un autre patient.
  if (ctx.role === 'PATIENT') return { allowed: false, reason: 'NOT_OWNER' };
  // Seul le médecin vérifié peut bénéficier d'un partage ; jamais les autres rôles.
  if (ctx.role === 'MEDECIN' && ctx.hasValidShare) return { allowed: true, reason: 'CONSENT' };
  return { allowed: false, reason: 'NO_CONSENT' };
}

const DENY_MESSAGE: Record<DmpDecision['reason'], string> = {
  OWNER: '',
  CONSENT: '',
  ADMIN_FORBIDDEN: "L'administration ne peut pas accéder au contenu médical (cloisonnement)",
  NOT_OWNER: 'Accès limité à votre propre dossier',
  NO_CONSENT: 'Aucun partage consenti actif pour ce dossier',
};

interface AssertDmpParams {
  actorId: string;
  role: Role;
  patientId: string;
  /** Jeton de partage présenté par le soignant (le cas échéant). */
  shareToken?: string;
  ip?: string | null;
}

/** Portée d'accès résolue : tout le dossier (propriétaire) ou un sous-ensemble d'entrées. */
export type DmpScope = { recordIds: 'ALL' } | { recordIds: Set<string> };

/** Sérialise réclamation/révocation/ré-octroi par patient, même entre workers. */
export async function withDmpConsentLock<T>(
  app: FastifyInstance,
  patientId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return app.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'dmp-consent:' + patientId}, 0))`;
    return work(tx);
  });
}

/**
 * Champ parent historique : borne conservatrice, sans garantie de rollback ancien.
 * Il n'autorise PLUS la lecture en L1. Une portée inconnue/absente ferme l'ancien guard.
 */
export async function syncLegacyConsentExpiry(tx: Prisma.TransactionClient, consentId: string): Promise<void> {
  const records = await tx.consentRecord.findMany({ where: { consentId }, select: { expiresAt: true } });
  const expiresAt = records.length > 0 && records.every((r) => r.expiresAt !== null)
    ? new Date(Math.min(...records.map((r) => r.expiresAt!.getTime())))
    : new Date(0);
  await tx.consent.update({ where: { id: consentId }, data: { expiresAt } });
}

/**
 * Résout la PORTÉE d'accès au DMP d'un patient, journalise (DMP_ACCESS/DMP_DENIED)
 * et lève 403 si refusé. Minimisation §4 :
 *   - patient propriétaire → 'ALL' (tout son dossier) ;
 *   - soignant → l'ensemble des SEULES entrées effectivement partagées avec lui
 *     (pas tout le dossier). La présentation d'un token de partage valide RÉCLAME
 *     le consentement en le SCOPANT à l'entrée partagée (via `ConsentRecord`) ;
 *   - admin / autre patient → refus.
 * Révocation persistante : un soignant révoqué ne peut pas re-réclamer via l'ancien token.
 */
export async function resolveDmpScope(app: FastifyInstance, params: AssertDmpParams): Promise<DmpScope> {
  const { actorId, role, patientId, shareToken, ip } = params;

  let isOwner = false;
  if (role === 'PATIENT') {
    const own = await app.prisma.patient.findUnique({ where: { userId: actorId }, select: { id: true } });
    isOwner = own?.id === patientId;
  }
  if (isOwner) {
    await writeAudit(app.prisma, { action: 'DMP_ACCESS', actorId, targetId: patientId, ip, meta: { reason: 'OWNER', role } });
    return { recordIds: 'ALL' };
  }

  const deny = async (reason: DmpDecision['reason']): Promise<never> => {
    await writeAudit(app.prisma, { action: 'DMP_DENIED', actorId, targetId: patientId, ip, meta: { reason, role } });
    throw forbidden(DENY_MESSAGE[reason]);
  };
  if (role === 'ADMIN') return deny('ADMIN_FORBIDDEN');
  if (role === 'PATIENT') return deny('NOT_OWNER');
  // Le DMP n'est partagé qu'avec un SOIGNANT : médecin vérifié. Un ASC (CLAUDE.md :
  // « JAMAIS de lecture DMP »), un payeur diaspora, une pharmacie ou un laboratoire
  // qui présente un jeton photographié ne doivent obtenir ni consentement ni accès.
  if (role !== 'MEDECIN') return deny('NO_CONSENT');
  const result = await withDmpConsentLock(app, patientId, async (tx) => {
    const doctor = await tx.doctor.findUnique({
      where: { userId: actorId },
      select: { verifiedAt: true, user: { select: { role: true, status: true } } },
    });
    if (!doctor?.verifiedAt || doctor.user.role !== 'MEDECIN' || doctor.user.status !== 'ACTIVE') {
      return { recordIds: new Set<string>(), grant: null };
    }
    const now = new Date(Date.now());
    const consent = await tx.consent.findUnique({
      where: { patientId_granteeId: { patientId, granteeId: actorId } },
      select: {
        id: true, revokedAt: true,
        records: { where: { expiresAt: { gt: now }, record: { patientId } }, select: { recordId: true } },
      },
    });
    const recordIds = new Set<string>(consent && !consent.revokedAt ? consent.records.map((r) => r.recordId) : []);
    let grant: { recordId: string; expiresAt: string } | null = null;
    // Réclamation : seule l'échéance de CETTE entrée change. Révocation persistante.
    if (shareToken && !consent?.revokedAt) {
      const record = await tx.medicalRecord.findUnique({
        where: { shareToken }, select: { id: true, patientId: true, shareExpiry: true },
      });
      if (record && record.patientId === patientId && record.shareExpiry && record.shareExpiry > now) {
        const c = await tx.consent.upsert({
          where: { patientId_granteeId: { patientId, granteeId: actorId } },
          create: { patientId, granteeId: actorId, expiresAt: record.shareExpiry, grantedVia: 'share-token' },
          update: { grantedVia: 'share-token' }, select: { id: true },
        });
        await tx.consentRecord.upsert({
          where: { consentId_recordId: { consentId: c.id, recordId: record.id } },
          create: { consentId: c.id, recordId: record.id, expiresAt: record.shareExpiry },
          update: { expiresAt: record.shareExpiry },
        });
        await syncLegacyConsentExpiry(tx, c.id);
        recordIds.add(record.id);
        grant = { recordId: record.id, expiresAt: record.shareExpiry.toISOString() };
      }
    }
    return { recordIds, grant };
  });
  const { recordIds, grant } = result;
  if (grant) {
    await writeAudit(app.prisma, { action: 'DMP_CONSENT_GRANT', actorId, targetId: patientId, ip, meta: { via: 'share-token', ...grant } });
  }

  if (recordIds.size === 0) return deny('NO_CONSENT');

  await writeAudit(app.prisma, { action: 'DMP_ACCESS', actorId, targetId: patientId, ip, meta: { reason: 'CONSENT', role, records: recordIds.size } });
  return { recordIds };
}

/**
 * Assure un accès au DMP (portée ignorée) — pour les opérations niveau patient
 * (ex. création d'une entrée par un soignant consenti). Journalise + lève 403.
 */
export async function assertDmpAccess(app: FastifyInstance, params: AssertDmpParams): Promise<void> {
  await resolveDmpScope(app, params);
}
