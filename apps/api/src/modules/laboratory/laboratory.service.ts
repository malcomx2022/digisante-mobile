// ─────────────────────────────────────────────────────────────
// Service Laboratoire : demandes d'analyse + saisie de résultats structurés.
// Une VALEUR CRITIQUE déclenche une alerte prioritaire au prescripteur
// (notification PUSH + SMS) journalisée LAB_CRITICAL.
// ─────────────────────────────────────────────────────────────
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '@/lib/audit.js';
import { badRequest, forbidden, notFound } from '@/lib/errors.js';
import { detectCriticalValues } from './laboratory.rules.js';

/** Résout l'id du laboratoire lié à l'utilisateur courant (rôle LABORATOIRE). */
export async function labIdOf(app: FastifyInstance, userId: string): Promise<string> {
  const l = await app.prisma.lab.findUnique({ where: { userId }, select: { id: true } });
  if (!l) throw forbidden('Profil laboratoire requis');
  return l.id;
}

/** Crée une demande d'analyse (médecin prescripteur). */
export async function createOrder(
  app: FastifyInstance,
  doctorUserId: string,
  input: { patientId: string; labId?: string; testType: string; scheduledAt?: Date },
) {
  const doctor = await app.prisma.doctor.findUnique({ where: { userId: doctorUserId }, select: { id: true } });
  if (!doctor) throw forbidden('Profil médecin requis');
  const patient = await app.prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true } });
  if (!patient) throw notFound('Patient introuvable');

  return app.prisma.labOrder.create({
    data: {
      prescribedById: doctor.id,
      patientId: input.patientId,
      labId: input.labId,
      testType: input.testType,
      status: 'PENDING',
      scheduledAt: input.scheduledAt,
    },
  });
}

/** Saisie d'un résultat (laboratoire). Détecte les valeurs critiques.
 *  La demande doit être prise en charge par CE laboratoire (appartenance). */
export async function submitResult(
  app: FastifyInstance,
  labUserId: string,
  orderId: string,
  input: { values: Record<string, unknown>; reportUrl?: string },
  ip?: string | null,
) {
  const labId = await labIdOf(app, labUserId);
  const order = await app.prisma.labOrder.findUnique({
    where: { id: orderId },
    include: {
      result: { select: { id: true } },
      prescribedBy: { select: { userId: true } },
      patient: { select: { userId: true } },
    },
  });
  if (!order) throw notFound('Demande d’analyse introuvable');
  if (order.labId !== labId) throw forbidden('Demande non prise en charge par ce laboratoire');
  if (order.result) throw badRequest('Un résultat existe déjà pour cette demande');

  const critical = detectCriticalValues(input.values);

  const result = await app.prisma.$transaction(async (tx) => {
    const created = await tx.labResult.create({
      data: { labOrderId: orderId, values: input.values as Prisma.InputJsonValue, reportUrl: input.reportUrl },
    });
    await tx.labOrder.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
    return created;
  });

  // Notifie le patient que son résultat est disponible (non-critique, in-app).
  await app.prisma.notification.create({
    data: {
      recipientId: order.patient.userId,
      type: 'LAB_RESULT',
      channel: 'IN_APP',
      title: 'Résultat d’analyse disponible',
      body: 'Votre résultat de laboratoire est prêt.',
      status: 'PENDING',
    },
  });

  if (critical.length > 0) {
    // Alerte prioritaire au prescripteur : PUSH + SMS (envoi réel en P4.2).
    await app.prisma.notification.createMany({
      data: (['PUSH_FCM', 'SMS_TWILIO'] as const).map((channel) => ({
        recipientId: order.prescribedBy.userId,
        type: 'LAB_RESULT' as const,
        channel,
        title: 'Résultat de laboratoire CRITIQUE',
        body: `Valeurs critiques : ${critical.map((c) => `${c.key} ${c.reason}`).join(', ')}`,
        status: 'PENDING' as const,
      })),
    });
    await writeAudit(app.prisma, {
      action: 'LAB_CRITICAL',
      actorId: labUserId,
      targetId: order.patient.userId,
      ip,
      meta: { orderId, critical },
    });
  }

  return { result, critical };
}

