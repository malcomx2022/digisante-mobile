// ─────────────────────────────────────────────────────────────
// Agent de Santé Communautaire (ASC) — modèle A « relais aveugle » (PLAN_ASC.md).
// L'ASC gère SON roster (habitants suivis) + un journal d'observations OPÉRATIONNEL
// (constantes, triage). Ce N'EST PAS un DMP patient (§4). Cloisonnement strict par
// `ascId` : un ASC ne voit/modifie QUE ses bénéficiaires (403/404 sinon). Le
// signalement partage la fiche avec un médecin VÉRIFIÉ choisi (Notification).
// ─────────────────────────────────────────────────────────────
import type { Lang } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';

import { forbidden, notFound } from '@/lib/errors.js';

/** Résout l'id de l'ASC lié à l'utilisateur courant (rôle ASC). */
export async function ascIdOf(app: FastifyInstance, userId: string): Promise<string> {
  const a = await app.prisma.communityHealthWorker.findUnique({ where: { userId }, select: { id: true } });
  if (!a) throw forbidden('Profil agent de santé communautaire requis');
  return a.id;
}

const beneficiarySelect = { id: true, name: true, phone: true, village: true, birthDate: true, notes: true, createdAt: true } as const;

/** Vérifie que le bénéficiaire appartient à l'ASC (sinon 404). */
async function ownBeneficiary(app: FastifyInstance, ascId: string, id: string): Promise<void> {
  const b = await app.prisma.ascBeneficiary.findFirst({ where: { id, ascId }, select: { id: true } });
  if (!b) throw notFound('Bénéficiaire introuvable');
}

export async function listBeneficiaries(app: FastifyInstance, ascId: string) {
  return app.prisma.ascBeneficiary.findMany({ where: { ascId }, orderBy: { createdAt: 'desc' }, select: beneficiarySelect });
}

export async function addBeneficiary(
  app: FastifyInstance,
  ascId: string,
  input: { name: string; phone?: string; village?: string; birthDate?: Date; notes?: string },
) {
  return app.prisma.ascBeneficiary.create({
    data: { ascId, name: input.name, phone: input.phone ?? null, village: input.village ?? null, birthDate: input.birthDate ?? null, notes: input.notes ?? null },
    select: beneficiarySelect,
  });
}

export async function getBeneficiary(app: FastifyInstance, ascId: string, id: string) {
  const b = await app.prisma.ascBeneficiary.findFirst({
    where: { id, ascId },
    select: {
      ...beneficiarySelect,
      observations: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, systolic: true, diastolic: true, pulse: true, temperature: true, weight: true, triageOutcome: true, note: true, createdAt: true },
      },
    },
  });
  if (!b) throw notFound('Bénéficiaire introuvable');
  return b;
}

export async function removeBeneficiary(app: FastifyInstance, ascId: string, id: string) {
  const { count } = await app.prisma.ascBeneficiary.deleteMany({ where: { id, ascId } });
  if (count === 0) throw notFound('Bénéficiaire introuvable');
  return { removed: true };
}

export async function addObservation(
  app: FastifyInstance,
  ascId: string,
  beneficiaryId: string,
  input: { systolic?: number; diastolic?: number; pulse?: number; temperature?: number; weight?: number; triageOutcome?: string; note?: string },
) {
  await ownBeneficiary(app, ascId, beneficiaryId);
  return app.prisma.ascObservation.create({
    data: {
      beneficiaryId,
      systolic: input.systolic ?? null,
      diastolic: input.diastolic ?? null,
      pulse: input.pulse ?? null,
      temperature: input.temperature ?? null,
      weight: input.weight ?? null,
      triageOutcome: input.triageOutcome ?? null,
      note: input.note ?? null,
    },
    select: { id: true, systolic: true, diastolic: true, pulse: true, temperature: true, weight: true, triageOutcome: true, note: true, createdAt: true },
  });
}

function relayText(lang: Lang, ascName: string, beneficiaryName: string, village: string | null, message: string): { title: string; body: string } {
  const where = village ? ` (${village})` : '';
  return lang === 'EN'
    ? { title: 'Community health worker report', body: `${ascName} reports about ${beneficiaryName}${where}: ${message}` }
    : { title: 'Signalement d’un agent de santé communautaire', body: `${ascName} signale à propos de ${beneficiaryName}${where} : ${message}` };
}

/**
 * Signale un bénéficiaire à un médecin VÉRIFIÉ (relais). Crée une Notification
 * dans la langue du médecin. Ne partage QUE la fiche opérationnelle (nom, village,
 * message de l'ASC) — jamais un DMP. Cloisonnement : le bénéficiaire doit être
 * celui de l'ASC ; le destinataire doit être un médecin vérifié.
 */
export async function relayToDoctor(
  app: FastifyInstance,
  ascId: string,
  beneficiaryId: string,
  input: { doctorId: string; message: string },
) {
  const beneficiary = await app.prisma.ascBeneficiary.findFirst({
    where: { id: beneficiaryId, ascId },
    select: { name: true, village: true, asc: { select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } } } },
  });
  if (!beneficiary) throw notFound('Bénéficiaire introuvable');

  const doctor = await app.prisma.doctor.findFirst({
    where: { id: input.doctorId, verifiedAt: { not: null } },
    select: { user: { select: { id: true, lang: true } } },
  });
  if (!doctor) throw notFound('Médecin vérifié introuvable');

  const p = beneficiary.asc.user.profile;
  const ascName = p ? `${p.firstName} ${p.lastName}` : 'ASC';
  const { title, body } = relayText(doctor.user.lang, ascName, beneficiary.name, beneficiary.village, input.message);
  await app.prisma.notification.create({
    data: { recipientId: doctor.user.id, type: 'SYSTEM', channel: 'IN_APP', title, body, status: 'PENDING' },
  });
  return { relayed: true };
}
