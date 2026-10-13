// ─────────────────────────────────────────────────────────────
// Relation de soin (audit de release, sept. 2026). Avant, un compte MEDECIN
// auto-inscrit, NON vérifié, pouvait sur n'importe quel `patientId` : signer une
// ordonnance (QR « authentique » en pharmacie), commander une analyse, découvrir
// les ALLERGIES via le refus 400, lire le nom du patient (chat, orientation) et
// programmer des SMS/push vers lui. Deux gardes, partagées par tous ces actes :
//   ① médecin VÉRIFIÉ (KYC approuvé) ;
//   ② relation de soin avec CE patient : un rendez-vous non annulé, un
//      consentement DMP actif, ou une orientation reçue pour lui.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

import { forbidden } from './errors.js';

/** Profil médecin VÉRIFIÉ de l'appelant, sinon 403. */
export async function assertVerifiedDoctor(app: FastifyInstance, userId: string) {
  const doctor = await app.prisma.doctor.findUnique({
    where: { userId },
    select: { id: true, licenseNumber: true, verifiedAt: true },
  });
  if (!doctor) throw forbidden('Profil médecin requis');
  if (!doctor.verifiedAt) throw forbidden('Compte médecin non vérifié (KYC en attente)');
  return doctor;
}

/** Le médecin a-t-il une relation de soin avec ce patient ? (lecture seule) */
export async function hasCareRelationship(
  app: FastifyInstance,
  doctor: { id: string; userId: string },
  patientId: string,
): Promise<boolean> {
  const now = new Date(Date.now());
  const [appointments, consents, referrals] = await Promise.all([
    app.prisma.appointment.count({ where: { doctorId: doctor.id, patientId, status: { not: 'CANCELLED' } } }),
    // Consentement = au moins UNE entrée encore consentie (L1). `Consent.expiresAt`
    // n'est plus autoritatif : il survit au retrait d'un partage et le minimum
    // d'un lien expiré le ferait mentir dans les deux sens.
    app.prisma.consentRecord.count({
      where: {
        expiresAt: { gt: now },
        record: { patientId },
        consent: { granteeId: doctor.userId, patientId, revokedAt: null },
      },
    }),
    app.prisma.referral.count({ where: { toDoctorId: doctor.id, patientId, status: { in: ['PENDING', 'ACCEPTED'] } } }),
  ]);
  return appointments + consents + referrals > 0;
}

/**
 * Médecin vérifié ET en relation de soin avec le patient, sinon 403 — AVANT tout
 * traitement qui révélerait une donnée du patient (allergies, identité).
 */
export async function assertCareRelationship(app: FastifyInstance, doctorUserId: string, patientId: string) {
  const doctor = await assertVerifiedDoctor(app, doctorUserId);
  if (!(await hasCareRelationship(app, { id: doctor.id, userId: doctorUserId }, patientId))) {
    throw forbidden('Aucune relation de soin avec ce patient (rendez-vous, consentement ou orientation requis)');
  }
  return doctor;
}