/** Demandes d'analyse de l'utilisateur (médecin : prescrites ; patient : siennes ;
 *  laboratoire : celles qu'il a prises en charge). */
export async function listOrders(app: FastifyInstance, actor: { sub: string; role: string }) {
  if (actor.role === 'MEDECIN') {
    const doctor = await app.prisma.doctor.findUnique({ where: { userId: actor.sub }, select: { id: true } });
    if (!doctor) throw forbidden('Profil médecin requis');
    return app.prisma.labOrder.findMany({ where: { prescribedById: doctor.id }, orderBy: { createdAt: 'desc' }, include: { result: true } });
  }
  if (actor.role === 'LABORATOIRE') {
    return listIncoming(app, actor.sub);
  }
  const patient = await app.prisma.patient.findUnique({ where: { userId: actor.sub }, select: { id: true } });
  if (!patient) throw forbidden('Profil patient requis');
  return app.prisma.labOrder.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: 'desc' }, include: { result: true } });
}

const patientName = {
  patient: { select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
} as const;

/** Pool des demandes en attente NON assignées — projection ANONYMISÉE (§4 :
 *  aucune identité patient avant prise en charge ; seuls le type d'analyse et
 *  l'échéance sont exposés). */
export async function listAvailable(app: FastifyInstance, labUserId: string) {
  await labIdOf(app, labUserId); // garantit le rôle/profil
  return app.prisma.labOrder.findMany({
    where: { status: 'PENDING', labId: null },
    select: { id: true, testType: true, scheduledAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
}

/** File des demandes prises en charge par ce laboratoire (identité patient visible). */
export async function listIncoming(app: FastifyInstance, labUserId: string) {
  const labId = await labIdOf(app, labUserId);
  const rows = await app.prisma.labOrder.findMany({
    where: { labId, status: { in: ['SAMPLE_COLLECTED', 'PROCESSING', 'COMPLETED'] } },
    select: {
      id: true,
      testType: true,
      status: true,
      scheduledAt: true,
      createdAt: true,
      result: { select: { id: true } },
      prescribedBy: { select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
      ...patientName,
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    testType: r.testType,
    status: r.status,
    scheduledAt: r.scheduledAt,
    hasResult: Boolean(r.result),
    patient: r.patient.user.profile,
    prescribedBy: r.prescribedBy.user.profile,
  }));
}

/** Prise en charge d'une demande du pool : l'assigne à ce labo (PENDING → SAMPLE_COLLECTED). */
export async function claimOrder(app: FastifyInstance, labUserId: string, orderId: string, ip?: string | null) {
  const labId = await labIdOf(app, labUserId);
  const order = await app.prisma.labOrder.findUnique({
    where: { id: orderId },
    select: { id: true, labId: true, status: true, patient: { select: { userId: true } } },
  });
  if (!order) throw notFound('Demande d’analyse introuvable');
  if (order.labId || order.status !== 'PENDING') throw badRequest('Demande déjà prise en charge');

  const updated = await app.prisma.labOrder.update({
    where: { id: orderId },
    data: { labId, status: 'SAMPLE_COLLECTED' },
    select: { id: true, status: true },
  });
  await writeAudit(app.prisma, { action: 'LAB_ORDER_CLAIM', actorId: labUserId, targetId: order.patient.userId, ip, meta: { orderId } });
  return updated;
}

const NEXT_STATUS: Record<string, 'PROCESSING'> = { SAMPLE_COLLECTED: 'PROCESSING' };

/** Avance le statut d'une demande prise en charge (SAMPLE_COLLECTED → PROCESSING). */
export async function advanceStatus(app: FastifyInstance, labUserId: string, orderId: string) {
  const labId = await labIdOf(app, labUserId);
  const order = await app.prisma.labOrder.findUnique({ where: { id: orderId }, select: { labId: true, status: true } });
  if (!order) throw notFound('Demande d’analyse introuvable');
  if (order.labId !== labId) throw forbidden('Demande non prise en charge par ce laboratoire');
  const next = NEXT_STATUS[order.status];
  if (!next) throw badRequest('Transition de statut non permise');
  return app.prisma.labOrder.update({ where: { id: orderId }, data: { status: next }, select: { id: true, status: true } });
}
