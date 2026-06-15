// ─────────────────────────────────────────────────────────────
// Observance médicamenteuse : journal des prises (« j'ai pris »), traitements
// actifs (lignes d'ordonnance en cours) et suivi (streak + % sur 7 jours).
// Conçu pour les maladies chroniques (cf. recherche e-santé : medication adherence).
// ─────────────────────────────────────────────────────────────
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
const dayKey = (d: Date) => startOfDay(d).toISOString().slice(0, 10);

/** Streak (jours consécutifs avec ≥1 prise) + % d'observance sur 7 jours glissants. */
async function computeSummary(app: FastifyInstance, patientId: string, now: Date) {
  const since = startOfDay(new Date(now.getTime() - 29 * 86_400_000)); // 30 jours
  const intakes = await app.prisma.medicationIntake.findMany({
    where: { patientId, takenAt: { gte: since } },
    select: { takenAt: true },
  });
  const days = new Set(intakes.map((i) => dayKey(i.takenAt)));

  // Streak : on remonte les jours consécutifs depuis aujourd'hui (ou hier si rien
  // n'a encore été pris aujourd'hui — la journée n'est pas terminée).
  let streak = 0;
  const cursor = startOfDay(now);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Observance 7 jours : proportion de jours (sur les 7 derniers) avec ≥1 prise.
  let days7 = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (days.has(dayKey(d))) days7 += 1;
  }

  return { streak, adherence7: Math.round((days7 / 7) * 100), daysActive: days.size };
}

/** Traitements actifs + statut « pris aujourd'hui » + résumé d'observance. */
export async function today(app: FastifyInstance, userId: string) {
  const patientId = await patientIdOf(app, userId);
  const now = new Date();

  const items = await app.prisma.prescriptionItem.findMany({
    where: {
      prescription: { patientId, status: { in: ['ACTIVE', 'PARTIALLY_DISPENSED'] }, validUntil: { gt: now } },
    },
    select: { id: true, medicationName: true, dosage: true, frequency: true },
    orderBy: { createdAt: 'desc' },
  });

  const dayStart = startOfDay(now);
  const todays = await app.prisma.medicationIntake.findMany({
    where: { patientId, takenAt: { gte: dayStart } },
    select: { itemId: true },
  });
  const takenItemIds = new Set(todays.map((t) => t.itemId).filter(Boolean));

  const treatments = items.map((it) => ({
    itemId: it.id,
    medicationName: it.medicationName,
    dosage: it.dosage,
    frequency: it.frequency,
    takenToday: takenItemIds.has(it.id),
  }));

  return { treatments, summary: await computeSummary(app, patientId, now) };
}

/** Enregistre une prise. Idempotent par (traitement, jour) lorsqu'un itemId est fourni. */
export async function logIntake(
  app: FastifyInstance,
  userId: string,
  input: { medicationName: string; itemId?: string },
) {
  const patientId = await patientIdOf(app, userId);

  if (input.itemId) {
    const item = await app.prisma.prescriptionItem.findFirst({
      where: { id: input.itemId, prescription: { patientId } },
      select: { id: true, medicationName: true },
    });
    if (!item) throw notFound('Médicament introuvable dans vos traitements');

    const dayStart = startOfDay(new Date());
    const existing = await app.prisma.medicationIntake.findFirst({
      where: { patientId, itemId: item.id, takenAt: { gte: dayStart } },
      select: { id: true },
    });
    if (existing) return { id: existing.id, alreadyTaken: true };

    const created = await app.prisma.medicationIntake.create({
      data: { patientId, itemId: item.id, medicationName: item.medicationName },
      select: { id: true, takenAt: true },
    });
    return { ...created, alreadyTaken: false };
  }

  const created = await app.prisma.medicationIntake.create({
    data: { patientId, medicationName: input.medicationName },
    select: { id: true, takenAt: true },
  });
  return { ...created, alreadyTaken: false };
}
