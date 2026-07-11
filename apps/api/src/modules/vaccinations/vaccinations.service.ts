// ─────────────────────────────────────────────────────────────
// Vaccination PEV — carnet du patient et de ses proches (enfants). Le calendrier
// PEV (@digisante/shared) génère les échéances depuis la date de naissance ;
// rappels multilingues (§4) via le générateur cron (Notification PENDING),
// idempotents par jour (lastNotifiedOn). Cloisonnement §4 : un patient ne voit
// et ne modifie QUE ses propres sujets.
// ─────────────────────────────────────────────────────────────
import { buildVaccinationSchedule, type Lang, PEV_BY_CODE } from '@digisante/shared';
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

const subjectSelect = {
  id: true,
  name: true,
  birthDate: true,
  isSelf: true,
  vaccinations: {
    orderBy: { dueDate: 'asc' as const },
    select: { id: true, vaccineCode: true, doseLabel: true, dueDate: true, administeredAt: true, status: true },
  },
} as const;

/** Liste les sujets du patient (soi + proches) avec leurs vaccinations. */
export async function listSubjects(app: FastifyInstance, userId: string) {
  const patientId = await patientIdOf(app, userId);
  return app.prisma.vaccinationSubject.findMany({
    where: { patientId },
    orderBy: [{ isSelf: 'desc' }, { createdAt: 'asc' }],
    select: subjectSelect,
  });
}

/** Crée un sujet et génère ses échéances PEV depuis sa date de naissance. */
export async function addSubject(
  app: FastifyInstance,
  userId: string,
  input: { name: string; birthDate: Date; isSelf?: boolean },
) {
  const patientId = await patientIdOf(app, userId);
  const doses = buildVaccinationSchedule(input.birthDate);
  return app.prisma.vaccinationSubject.create({
    data: {
      patientId,
      name: input.name,
      birthDate: input.birthDate,
      isSelf: input.isSelf ?? false,
      vaccinations: {
        create: doses.map((d) => ({ vaccineCode: d.vaccineCode, doseLabel: d.doseLabel, dueDate: d.dueDate })),
      },
    },
    select: subjectSelect,
  });
}

/** Supprime un sujet (et ses vaccinations, cascade) — propriétaire uniquement. */
export async function removeSubject(app: FastifyInstance, userId: string, id: string) {
  const patientId = await patientIdOf(app, userId);
  const { count } = await app.prisma.vaccinationSubject.deleteMany({ where: { id, patientId } });
  if (count === 0) throw notFound('Sujet introuvable');
  return { removed: true };
}

/** Marque une vaccination comme administrée (ou annule) — propriétaire uniquement. */
export async function setAdministered(
  app: FastifyInstance,
  userId: string,
  vaccinationId: string,
  input: { done: boolean; administeredAt?: Date },
) {
  const patientId = await patientIdOf(app, userId);
  const vacc = await app.prisma.vaccination.findFirst({
    where: { id: vaccinationId, subject: { patientId } },
    select: { id: true },
  });
  if (!vacc) throw notFound('Vaccination introuvable');
  return app.prisma.vaccination.update({
    where: { id: vaccinationId },
    data: input.done
      ? { status: 'DONE', administeredAt: input.administeredAt ?? new Date() }
      : { status: 'SCHEDULED', administeredAt: null },
    select: { id: true, status: true, administeredAt: true },
  });
}

// Libellés serveur des vaccins (rappels SMS/push dans la langue du destinataire,
// §4). FR/EN ; FON/YOR retombent sur FR (cf. lecture vocale / medication reminders).
const VACCINE_LABELS: Record<string, { fr: string; en: string }> = {
  BCG: { fr: 'BCG (tuberculose)', en: 'BCG (tuberculosis)' },
  POLIO_ORAL: { fr: 'Polio oral', en: 'Oral polio' },
  POLIO_INJ: { fr: 'Polio injectable', en: 'Injectable polio' },
  HEPB: { fr: 'Hépatite B', en: 'Hepatitis B' },
  PENTA: { fr: 'Pentavalent (DTC-HepB-Hib)', en: 'Pentavalent (DTP-HepB-Hib)' },
  PNEUMO: { fr: 'Pneumocoque', en: 'Pneumococcal' },
  ROTA: { fr: 'Rotavirus', en: 'Rotavirus' },
  ROUGEOLE_RUBEOLE: { fr: 'Rougeole-Rubéole', en: 'Measles-Rubella' },
  FIEVRE_JAUNE: { fr: 'Fièvre jaune', en: 'Yellow fever' },
};

function reminderText(lang: Lang, vaccineCode: string, subjectName: string, dueDate: Date): { title: string; body: string } {
  const dose = PEV_BY_CODE[vaccineCode];
  const labels = dose ? VACCINE_LABELS[dose.vaccineKey] : undefined;
  const en = lang === 'EN';
  const name = labels ? (en ? labels.en : labels.fr) : vaccineCode;
  const doseSuffix = dose?.doseLabel ? ` ${dose.doseLabel}` : '';
  const date = dueDate.toLocaleDateString(en ? 'en-GB' : 'fr-FR');
  return en
    ? { title: 'Vaccination reminder', body: `${subjectName}: ${name}${doseSuffix} due on ${date}.` }
    : { title: 'Rappel de vaccination', body: `${subjectName} : ${name}${doseSuffix} prévu le ${date}.` };
}

/**
 * Génère les rappels de vaccination dus (cron). Pour chaque vaccination NON faite
 * dont l'échéance est ≤ aujourd'hui + 7 j (inclut les retards) et non notifiée
 * aujourd'hui : crée une Notification PENDING (langue du destinataire) et marque
 * lastNotifiedOn. Idempotent par jour. Protégé par jeton de service (routes).
 */
export async function generateDueReminders(app: FastifyInstance) {
  const now = new Date();
  const startToday = startOfDay(now);
  const horizon = new Date(startToday);
  horizon.setDate(horizon.getDate() + 7);

  const due = await app.prisma.vaccination.findMany({
    where: {
      status: 'SCHEDULED',
      dueDate: { lte: horizon },
      OR: [{ lastNotifiedOn: null }, { lastNotifiedOn: { lt: startToday } }],
    },
    select: {
      id: true,
      vaccineCode: true,
      dueDate: true,
      subject: { select: { name: true, patient: { select: { userId: true, user: { select: { lang: true } } } } } },
    },
  });

  let generated = 0;
  for (const v of due) {
    const { title, body } = reminderText(v.subject.patient.user.lang, v.vaccineCode, v.subject.name, v.dueDate);
    await app.prisma.$transaction([
      app.prisma.notification.create({
        data: {
          recipientId: v.subject.patient.userId,
          type: 'SYSTEM',
          channel: 'IN_APP',
          title,
          body,
          status: 'PENDING',
          scheduledAt: now,
        },
      }),
      app.prisma.vaccination.update({ where: { id: v.id }, data: { lastNotifiedOn: now } }),
    ]);
    generated += 1;
  }

  app.log.info({ job: 'vaccination-reminders', generated }, 'génération des rappels de vaccination dus');
  return { generated };
}
