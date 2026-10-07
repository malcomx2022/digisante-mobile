// ─────────────────────────────────────────────────────────────
// Service Rendez-vous : réservation, confirmation, annulation, agenda, triage.
// L'annulation par le médecin signale un remboursement (audit PAYMENT_REFUND) ;
// la logique de remboursement réelle est branchée en Phase 4 (module payments gelé).
// ─────────────────────────────────────────────────────────────
import type { AppointmentType, Lang } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { badRequest, conflict, forbidden, notFound } from '@/lib/errors.js';
import * as payments from '@/modules/payments/payments.service.js';
import { isFuture, overlaps } from './appointments.rules.js';

const fullName = (p: { firstName: string; lastName: string } | null | undefined) =>
  p ? `${p.firstName} ${p.lastName}`.trim() : '—';

/** Résout l'id Patient à partir de l'id User (ou lève). */
async function patientIdOf(app: FastifyInstance, userId: string): Promise<string> {
  const p = await app.prisma.patient.findUnique({ where: { userId }, select: { id: true } });
  if (!p) throw forbidden('Profil patient requis');
  return p.id;
}

/** Résout l'id Doctor à partir de l'id User (ou lève). */
async function doctorIdOf(app: FastifyInstance, userId: string): Promise<string> {
  const d = await app.prisma.doctor.findUnique({ where: { userId }, select: { id: true } });
  if (!d) throw forbidden('Profil médecin requis');
  return d.id;
}

interface BookInput {
  doctorId: string;
  type: AppointmentType;
  scheduledAt: Date;
}

