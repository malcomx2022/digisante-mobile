// Téléconsultation : accès courant, salle privée, mode monotone et clôture.
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { badRequest, forbidden, notFound } from '@/lib/errors.js';
import { localize } from '@/modules/notifications/notifications.templates.js';
import { createMeetingToken, createRoom, deleteRoom, ejectParticipants, ROOM_TTL_SECONDS, uniqueRoomName } from '@/services/daily.js';
import { nextMode } from './consultations.rules.js';
import { requireProWithin } from '@/modules/subscriptions/subscriptions.effects.js';

const participantSelect = { userId: true, user: { select: { role: true, status: true } } } as const;
async function loadConsultation(app: FastifyInstance, consultationId: string) {
  const consult = await app.prisma.consultation.findUnique({
    where: { id: consultationId },
    include: { appointment: { select: { status: true, doctor: { select: { ...participantSelect, verifiedAt: true } }, patient: { select: participantSelect } } } },
  });
  if (!consult) throw notFound('Consultation introuvable');
  return consult;
}

type Loaded = Awaited<ReturnType<typeof loadConsultation>>;
function assertParticipant(consult: Loaded, userId: string) {
  const isDoctor = consult.appointment.doctor.userId === userId;
  if (!isDoctor && consult.appointment.patient.userId !== userId) throw forbidden('Accès réservé aux participants de la consultation');
  return { isDoctor };
}
function assertActive(consult: Loaded) {
  const { doctor, patient } = consult.appointment;
  if (doctor.user.status !== 'ACTIVE' || patient.user.status !== 'ACTIVE' ||
      !doctor.verifiedAt || doctor.user.role !== 'MEDECIN' || patient.user.role !== 'PATIENT') throw forbidden('Participants non habilités');
  if (consult.status !== 'ACTIVE' || consult.appointment.status !== 'CONFIRMED') throw badRequest('La consultation n’est pas active');
  const expiresAt = consult.startedAt ? Math.floor(consult.startedAt.getTime() / 1000) + ROOM_TTL_SECONDS : 0;
  if (expiresAt <= Math.floor(Date.now() / 1000)) throw badRequest('La salle a expiré');
  return expiresAt;
}

