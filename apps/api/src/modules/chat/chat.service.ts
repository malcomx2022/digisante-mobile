// ─────────────────────────────────────────────────────────────
// Service Messagerie (chat) patient ↔ médecin (D-10, bascule téléconsult).
// Un fil unique par couple (patient, médecin). Le corps des messages est
// chiffré au repos (§4 : potentiellement des données de santé) via crypto.
// Accès réservé aux deux participants du fil.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

import { openSensitiveText, sealSensitiveText } from '@/lib/crypto.js';
import { forbidden, notFound } from '@/lib/errors.js';
import { assertCareRelationship } from '@/lib/care.js';
import { CHAT_CHANNEL, type ChatEvent } from '@/plugins/realtime.js';

interface Actor {
  sub: string;
  role: string;
}

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

const threadInclude = {
  patient: {
    select: {
      userId: true,
      user: { select: { profile: { select: { firstName: true, lastName: true } } } },
    },
  },
  doctor: {
    select: {
      userId: true,
      speciality: true,
      user: { select: { profile: { select: { firstName: true, lastName: true } } } },
    },
  },
} as const;

type ThreadWithParticipants = {
  id: string;
  patientId: string;
  doctorId: string;
  lastMessageAt: Date | null;
  patient: { userId: string; user: { profile: { firstName: string; lastName: string } | null } };
  doctor: {
    userId: string;
    speciality: string;
    user: { profile: { firstName: string; lastName: string } | null };
  };
};

/** Vérifie que l'utilisateur est l'un des deux participants du fil. */
function assertParticipant(thread: ThreadWithParticipants, userId: string): { isDoctor: boolean } {
  const isDoctor = thread.doctor.userId === userId;
  const isPatient = thread.patient.userId === userId;
  if (!isDoctor && !isPatient) throw forbidden('Accès réservé aux participants de la conversation');
  return { isDoctor };
}

function fullName(profile: { firstName: string; lastName: string } | null): string {
  if (!profile) return '—';
  return `${profile.firstName} ${profile.lastName}`.trim();
}

/** Vue du correspondant du point de vue du lecteur (l'autre participant). */
function counterpartOf(thread: ThreadWithParticipants, isDoctor: boolean) {
  if (isDoctor) {
    return { role: 'PATIENT' as const, name: fullName(thread.patient.user.profile) };
  }
  return {
    role: 'MEDECIN' as const,
    name: `Dr ${fullName(thread.doctor.user.profile)}`,
    speciality: thread.doctor.speciality,
  };
}

async function loadThread(app: FastifyInstance, threadId: string): Promise<ThreadWithParticipants> {
  const thread = await app.prisma.chatThread.findUnique({
    where: { id: threadId },
    select: { id: true, patientId: true, doctorId: true, lastMessageAt: true, ...threadInclude },
  });
  if (!thread) throw notFound('Conversation introuvable');
  return thread as ThreadWithParticipants;
}

/**
 * Ouvre (ou récupère) le fil entre l'utilisateur courant et un correspondant.
 * Patient → counterpartId = id Doctor ; Médecin → counterpartId = id Patient.
 */
export async function getOrCreateThread(app: FastifyInstance, actor: Actor, counterpartId: string) {
  let patientId: string;
  let doctorId: string;

  if (actor.role === 'MEDECIN') {
    doctorId = await doctorIdOf(app, actor.sub);
    const patient = await app.prisma.patient.findUnique({ where: { id: counterpartId }, select: { id: true } });
    if (!patient) throw notFound('Patient introuvable');
    patientId = patient.id;
    // Un fil déjà ouvert (ex. par le patient) se reprend librement ; en ouvrir un
    // nouveau exige médecin vérifié + relation de soin (sinon : nom du patient révélé).
    const existing = await app.prisma.chatThread.findUnique({ where: { patientId_doctorId: { patientId, doctorId } }, select: { id: true } });
    if (!existing) await assertCareRelationship(app, actor.sub, patientId);
  } else {
    patientId = await patientIdOf(app, actor.sub);
    const doctor = await app.prisma.doctor.findUnique({ where: { id: counterpartId }, select: { id: true } });
    if (!doctor) throw notFound('Médecin introuvable');
    doctorId = doctor.id;
  }

  const thread = (await app.prisma.chatThread.upsert({
    where: { patientId_doctorId: { patientId, doctorId } },
    create: { patientId, doctorId },
    update: {},
    select: { id: true, patientId: true, doctorId: true, lastMessageAt: true, ...threadInclude },
  })) as ThreadWithParticipants;

  const { isDoctor } = assertParticipant(thread, actor.sub);
  return {
    id: thread.id,
    lastMessageAt: thread.lastMessageAt,
    counterpart: counterpartOf(thread, isDoctor),
    unreadCount: 0,
  };
}