/** Réserve un RDV (PATIENT). Vérifie l'absence de conflit sur le créneau du médecin. */
export async function book(app: FastifyInstance, patientUserId: string, input: BookInput) {
  const patientId = await patientIdOf(app, patientUserId);
  if (!isFuture(input.scheduledAt.getTime(), Date.now())) {
    throw badRequest('La date du rendez-vous doit être dans le futur');
  }

  return app.prisma.$transaction(async (tx) => {
    // Verrou de ligne partagé entre workers PM2 : même si le créneau est encore
    // vide, une seule réservation par médecin contrôle les conflits à la fois.
    // La lecture des RDV et l'insertion doivent rester DANS cette transaction.
    const [doctor] = await tx.$queryRaw<{ id: string; slotDuration: number }[]>`
      SELECT "id", "slotDuration" FROM "doctors" WHERE "id" = ${input.doctorId} FOR UPDATE
    `;
    if (!doctor) throw notFound('Médecin introuvable');

    // Fenêtre glissante : inclut aussi un RDV qui commence avant minuit et
    // chevauche le jour suivant. Les créneaux exactement adjacents restent libres.
    const reqStart = input.scheduledAt.getTime();
    const durationMs = doctor.slotDuration * 60_000;
    const nearby = await tx.appointment.findMany({
      where: {
        doctorId: doctor.id,
        status: { in: ['PENDING', 'CONFIRMED'] },
        scheduledAt: { gt: new Date(reqStart - durationMs), lt: new Date(reqStart + durationMs) },
      },
      select: { scheduledAt: true },
    });
    if (nearby.some((a) => overlaps(reqStart, doctor.slotDuration, a.scheduledAt.getTime(), doctor.slotDuration))) {
      throw conflict('Créneau indisponible pour ce médecin');
    }

    return tx.appointment.create({
      data: { patientId, doctorId: doctor.id, type: input.type, status: 'PENDING', scheduledAt: input.scheduledAt },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/** RDV de l'utilisateur courant (patient → les siens ; médecin → les siens). */
export async function listMine(
  app: FastifyInstance,
  user: { sub: string; role: string },
  filters: { page: number; pageSize: number; status?: string },
) {
  const where =
    user.role === 'MEDECIN'
      ? { doctorId: await doctorIdOf(app, user.sub) }
      : { patientId: await patientIdOf(app, user.sub) };
  if (filters.status) Object.assign(where, { status: filters.status });

  const rows = await app.prisma.appointment.findMany({
    where,
    orderBy: { scheduledAt: 'desc' },
    skip: (filters.page - 1) * filters.pageSize,
    take: filters.pageSize,
    include: {
      doctor: { select: { speciality: true, consultFee: true, user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
      patient: { select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
      consultation: { select: { id: true, status: true } },
      payment: { select: { id: true, status: true } },
    },
  });

  // DTO enrichi : nom du correspondant (médecin pour le patient, patient pour le médecin).
  return rows.map((a) => ({
    id: a.id,
    type: a.type,
    status: a.status,
    scheduledAt: a.scheduledAt,
    patientId: a.patientId, // réf. technique (sélecteur de patient côté médecin)
    doctorName: `Dr ${fullName(a.doctor.user.profile)}`,
    speciality: a.doctor.speciality,
    patientName: fullName(a.patient.user.profile),
    consultationId: a.consultation?.id ?? null,
    consultationStatus: a.consultation?.status ?? null,
    // Paiement de la consultation : tarif du médecin + état (pour le bouton « Payer »).
    fee: a.doctor.consultFee.toNumber(),
    paid: a.payment?.status === 'COMPLETED',
    paymentStatus: a.payment?.status ?? null,
    paymentId: a.payment?.id ?? null,
  }));
}

/** Texte du rappel de RDV dans la langue du destinataire (repli FR). */
function appointmentReminderText(lang: Lang, whenLabel: string): { title: string; body: string } {
  if (lang === 'EN') return { title: 'Appointment reminder', body: `You have an appointment on ${whenLabel}` };
  return { title: 'Rappel de rendez-vous', body: `Vous avez un rendez-vous le ${whenLabel}` };
}

/**
 * Génère les rappels de RDV (cron) : pour chaque RDV CONFIRMÉ dans les 24 h à
 * venir sans rappel déjà envoyé, crée une Notification (langue du patient) et
 * marque reminderSentAt. Idempotent.
 */
export async function generateReminders(app: FastifyInstance) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 3600_000);

  const upcoming = await app.prisma.appointment.findMany({
    where: { status: 'CONFIRMED', reminderSentAt: null, scheduledAt: { gt: now, lte: horizon } },
    include: { patient: { select: { user: { select: { id: true, lang: true } } } } },
  });

  let generated = 0;
  for (const a of upcoming) {
    const lang = a.patient.user.lang;
    const whenLabel = a.scheduledAt.toLocaleString(lang === 'EN' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    const { title, body } = appointmentReminderText(lang, whenLabel);
    await app.prisma.$transaction([
      app.prisma.notification.create({
        data: { recipientId: a.patient.user.id, type: 'APPOINTMENT_REMINDER', channel: 'IN_APP', title, body, status: 'PENDING', scheduledAt: now },
      }),
      app.prisma.appointment.update({ where: { id: a.id }, data: { reminderSentAt: now } }),
    ]);
    generated += 1;
  }

  app.log.info({ job: 'appointment-reminders', generated }, 'génération des rappels de RDV dus');
  return { generated };
}

/** Charge un RDV en vérifiant que l'utilisateur en est un participant. */
async function loadParticipantAppointment(app: FastifyInstance, user: { sub: string; role: string }, id: string) {
  const appt = await app.prisma.appointment.findUnique({
    where: { id },
    include: { doctor: { select: { userId: true } }, patient: { select: { userId: true } } },
  });
  if (!appt) throw notFound('Rendez-vous introuvable');
  const isParticipant = appt.patient.userId === user.sub || appt.doctor.userId === user.sub;
  if (!isParticipant) throw forbidden('Accès réservé aux participants du rendez-vous');
  return appt;
}

export async function getOne(app: FastifyInstance, user: { sub: string; role: string }, id: string) {
  return loadParticipantAppointment(app, user, id);
}

/** Confirmation par le médecin propriétaire (PENDING → CONFIRMED). */
export async function confirm(app: FastifyInstance, doctorUserId: string, id: string) {
  const appt = await loadParticipantAppointment(app, { sub: doctorUserId, role: 'MEDECIN' }, id);
  if (appt.doctor.userId !== doctorUserId) throw forbidden('Seul le médecin peut confirmer');
  if (appt.status !== 'PENDING') throw badRequest('Seul un RDV en attente peut être confirmé');
  return app.prisma.appointment.update({ where: { id }, data: { status: 'CONFIRMED' } });
}

/** Annulation par un participant. Annulation par le médecin → signal de remboursement. */
export async function cancel(
  app: FastifyInstance,
  user: { sub: string; role: string },
  id: string,
  reason: string,
  ip?: string | null,
) {
  const appt = await loadParticipantAppointment(app, user, id);
  if (['CANCELLED', 'COMPLETED'].includes(appt.status)) {
    throw badRequest('Ce rendez-vous ne peut plus être annulé');
  }

  const updated = await app.prisma.appointment.update({
    where: { id },
    data: { status: 'CANCELLED', cancelReason: reason },
  });

  // Annulation côté médecin : rembourse automatiquement le paiement confirmé
  // éventuel (reversal interne — la couture « Phase 4 » est désormais branchée).
  if (appt.doctor.userId === user.sub) {
    const paid = await app.prisma.payment.findFirst({
      where: { appointmentId: id, status: 'COMPLETED' },
      select: { id: true },
    });
    if (paid) {
      await payments.refund(app, paid.id, { actorId: user.sub, ip, reason: 'doctor_cancel' });
    }
  }
  return updated;
}

/** Agenda du médecin sur une plage de dates. */
export async function agenda(app: FastifyInstance, doctorUserId: string, range: { from: Date; to: Date }) {
  const doctorId = await doctorIdOf(app, doctorUserId);
  return app.prisma.appointment.findMany({
    where: { doctorId, scheduledAt: { gte: range.from, lte: range.to } },
    orderBy: { scheduledAt: 'asc' },
    include: {
      patient: { select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
      // Le médecin doit savoir si la salle existe déjà : démarrer vs rejoindre.
      consultation: { select: { id: true, status: true } },
    },
  });
}

/** Triage / priorisation par le médecin. */
export async function setTriage(app: FastifyInstance, doctorUserId: string, id: string, triage: unknown) {
  const appt = await loadParticipantAppointment(app, { sub: doctorUserId, role: 'MEDECIN' }, id);
  if (appt.doctor.userId !== doctorUserId) throw forbidden('Seul le médecin peut trier ce RDV');
  return app.prisma.appointment.update({
    where: { id },
    data: { triage: triage as object },
  });
}
