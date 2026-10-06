// ─────────────────────────────────────────────────────────────
// Service Laboratoire : demandes d'analyse + saisie de résultats structurés.
// Une VALEUR CRITIQUE déclenche une alerte prioritaire au prescripteur
// (notification PUSH + SMS) journalisée LAB_CRITICAL.
// ─────────────────────────────────────────────────────────────
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '@/lib/audit.js';
import { badRequest, forbidden, notFound } from '@/lib/errors.js';
import { authorizedLaboratory } from '@/lib/laboratory-access.js';
import { assertCareRelationship } from '@/lib/care.js';
import { detectCriticalValues } from './laboratory.rules.js';

/** Crée une demande d'analyse (médecin prescripteur). */
export async function createOrder(
  app: FastifyInstance,
  doctorUserId: string,
  input: { patientId: string; labId?: string; testType: string; scheduledAt?: Date },
) {
  const patient = await app.prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true } });
  if (!patient) throw notFound('Patient introuvable');
  const doctor = await assertCareRelationship(app, doctorUserId, patient.id);

  const create = (tx: Prisma.TransactionClient) => tx.labOrder.create({
    data: {
      prescribedById: doctor.id,
      patientId: input.patientId,
      labId: input.labId,
      testType: input.testType,
      status: 'PENDING',
      scheduledAt: input.scheduledAt,
    },
  });
  return app.prisma.$transaction(async (tx) => {
    if (input.labId) {
      const target = await tx.lab.findUnique({ where: { id: input.labId }, select: { userId: true } });
      if (!target?.userId) throw forbidden('Laboratoire approuvé et actif requis');
      await authorizedLaboratory(tx, target.userId);
    }
    return create(tx);
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
  const critical = detectCriticalValues(input.values);
  const { result, order } = await app.prisma.$transaction(async (tx) => {
    const lab = await authorizedLaboratory(tx, labUserId);
    const order = await tx.labOrder.findUnique({ where: { id: orderId },
      include: { prescribedBy: { select: { userId: true } }, patient: { select: { userId: true } } } });
    if (!order) throw notFound('Demande d’analyse introuvable');
    if (order.labId !== lab.id) throw forbidden('Demande non prise en charge par ce laboratoire');
    // Compare-and-set avant résultat : un seul effet, même en concurrence.
    const changed = await tx.labOrder.updateMany({ where: { id: orderId, labId: lab.id, status: 'PROCESSING', result: { is: null } }, data: { status: 'COMPLETED' } });
    if (changed.count !== 1) throw badRequest('Demande en traitement sans résultat requise');
    const result = await tx.labResult.create({ data: { labOrderId: orderId, values: input.values as Prisma.InputJsonValue, reportUrl: input.reportUrl } });
    // Notifie le patient que son résultat est disponible (non-critique, in-app).
    await tx.notification.create({
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
      await tx.notification.createMany({
        data: (['PUSH_FCM', 'SMS_TWILIO'] as const).map((channel) => ({
          recipientId: order.prescribedBy.userId,
          type: 'LAB_RESULT' as const,
          channel,
          title: 'Résultat de laboratoire CRITIQUE',
          body: `Valeurs critiques : ${critical.map((c) => `${c.key} ${c.reason}`).join(', ')}`,
          status: 'PENDING' as const,
        })),
      });
    }
    return { result, order };
  });

  if (critical.length > 0) {
    await writeAudit(app.prisma, {
      action: 'LAB_CRITICAL',
      actorId: labUserId,
      targetId: order.patient.userId,
      ip,
      // Métadonnées SEULEMENT (§4) : ni analyte ni valeur — l'admin lit l'audit.
      meta: { orderId, criticalCount: critical.length },
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
  if (actor.role !== 'PATIENT') throw forbidden('Accès aux analyses refusé');
  const patient = await app.prisma.patient.findUnique({ where: { userId: actor.sub }, select: { id: true } });
  if (!patient) throw forbidden('Profil patient requis');
  return app.prisma.labOrder.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: 'desc' }, include: { result: true } });
}

const patientName = {
  patient: { select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
} as const;

/** Pool des demandes en attente non assignées ou ciblées sur ce laboratoire — projection ANONYMISÉE (§4 :
 *  aucune identité patient avant prise en charge ; seuls le type d'analyse et
 *  l'échéance sont exposés). */
export async function listAvailable(app: FastifyInstance, labUserId: string) {
  return app.prisma.$transaction(async (tx) => {
    const lab = await authorizedLaboratory(tx, labUserId);
    return tx.labOrder.findMany({
      // Inclut les prescriptions ciblées pour CE laboratoire, sans identité avant claim.
      where: { status: 'PENDING', OR: [{ labId: null }, { labId: lab.id }] },
      select: { id: true, testType: true, scheduledAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' }, take: 50,
    });
  });
}

/** File des demandes prises en charge par ce laboratoire (identité patient visible). */
export async function listIncoming(app: FastifyInstance, labUserId: string) {
  return app.prisma.$transaction(async (tx) => {
    const { id: labId } = await authorizedLaboratory(tx, labUserId);
    const rows = await tx.labOrder.findMany({
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
  });
}

/** Prise en charge d'une demande du pool : l'assigne à ce labo (PENDING → SAMPLE_COLLECTED). */
export async function claimOrder(app: FastifyInstance, labUserId: string, orderId: string, ip?: string | null) {
  const updated = await app.prisma.$transaction(async (tx) => {
    const lab = await authorizedLaboratory(tx, labUserId);
    const changed = await tx.labOrder.updateMany({
      where: { id: orderId, status: 'PENDING', OR: [{ labId: null }, { labId: lab.id }] },
      data: { labId: lab.id, status: 'SAMPLE_COLLECTED' },
    });
    if (changed.count !== 1) throw badRequest('Demande indisponible ou déjà prise en charge');
    return tx.labOrder.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, status: true, patient: { select: { userId: true } } } });
  });
  await writeAudit(app.prisma, { action: 'LAB_ORDER_CLAIM', actorId: labUserId, targetId: updated.patient.userId, ip, meta: { orderId } });
  return { id: updated.id, status: updated.status };
}

async function doctorIdOf(app: FastifyInstance, userId: string): Promise<string> {
  const d = await app.prisma.doctor.findUnique({ where: { userId }, select: { id: true } });
  if (!d) throw forbidden('Profil médecin requis');
  return d.id;
}

/** Résultats des analyses prescrites par ce médecin (boucle prescrire → résultat).
 *  Recalcule les valeurs critiques pour l'affichage + statut d'interprétation. */
export async function listResultsForDoctor(app: FastifyInstance, doctorUserId: string) {
  const doctorId = await doctorIdOf(app, doctorUserId);
  const orders = await app.prisma.labOrder.findMany({
    where: { prescribedById: doctorId, result: { isNot: null } },
    select: {
      id: true,
      testType: true,
      createdAt: true,
      patient: { select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
      result: { select: { values: true, reportUrl: true, interpretation: true, interpretedAt: true, createdAt: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  return orders.map((o) => ({
    id: o.id,
    testType: o.testType,
    patient: o.patient.user.profile,
    values: o.result!.values,
    reportUrl: o.result!.reportUrl,
    critical: detectCriticalValues(o.result!.values as Record<string, unknown>),
    interpretation: o.result!.interpretation,
    interpretedAt: o.result!.interpretedAt,
    resultAt: o.result!.createdAt,
  }));
}

/** Interprétation d'un résultat par le médecin prescripteur (signe + note). */
export async function interpretResult(
  app: FastifyInstance,
  doctorUserId: string,
  orderId: string,
  interpretation: string,
) {
  const doctorId = await doctorIdOf(app, doctorUserId);
  const order = await app.prisma.labOrder.findUnique({
    where: { id: orderId },
    include: { result: { select: { id: true } }, patient: { select: { userId: true } } },
  });
  if (!order) throw notFound('Demande d’analyse introuvable');
  if (order.prescribedById !== doctorId) throw forbidden('Analyse non prescrite par ce médecin');
  if (!order.result) throw badRequest('Aucun résultat à interpréter');

  const updated = await app.prisma.labResult.update({
    where: { id: order.result.id },
    data: { interpretation, interpretedById: doctorId, interpretedAt: new Date() },
    select: { id: true, interpretation: true, interpretedAt: true },
  });

  // Notifie le patient que son médecin a interprété le résultat.
  await app.prisma.notification.create({
    data: {
      recipientId: order.patient.userId,
      type: 'LAB_RESULT',
      channel: 'IN_APP',
      title: 'Résultat interprété',
      body: 'Votre médecin a commenté votre résultat d’analyse.',
      status: 'PENDING',
    },
  });

  return updated;
}

/** Avance le statut de sa demande (SAMPLE_COLLECTED → PROCESSING). */
export async function advanceStatus(app: FastifyInstance, labUserId: string, orderId: string) {
  return app.prisma.$transaction(async (tx) => {
    const lab = await authorizedLaboratory(tx, labUserId);
    const order = await tx.labOrder.findUnique({ where: { id: orderId }, select: { labId: true } });
    if (!order) throw notFound('Demande d’analyse introuvable');
    if (order.labId !== lab.id) throw forbidden('Demande non prise en charge par ce laboratoire');
    const changed = await tx.labOrder.updateMany({ where: { id: orderId, labId: lab.id, status: 'SAMPLE_COLLECTED' }, data: { status: 'PROCESSING' } });
    if (changed.count !== 1) throw badRequest('Transition de statut non permise');
    return { id: orderId, status: 'PROCESSING' };
  });
}
