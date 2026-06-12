// ─────────────────────────────────────────────────────────────
// Service Téléconsultation : démarrage (salle Daily.co), join, bascule de mode,
// clôture. Service Daily isolé et stubbable. Accès réservé aux participants.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

import { badRequest, forbidden, notFound } from '@/lib/errors.js';
import { createMeetingToken, createRoom } from '@/services/daily.js';
import { nextMode } from './consultations.rules.js';

/** Charge une consultation + les userId des participants. */
async function loadConsultation(app: FastifyInstance, consultationId: string) {
  const consult = await app.prisma.consultation.findUnique({
    where: { id: consultationId },
    include: {
      appointment: {
        select: { id: true, doctor: { select: { userId: true } }, patient: { select: { userId: true } } },
      },
    },
  });
  if (!consult) throw notFound('Consultation introuvable');
  return consult;
}

function assertParticipant(
  consult: { appointment: { doctor: { userId: string }; patient: { userId: string } } },
  userId: string,
): { isDoctor: boolean } {
  const isDoctor = consult.appointment.doctor.userId === userId;
  const isPatient = consult.appointment.patient.userId === userId;
  if (!isDoctor && !isPatient) throw forbidden('Accès réservé aux participants de la consultation');
  return { isDoctor };
}

/** Démarre une téléconsultation pour un RDV confirmé (médecin). */
export async function start(app: FastifyInstance, doctorUserId: string, appointmentId: string) {
  const appt = await app.prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: { select: { userId: true } }, consultation: { select: { id: true } } },
  });
  if (!appt) throw notFound('Rendez-vous introuvable');
  if (appt.doctor.userId !== doctorUserId) throw forbidden('Seul le médecin du RDV peut démarrer la consultation');
  if (appt.type !== 'TELECONSULTATION') throw badRequest('Ce rendez-vous n’est pas une téléconsultation');
  if (appt.status !== 'CONFIRMED') throw badRequest('Le rendez-vous doit être confirmé');
  if (appt.consultation) throw badRequest('Une consultation existe déjà pour ce rendez-vous');

  const room = await createRoom({ name: `consult-${appointmentId}`, log: app.log });
  const consult = await app.prisma.consultation.create({
    data: {
      appointmentId,
      mode: 'VIDEO',
      status: 'ACTIVE',
      dailyRoomName: room.name,
      dailyRoomUrl: room.url,
      startedAt: new Date(),
    },
  });
  const token = await createMeetingToken({ room: room.name, userId: doctorUserId, isOwner: true, log: app.log });
  return { consultation: consult, roomUrl: room.url, token };
}

/** Rejoint une consultation active (participant) → jeton Daily. */
export async function join(app: FastifyInstance, userId: string, consultationId: string) {
  const consult = await loadConsultation(app, consultationId);
  const { isDoctor } = assertParticipant(consult, userId);
  if (consult.status !== 'ACTIVE') throw badRequest('La consultation n’est pas active');
  const token = await createMeetingToken({
    room: consult.dailyRoomName ?? `consult-${consult.appointmentId}`,
    userId,
    isOwner: isDoctor,
    log: app.log,
  });
  return { roomUrl: consult.dailyRoomUrl, mode: consult.mode, token };
}

/** Bascule le mode vers le palier dégradé suivant (réseau faible). */
export async function downgrade(app: FastifyInstance, userId: string, consultationId: string) {
  const consult = await loadConsultation(app, consultationId);
  assertParticipant(consult, userId);
  if (consult.status !== 'ACTIVE') throw badRequest('La consultation n’est pas active');
  const mode = nextMode(consult.mode);
  await app.prisma.consultation.update({ where: { id: consultationId }, data: { mode } });
  return { mode };
}

/** Clôture la consultation (médecin) + marque le RDV terminé. */
export async function end(app: FastifyInstance, doctorUserId: string, consultationId: string, notes?: string) {
  const consult = await loadConsultation(app, consultationId);
  const { isDoctor } = assertParticipant(consult, doctorUserId);
  if (!isDoctor) throw forbidden('Seul le médecin peut clôturer la consultation');

  const [updated] = await app.prisma.$transaction([
    app.prisma.consultation.update({
      where: { id: consultationId },
      data: { status: 'COMPLETED', endedAt: new Date(), notes },
    }),
    app.prisma.appointment.update({ where: { id: consult.appointmentId }, data: { status: 'COMPLETED' } }),
  ]);
  return updated;
}
