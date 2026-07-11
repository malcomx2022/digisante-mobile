// ─────────────────────────────────────────────────────────────
// Santé maternelle — suivi de grossesse + consultations prénatales (CPN). Depuis
// la LMP on calcule le terme et on génère les 8 contacts CPN (OMS 2016). Rappels
// multilingues (§4) via le générateur cron (Notification PENDING), idempotents
// par jour (lastNotifiedOn). Une seule grossesse ACTIVE (endedAt null) à la fois.
// Cloisonnement §4 : une patiente ne voit/modifie QUE sa propre grossesse.
// ─────────────────────────────────────────────────────────────
import { buildAntenatalSchedule, computeDueDate, type Lang } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';

import { badRequest, forbidden, notFound } from '@/lib/errors.js';

async function patientIdOf(app: FastifyInstance, userId: string): Promise<string> {
  const p = await app.prisma.patient.findUnique({ where: { userId }, select: { id: true } });
  if (!p) throw forbidden('Profil patient requis');
  return p.id;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const pregnancySelect = {
  id: true,
  lmpDate: true,
  dueDate: true,
  endedAt: true,
  visits: {
    orderBy: { dueDate: 'asc' as const },
    select: { id: true, contactNumber: true, dueDate: true, doneAt: true },
  },
} as const;

/** Grossesse ACTIVE de la patiente (avec ses CPN), ou null. */
export async function getActive(app: FastifyInstance, userId: string) {
  const patientId = await patientIdOf(app, userId);
  return app.prisma.pregnancy.findFirst({
    where: { patientId, endedAt: null },
    orderBy: { createdAt: 'desc' },
    select: pregnancySelect,
  });
}

/** Démarre un suivi de grossesse (une seule active) et génère les CPN. */
export async function startPregnancy(app: FastifyInstance, userId: string, input: { lmpDate: Date }) {
  const patientId = await patientIdOf(app, userId);
  const existing = await app.prisma.pregnancy.findFirst({ where: { patientId, endedAt: null }, select: { id: true } });
  if (existing) throw badRequest('Une grossesse est déjà en cours de suivi');
  const dueDate = computeDueDate(input.lmpDate);
  const visits = buildAntenatalSchedule(input.lmpDate);
  return app.prisma.pregnancy.create({
    data: {
      patientId,
      lmpDate: input.lmpDate,
      dueDate,
      visits: { create: visits.map((v) => ({ contactNumber: v.contactNumber, dueDate: v.dueDate })) },
    },
    select: pregnancySelect,
  });
}

/** Clôt la grossesse active (accouchement / fin de suivi). */
export async function endPregnancy(app: FastifyInstance, userId: string) {
  const patientId = await patientIdOf(app, userId);
  const active = await app.prisma.pregnancy.findFirst({ where: { patientId, endedAt: null }, select: { id: true } });
  if (!active) throw notFound('Aucune grossesse en cours');
  await app.prisma.pregnancy.update({ where: { id: active.id }, data: { endedAt: new Date() } });
  return { ended: true };
}

/** Marque une CPN comme faite (ou l'annule) — propriétaire uniquement. */
export async function setVisitDone(
  app: FastifyInstance,
  userId: string,
  visitId: string,
  input: { done: boolean; doneAt?: Date },
) {
  const patientId = await patientIdOf(app, userId);
  const visit = await app.prisma.antenatalVisit.findFirst({
    where: { id: visitId, pregnancy: { patientId } },
    select: { id: true },
  });
  if (!visit) throw notFound('Consultation prénatale introuvable');
  return app.prisma.antenatalVisit.update({
    where: { id: visitId },
    data: { doneAt: input.done ? input.doneAt ?? new Date() : null },
    select: { id: true, doneAt: true },
  });
}

function reminderText(lang: Lang, contactNumber: number, dueDate: Date): { title: string; body: string } {
  const en = lang === 'EN';
  const date = dueDate.toLocaleDateString(en ? 'en-GB' : 'fr-FR');
  return en
    ? { title: 'Antenatal visit reminder', body: `Antenatal visit #${contactNumber} due on ${date}.` }
    : { title: 'Rappel consultation prénatale', body: `Consultation prénatale n°${contactNumber} prévue le ${date}.` };
}

/**
 * Génère les rappels CPN dus (cron) : pour chaque CPN NON faite d'une grossesse
 * ACTIVE dont l'échéance est ≤ aujourd'hui + 7 j (retards inclus) et non notifiée
 * aujourd'hui : crée une Notification PENDING (langue du destinataire) et marque
 * lastNotifiedOn. Idempotent par jour. Protégé par jeton de service (routes).
 */
export async function generateDueReminders(app: FastifyInstance) {
  const now = new Date();
  const startToday = startOfDay(now);
  const horizon = new Date(startToday);
  horizon.setDate(horizon.getDate() + 7);

  const due = await app.prisma.antenatalVisit.findMany({
    where: {
      doneAt: null,
      dueDate: { lte: horizon },
      pregnancy: { endedAt: null },
      OR: [{ lastNotifiedOn: null }, { lastNotifiedOn: { lt: startToday } }],
    },
    select: {
      id: true,
      contactNumber: true,
      dueDate: true,
      pregnancy: { select: { patient: { select: { userId: true, user: { select: { lang: true } } } } } },
    },
  });

  let generated = 0;
  for (const v of due) {
    const { title, body } = reminderText(v.pregnancy.patient.user.lang, v.contactNumber, v.dueDate);
    await app.prisma.$transaction([
      app.prisma.notification.create({
        data: {
          recipientId: v.pregnancy.patient.userId,
          type: 'SYSTEM',
          channel: 'IN_APP',
          title,
          body,
          status: 'PENDING',
          scheduledAt: now,
        },
      }),
      app.prisma.antenatalVisit.update({ where: { id: v.id }, data: { lastNotifiedOn: now } }),
    ]);
    generated += 1;
  }

  app.log.info({ job: 'antenatal-reminders', generated }, 'génération des rappels CPN dus');
  return { generated };
}
