// ─────────────────────────────────────────────────────────────
// Routes Référencement entre médecins (préfixe /api/v1/referrals).
// Un médecin oriente un patient vers un confrère ; le destinataire répond.
//
// §4 — régime de consentement ARBITRÉ (revue d'écarts C3, août 2026) :
// l'orientation vaut ACTE DE SOIN COORDONNÉ. Elle ne donne AUCUN accès au DMP
// (le périmètre reste piloté par `resolveDmpScope`) et ne crée donc pas de
// `Consent`. En contrepartie elle est systématiquement JOURNALISÉE
// (`REFERRAL_CREATE`) et NOTIFIÉE au destinataire.
// L'audit ne porte que des identifiants — JAMAIS le motif clinique (`reason`),
// que l'admin n'a pas à lire (même principe que `CAMPAIGN_SENT`).
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Lang } from '@digisante/shared';

import { writeAudit } from '@/lib/audit.js';
import { badRequest, forbidden, notFound } from '@/lib/errors.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';

const createSchema = z.object({
  toDoctorId: z.string().cuid(),
  patientId: z.string().cuid(),
  reason: z.string().trim().min(3).max(1000),
});
const respondSchema = z.object({ action: z.enum(['ACCEPT', 'COMPLETE', 'CANCEL']) });
const idParams = z.object({ id: z.string().cuid() });

type Action = z.infer<typeof respondSchema>['action'];
type Status = 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED';

// Machine à états complète (C6). Auparavant seul ACCEPT était gardé : on pouvait
// « terminer » une orientation annulée ou annuler une orientation déjà terminée,
// ce qui rendait les statistiques d'orientation non fiables.
// COMPLETED et CANCELLED sont TERMINAUX.
const ALLOWED_FROM: Record<Action, readonly Status[]> = {
  ACCEPT: ['PENDING'],
  COMPLETE: ['ACCEPTED'],
  CANCEL: ['PENDING', 'ACCEPTED'],
};
const ACTION_TO_STATUS: Record<Action, Status> = {
  ACCEPT: 'ACCEPTED',
  COMPLETE: 'COMPLETED',
  CANCEL: 'CANCELLED',
};

const fullName = (p: { firstName: string; lastName: string } | null, fallback: string) =>
  p ? `${p.firstName} ${p.lastName}` : fallback;

/** Notification au médecin destinataire, dans SA langue (§4 : toujours la langue du destinataire). */
function referralText(lang: Lang, fromName: string, patientName: string, reason: string) {
  return lang === 'EN'
    ? { title: 'New patient referral', body: `Dr ${fromName} refers ${patientName} to you: ${reason}` }
    : { title: 'Nouvelle orientation de patient', body: `Dr ${fromName} vous oriente ${patientName} : ${reason}` };
}

// Sélection commune des libellés affichables : sans elle l'interface n'aurait
// que des cuid à montrer.
const listSelect = {
  id: true,
  reason: true,
  status: true,
  createdAt: true,
  fromDoctorId: true,
  toDoctorId: true,
  patientId: true,
  fromDoctor: { select: { speciality: true, user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
  toDoctor: { select: { speciality: true, user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
  patient: { select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
} as const;

export default async function referralsRoutes(app: FastifyInstance) {
  const doctorOnly = { preHandler: [app.authenticate, requireRole('MEDECIN')] };

  async function myDoctorId(userId: string): Promise<string> {
    const d = await app.prisma.doctor.findUnique({ where: { userId }, select: { id: true } });
    if (!d) throw forbidden('Profil médecin requis');
    return d.id;
  }

  // Créer une orientation (médecin expéditeur).
  app.post('/', doctorOnly, async (request, reply) => {
    const input = zParse(createSchema, request.body);
    const fromDoctorId = await myDoctorId(request.user.sub);
    if (input.toDoctorId === fromDoctorId) throw badRequest('Impossible de s’orienter soi-même');

    const [toDoctor, patient, fromDoctor] = await Promise.all([
      app.prisma.doctor.findUnique({
        where: { id: input.toDoctorId },
        select: { id: true, user: { select: { id: true, lang: true } } },
      }),
      app.prisma.patient.findUnique({
        where: { id: input.patientId },
        select: { id: true, user: { select: { profile: { select: { firstName: true, lastName: true } } } } },
      }),
      app.prisma.doctor.findUnique({
        where: { id: fromDoctorId },
        select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } },
      }),
    ]);
    if (!toDoctor) throw notFound('Médecin destinataire introuvable');
    if (!patient) throw notFound('Patient introuvable');

    const referral = await app.prisma.referral.create({
      data: { fromDoctorId, toDoctorId: input.toDoctorId, patientId: input.patientId, reason: input.reason, status: 'PENDING' },
    });

    // Notification au destinataire — sans elle l'orientation resterait invisible
    // jusqu'à ce que le confrère pense à ouvrir sa liste.
    const { title, body } = referralText(
      toDoctor.user.lang,
      fullName(fromDoctor?.user.profile ?? null, 'Confrère'),
      fullName(patient.user.profile, 'Patient'),
      input.reason,
    );
    await app.prisma.notification.create({
      data: { recipientId: toDoctor.user.id, type: 'SYSTEM', channel: 'IN_APP', title, body, status: 'PENDING' },
    });

    // Audit §4 — identifiants seulement, jamais `reason` (contenu clinique).
    await writeAudit(app.prisma, {
      action: 'REFERRAL_CREATE',
      actorId: request.user.sub,
      targetId: referral.id,
      ip: request.ip,
      meta: { fromDoctorId, toDoctorId: input.toDoctorId, patientId: input.patientId },
    });

    return reply.code(201).send(referral);
  });

  // Lister mes orientations (envoyées et reçues).
  app.get('/', doctorOnly, async (request) => {
    const doctorId = await myDoctorId(request.user.sub);
    const rows = await app.prisma.referral.findMany({
      where: { OR: [{ fromDoctorId: doctorId }, { toDoctorId: doctorId }] },
      orderBy: { createdAt: 'desc' },
      select: listSelect,
    });

    return rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      direction: r.fromDoctorId === doctorId ? ('SENT' as const) : ('RECEIVED' as const),
      patientId: r.patientId,
      patientName: fullName(r.patient.user.profile, 'Patient'),
      fromDoctorName: fullName(r.fromDoctor.user.profile, 'Confrère'),
      fromSpeciality: r.fromDoctor.speciality,
      toDoctorName: fullName(r.toDoctor.user.profile, 'Confrère'),
      toSpeciality: r.toDoctor.speciality,
    }));
  });

  // Répondre à une orientation reçue (destinataire).
  app.post('/:id/respond', doctorOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const { action } = zParse(respondSchema, request.body);
    const doctorId = await myDoctorId(request.user.sub);

    const referral = await app.prisma.referral.findUnique({ where: { id }, select: { toDoctorId: true, status: true } });
    if (!referral) throw notFound('Orientation introuvable');
    if (referral.toDoctorId !== doctorId) throw forbidden('Seul le médecin destinataire peut répondre');
    if (!ALLOWED_FROM[action].includes(referral.status as Status)) {
      throw badRequest(`Transition impossible : ${referral.status} → ${ACTION_TO_STATUS[action]}`);
    }

    return app.prisma.referral.update({ where: { id }, data: { status: ACTION_TO_STATUS[action] } });
  });
}
