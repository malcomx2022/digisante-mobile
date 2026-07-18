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
  if (ctx.isOwner) return { allowed: true, reason: 'OWNER' };
  // Un patient ne lit pas le dossier d'un autre patient.
  if (ctx.role === 'PATIENT') return { allowed: false, reason: 'NOT_OWNER' };
  // Soignants / diaspora : accès uniquement sur partage consenti actif.
  if (ctx.hasValidShare) return { allowed: true, reason: 'CONSENT' };
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

  // Soignant : consentement actif → portée = ses entrées consenties.
  const now = new Date();
  const consent = await app.prisma.consent.findUnique({
    where: { patientId_granteeId: { patientId, granteeId: actorId } },
    select: { id: true, expiresAt: true, revokedAt: true, records: { select: { recordId: true } } },
  });
  const active = Boolean(consent && !consent.revokedAt && consent.expiresAt > now);
  const recordIds = new Set<string>(active ? consent!.records.map((r) => r.recordId) : []);

  // Réclamation d'un token présenté → scopée à l'entrée partagée (bloquée si révoqué).
  if (shareToken && !(consent && consent.revokedAt)) {
    const record = await app.prisma.medicalRecord.findUnique({
      where: { shareToken },
      select: { id: true, patientId: true, shareExpiry: true },
    });
    if (record && record.patientId === patientId && record.shareExpiry && record.shareExpiry > now) {
      const c = await app.prisma.consent.upsert({
        where: { patientId_granteeId: { patientId, granteeId: actorId } },
        create: { patientId, granteeId: actorId, expiresAt: record.shareExpiry, grantedVia: 'share-token' },
        update: { expiresAt: record.shareExpiry, grantedVia: 'share-token' },
        select: { id: true },
      });
      await app.prisma.consentRecord.upsert({
        where: { consentId_recordId: { consentId: c.id, recordId: record.id } },
        create: { consentId: c.id, recordId: record.id },
        update: {},
      });
      recordIds.add(record.id);
      await writeAudit(app.prisma, { action: 'DMP_CONSENT_GRANT', actorId, targetId: patientId, ip, meta: { via: 'share-token', recordId: record.id } });
    }
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
