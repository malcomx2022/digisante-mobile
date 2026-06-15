// ─────────────────────────────────────────────────────────────
// Rappels horaires de traitement (observance). Le patient définit des heures
// (« 08:00 ») par traitement ; un générateur (cron) matérialise les rappels dus
// du jour en Notification PENDING (envoyée par le dispatch). Idempotent via
// lastGeneratedOn (un rappel = une notification par jour max).
// ─────────────────────────────────────────────────────────────
import type { Lang } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';

import { forbidden, notFound } from '@/lib/errors.js';

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

/** Texte du rappel dans la langue du destinataire (repli FR). */
function reminderText(lang: Lang, medicationName: string): { title: string; body: string } {
  if (lang === 'EN') return { title: 'Treatment reminder', body: `Time to take: ${medicationName}` };
  return { title: 'Rappel de traitement', body: `Pensez à prendre : ${medicationName}` };
}

/** Liste les rappels horaires du patient. */
export async function listMedicationReminders(app: FastifyInstance, userId: string) {
  const patientId = await patientIdOf(app, userId);
  const reminders = await app.prisma.medicationReminder.findMany({
    where: { patientId },
    orderBy: { time: 'asc' },
    select: { id: true, itemId: true, medicationName: true, time: true },
  });
  return reminders;
}

/** Ajoute un rappel horaire (heure « HH:mm »). */
export async function addMedicationReminder(
  app: FastifyInstance,
  userId: string,
  input: { medicationName: string; time: string; itemId?: string },
) {
  const patientId = await patientIdOf(app, userId);
  if (input.itemId) {
    const item = await app.prisma.prescriptionItem.findFirst({
      where: { id: input.itemId, prescription: { patientId } },
      select: { id: true },
    });
    if (!item) throw notFound('Médicament introuvable dans vos traitements');
  }
  return app.prisma.medicationReminder.create({
    data: { patientId, itemId: input.itemId ?? null, medicationName: input.medicationName, time: input.time },
    select: { id: true, itemId: true, medicationName: true, time: true },
  });
}

/** Supprime un rappel horaire (du patient propriétaire). */
export async function removeMedicationReminder(app: FastifyInstance, userId: string, id: string) {
  const patientId = await patientIdOf(app, userId);
  const { count } = await app.prisma.medicationReminder.deleteMany({ where: { id, patientId } });
  if (count === 0) throw notFound('Rappel introuvable');
  return { removed: true };
}

/**
 * Génère les rappels dus du jour (cron). Pour chaque rappel dont l'heure est
 * passée et qui n'a pas encore été généré aujourd'hui : crée une Notification
 * PENDING (dans la langue du patient) et marque lastGeneratedOn.
 */
export async function generateDueReminders(app: FastifyInstance) {
  const now = new Date();
  const startToday = startOfDay(now);

  const reminders = await app.prisma.medicationReminder.findMany({
    include: { patient: { select: { userId: true, user: { select: { lang: true } } } } },
  });

  let generated = 0;
  for (const r of reminders) {
    const [h, m] = r.time.split(':').map((x) => Number(x));
    const due = new Date(startToday);
    due.setHours(h, m, 0, 0);
    if (now < due) continue; // l'heure n'est pas encore passée
    if (r.lastGeneratedOn && r.lastGeneratedOn >= startToday) continue; // déjà généré aujourd'hui

    const { title, body } = reminderText(r.patient.user.lang, r.medicationName);
    await app.prisma.$transaction([
      app.prisma.notification.create({
        data: {
          recipientId: r.patient.userId,
          type: 'SYSTEM',
          channel: 'IN_APP',
          title,
          body,
          status: 'PENDING',
          scheduledAt: due,
        },
      }),
      app.prisma.medicationReminder.update({ where: { id: r.id }, data: { lastGeneratedOn: now } }),
    ]);
    generated += 1;
  }

  app.log.info({ job: 'medication-reminders', generated }, 'génération des rappels de traitement dus');
  return { generated };
}