/** Liste les fils de l'utilisateur courant, triés par dernier message, avec le nombre de non-lus. */
export async function listThreads(app: FastifyInstance, actor: Actor) {
  const where =
    actor.role === 'MEDECIN'
      ? { doctorId: await doctorIdOf(app, actor.sub) }
      : { patientId: await patientIdOf(app, actor.sub) };

  const threads = (await app.prisma.chatThread.findMany({
    where,
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, patientId: true, doctorId: true, lastMessageAt: true, ...threadInclude },
  })) as ThreadWithParticipants[];

  if (threads.length === 0) return [];

  // Non-lus = messages du correspondant (senderId ≠ moi) non encore lus.
  const unread = await app.prisma.chatMessage.groupBy({
    by: ['threadId'],
    where: {
      threadId: { in: threads.map((t) => t.id) },
      readAt: null,
      senderId: { not: actor.sub },
    },
    _count: { _all: true },
  });
  const unreadByThread = new Map(unread.map((u) => [u.threadId, u._count._all]));

  return threads.map((thread) => {
    const { isDoctor } = assertParticipant(thread, actor.sub);
    return {
      id: thread.id,
      lastMessageAt: thread.lastMessageAt,
      counterpart: counterpartOf(thread, isDoctor),
      unreadCount: unreadByThread.get(thread.id) ?? 0,
    };
  });
}

/** Liste les messages d'un fil (ordre chronologique), corps déchiffré. */
export async function listMessages(
  app: FastifyInstance,
  actor: Actor,
  threadId: string,
  page: number,
  pageSize: number,
) {
  const thread = await loadThread(app, threadId);
  assertParticipant(thread, actor.sub);

  const messages = await app.prisma.chatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: { id: true, senderId: true, body: true, encryptedBody: true, readAt: true, createdAt: true },
  });

  return messages.map((m) => ({
    id: m.id,
    body: openSensitiveText({ plain: m.body, encrypted: m.encryptedBody }),
    mine: m.senderId === actor.sub,
    readAt: m.readAt,
    createdAt: m.createdAt,
  }));
}

/** Envoie un message dans un fil (participant) ; corps chiffré au repos. */
export async function sendMessage(app: FastifyInstance, actor: Actor, threadId: string, body: string) {
  const thread = await loadThread(app, threadId);
  assertParticipant(thread, actor.sub);

  const sealed = sealSensitiveText(body);
  const now = new Date();
  const [message] = await app.prisma.$transaction([
    app.prisma.chatMessage.create({
      data: { threadId, senderId: actor.sub, body: sealed.plain, encryptedBody: sealed.encrypted },
      select: { id: true, senderId: true, readAt: true, createdAt: true },
    }),
    app.prisma.chatThread.update({ where: { id: threadId }, data: { lastMessageAt: now } }),
  ]);

  // Diffusion temps réel aux deux participants (fan-out inter-workers via Redis).
  const event: ChatEvent = { threadId, recipients: [thread.patient.userId, thread.doctor.userId] };
  await app.redis.publish(CHAT_CHANNEL, JSON.stringify(event));

  return {
    id: message.id,
    body,
    mine: true,
    readAt: message.readAt,
    createdAt: message.createdAt,
  };
}

/** Marque comme lus les messages du correspondant dans un fil. */
export async function markRead(app: FastifyInstance, actor: Actor, threadId: string) {
  const thread = await loadThread(app, threadId);
  assertParticipant(thread, actor.sub);

  const { count } = await app.prisma.chatMessage.updateMany({
    where: { threadId, readAt: null, senderId: { not: actor.sub } },
    data: { readAt: new Date() },
  });
  return { updated: count };
}
