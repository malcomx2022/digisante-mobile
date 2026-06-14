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

/**
 * Vérifie l'accès au DMP d'un patient, journalise (DMP_ACCESS/DMP_DENIED),
 * et lève 403 si refusé. Résout la propriété et la validité du partage en base.
 */
export async function assertDmpAccess(app: FastifyInstance, params: AssertDmpParams): Promise<void> {
  const { actorId, role, patientId, shareToken, ip } = params;

  // L'acteur est-il le patient propriétaire ?
  let isOwner = false;
  if (role === 'PATIENT') {
    const own = await app.prisma.patient.findUnique({
      where: { userId: actorId },
      select: { id: true },
    });
    isOwner = own?.id === patientId;
  }

  // Consentement par SOIGNANT (§4) : le bénéficiaire (grantee) est l'utilisateur
  // authentifié. Un consentement actif non expiré autorise l'accès. À défaut, la
  // présentation d'un token de partage valide RÉCLAME le consentement pour CE
  // soignant. La révocation est persistante : un soignant révoqué ne peut pas
  // re-réclamer via l'ancien token.
  let hasValidShare = false;
  if (!isOwner && role !== 'ADMIN') {
    const now = new Date();
    const consent = await app.prisma.consent.findUnique({
      where: { patientId_granteeId: { patientId, granteeId: actorId } },
      select: { expiresAt: true, revokedAt: true },
    });

    if (consent && !consent.revokedAt && consent.expiresAt > now) {
      hasValidShare = true;
    } else if (shareToken && !(consent && consent.revokedAt)) {
      const record = await app.prisma.medicalRecord.findUnique({
        where: { shareToken },
        select: { patientId: true, shareExpiry: true },
      });
      if (record && record.patientId === patientId && record.shareExpiry && record.shareExpiry > now) {
        await app.prisma.consent.upsert({
          where: { patientId_granteeId: { patientId, granteeId: actorId } },
          create: { patientId, granteeId: actorId, expiresAt: record.shareExpiry, grantedVia: 'share-token' },
          update: { expiresAt: record.shareExpiry, grantedVia: 'share-token' },
        });
        hasValidShare = true;
        await writeAudit(app.prisma, {
          action: 'DMP_CONSENT_GRANT',
          actorId,
          targetId: patientId,
          ip,
          meta: { via: 'share-token' },
        });
      }
    }
  }

  const decision = decideDmpAccess({ role, isOwner, hasValidShare });

  await writeAudit(app.prisma, {
    action: decision.allowed ? 'DMP_ACCESS' : 'DMP_DENIED',
    actorId,
    targetId: patientId,
    ip,
    meta: { reason: decision.reason, role },
  });

  if (!decision.allowed) {
    throw forbidden(DENY_MESSAGE[decision.reason]);
  }
}
