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

/** Saisie d'un résultat (laboratoire). Détecte les valeurs critiques. */
export async function submitResult(
  app: FastifyInstance,
  labUserId: string,
  orderId: string,
  input: { values: Record<string, unknown>; reportUrl?: string },
  ip?: string | null,
) {
  const order = await app.prisma.labOrder.findUnique({
    where: { id: orderId },
    include: {
      result: { select: { id: true } },
      prescribedBy: { select: { userId: true } },
      patient: { select: { userId: true } },
    },
  });
  if (!order) throw notFound('Demande d’analyse introuvable');
  if (order.result) throw badRequest('Un résultat existe déjà pour cette demande');

  const critical = detectCriticalValues(input.values);

  const result = await app.prisma.$transaction(async (tx) => {
    const created = await tx.labResult.create({
      data: { labOrderId: orderId, values: input.values as Prisma.InputJsonValue, reportUrl: input.reportUrl },
    });
    await tx.labOrder.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
    return created;
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

/** Demandes d'analyse de l'utilisateur (médecin : prescrites ; patient : siennes). */
export async function listOrders(app: FastifyInstance, actor: { sub: string; role: string }) {
  if (actor.role === 'MEDECIN') {
    const doctor = await app.prisma.doctor.findUnique({ where: { userId: actor.sub }, select: { id: true } });
    if (!doctor) throw forbidden('Profil médecin requis');
    return app.prisma.labOrder.findMany({ where: { prescribedById: doctor.id }, orderBy: { createdAt: 'desc' }, include: { result: true } });
  }
  const patient = await app.prisma.patient.findUnique({ where: { userId: actor.sub }, select: { id: true } });
  if (!patient) throw forbidden('Profil patient requis');
  return app.prisma.labOrder.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: 'desc' }, include: { result: true } });
}
