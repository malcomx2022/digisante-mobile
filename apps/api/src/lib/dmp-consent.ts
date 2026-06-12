// ─────────────────────────────────────────────────────────────
// Consentement DMP (CLAUDE.md §4) — garde réutilisable d'accès au dossier.
// Règles :
//   - le PATIENT accède à SON propre dossier ;
//   - l'ADMIN ne lit JAMAIS le contenu médical (cloisonnement strict) ;
//   - un soignant n'accède au dossier d'un patient QUE via un partage consenti
//     actif (MedicalRecord.shareToken non expiré — partage avec date d'expiration) ;
//   - tout accès (accordé ou refusé) est journalisé (DMP_ACCESS / DMP_DENIED).
//
// Limite connue (schéma verrouillé à 26 modèles) : le partage n'est pas lié à un
// soignant précis (pas de grantee). Un consentement soignant-spécifique nécessitera
// un modèle Consent dédié (migration future). Le câblage DMP complet arrive en P3.3.
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

  // Partage consenti actif (non expiré) couvrant ce patient ?
  let hasValidShare = false;
  if (!isOwner && role !== 'ADMIN' && shareToken) {
    const record = await app.prisma.medicalRecord.findUnique({
      where: { shareToken },
      select: { patientId: true, shareExpiry: true },
    });
    hasValidShare =
      !!record && record.patientId === patientId && !!record.shareExpiry && record.shareExpiry > new Date();
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