/** Toutes les conditions du démarrage, sous verrou du RDV ; relues après l'appel Daily. */
async function lockStartable(tx: Prisma.TransactionClient, doctorUserId: string, appointmentId: string) {
  // Deux démarrages simultanés ne doivent ni doubler la consultation ni sa notification.
  await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId} FOR UPDATE`;
  const appt = await tx.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      doctor: { select: { ...participantSelect, verifiedAt: true } }, consultation: { select: { id: true } },
      patient: { select: { user: { select: { id: true, lang: true, role: true, status: true } } } },
    },
  });
  if (!appt) throw notFound('Rendez-vous introuvable');
  if (appt.doctor.userId !== doctorUserId) throw forbidden('Seul le médecin du RDV peut démarrer la consultation');
  if (appt.doctor.user.status !== 'ACTIVE' || appt.patient.user.status !== 'ACTIVE' ||
      !appt.doctor.verifiedAt || appt.doctor.user.role !== 'MEDECIN' || appt.patient.user.role !== 'PATIENT') throw forbidden('Participants non habilités');
  if (appt.type !== 'TELECONSULTATION') throw badRequest('Ce rendez-vous n’est pas une téléconsultation');
  if (appt.status !== 'CONFIRMED') throw badRequest('Le rendez-vous doit être confirmé');
  if (appt.consultation) throw badRequest('Une consultation existe déjà pour ce rendez-vous');
  await requireProWithin(tx, doctorUserId);
  return appt;
}

// READ COMMITTED : chaque lecture suivant le verrou voit le dernier état validé.
const START_TX = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };

/**
 * Le démarrage ne renvoie pas de jeton inutilisé ; join est son seul émetteur.
 * B5 : aucun appel réseau sous verrou RDV/médecin. Contrôle court, création Daily
 * hors transaction sous un nom propre à la tentative, puis relecture complète et
 * insertion ; tout refus final supprime la salle de CETTE tentative.
 */
export async function start(app: FastifyInstance, doctorUserId: string, appointmentId: string) {
  // 1. Aucun appel fournisseur pour un démarrage déjà refusable.
  await app.prisma.$transaction((tx) => lockStartable(tx, doctorUserId, appointmentId), START_TX);
  // 2. Jusqu'à 2 × 8 s de réseau sans transaction : réservations du médecin libres.
  const startedAt = new Date();
  const room = await createRoom({ app, name: uniqueRoomName(appointmentId) });
  // 3. Annulation, suspension, PRO échu ou démarrage concurrent pendant l'appel : refus.
  try {
    return await app.prisma.$transaction(async (tx) => {
      const appt = await lockStartable(tx, doctorUserId, appointmentId);
      const consult = await tx.consultation.create({
        data: { appointmentId, mode: 'VIDEO', status: 'ACTIVE', dailyRoomName: room.url ? room.name : null, dailyRoomUrl: room.url, startedAt },
      });
      const { title, body } = localize('CONSULTATION_START', appt.patient.user.lang, {
        title: 'Téléconsultation', body: 'Votre téléconsultation va commencer.',
      });
      await tx.notification.create({
        data: { recipientId: appt.patient.user.id, type: 'CONSULTATION_START', channel: 'IN_APP', title, body, status: 'PENDING' },
      });
      return { consultation: consult, roomUrl: room.url, provider: room.url ? 'DAILY' : 'UNAVAILABLE' };
    }, START_TX);
  } catch (err) {
    if (room.url) {
      // Best effort : l'erreur d'origine reste la réponse ; l'expiration 4 h est le filet.
      const deleted = await deleteRoom({ app, name: room.name }).catch(() => false);
      if (!deleted) app.log.warn({ room: room.name }, '[Daily] salle d’un démarrage refusé non supprimée, expiration comme filet');
    }
    throw err;
  }
}

/** État sans jeton ni notes, relu par les deux clients toutes les 15 secondes. */
export async function session(app: FastifyInstance, userId: string, consultationId: string) {
  const consult = await loadConsultation(app, consultationId);
  assertParticipant(consult, userId);
  assertActive(consult);
  return { mode: consult.mode, status: consult.status };
}

export async function join(app: FastifyInstance, userId: string, consultationId: string) {
  const consult = await loadConsultation(app, consultationId);
  assertParticipant(consult, userId);
  const roomExpiresAt = assertActive(consult);
  if (consult.mode === 'CHAT') return { roomUrl: null, mode: 'CHAT', token: null, expiresAt: null, provider: 'CHAT' };
  // Une consultation créée sans Daily ne devient pas une salle tierce implicitement.
  const access = consult.dailyRoomName ? await createMeetingToken({
    app, room: consult.dailyRoomName, userId, roomExpiresAt, audioOnly: consult.mode === 'AUDIO',
  }) : null;
  // Une clôture/suspension pendant l'appel réseau invalide aussi cette réponse.
  const current = await loadConsultation(app, consultationId);
  assertParticipant(current, userId);
  assertActive(current);
  if (current.mode !== consult.mode) throw badRequest('Le mode a changé, rejoignez de nouveau');
  return { roomUrl: access?.roomUrl ?? null, mode: current.mode, token: access?.token ?? null, expiresAt: access?.expiresAt ?? null, provider: access ? 'DAILY' : 'UNAVAILABLE' };
}

export async function downgrade(app: FastifyInstance, userId: string, consultationId: string) {
  // Compare-and-set : une réponse lente ne peut jamais rétablir AUDIO après CHAT.
  for (;;) {
    const consult = await loadConsultation(app, consultationId);
    assertParticipant(consult, userId);
    assertActive(consult);
    const mode = nextMode(consult.mode);
    const updated = await app.prisma.consultation.updateMany({
      where: { id: consultationId, status: 'ACTIVE', mode: consult.mode }, data: { mode },
    });
    if (updated.count) return { mode };
  }
}

export async function end(app: FastifyInstance, doctorUserId: string, consultationId: string, notes?: string) {
  const consult = await loadConsultation(app, consultationId);
  if (!assertParticipant(consult, doctorUserId).isDoctor) throw forbidden('Seul le médecin peut clôturer la consultation');
  // Une échéance ou un patient suspendu ne doit pas empêcher le médecin de clôturer.
  const updated = await app.prisma.$transaction(async (tx) => {
    const result = await tx.consultation.updateMany({
      where: { id: consultationId, status: 'ACTIVE' }, data: { status: 'COMPLETED', endedAt: new Date(), notes },
    });
    if (!result.count) throw badRequest('La consultation n’est pas active');
    // Clôturer le média ne doit pas écraser une annulation du RDV et son remboursement.
    await tx.appointment.updateMany({ where: { id: consult.appointmentId, status: 'CONFIRMED' }, data: { status: 'COMPLETED' } });
    return tx.consultation.findUniqueOrThrow({ where: { id: consultationId } });
  });
  if (consult.dailyRoomName) {
    const ejected = await ejectParticipants({ app, name: consult.dailyRoomName, userIds: [consult.appointment.doctor.userId, consult.appointment.patient.userId] });
    const deleted = await deleteRoom({ app, name: consult.dailyRoomName });
    if (!ejected || !deleted) app.log.warn({ ejected, deleted }, '[Daily] clôture fournisseur incomplète, échéances actives');
  }
  return updated;
}
