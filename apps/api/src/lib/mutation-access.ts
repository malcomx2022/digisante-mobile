import type { Prisma } from '@prisma/client';

import { forbidden, notFound } from './errors.js';

export async function mutationPatient(tx: Prisma.TransactionClient, userId: string) {
  const patient = await tx.patient.findUnique({ where: { userId }, select: { id: true } });
  if (!patient) throw forbidden('Profil patient requis');
  return patient.id;
}
export async function mutationVisit(tx: Prisma.TransactionClient, userId: string, id: string) {
  const patientId = await mutationPatient(tx, userId);
  if (!await tx.antenatalVisit.findFirst({ where: { id, pregnancy: { patientId } }, select: { id: true } })) throw notFound('Consultation prénatale introuvable');
}
export async function mutationVaccination(tx: Prisma.TransactionClient, userId: string, id: string) {
  const patientId = await mutationPatient(tx, userId);
  if (!await tx.vaccination.findFirst({ where: { id, subject: { patientId } }, select: { id: true } })) throw notFound('Vaccination introuvable');
}
export async function mutationSubject(tx: Prisma.TransactionClient, userId: string, id: string, replayed: boolean) {
  const patientId = await mutationPatient(tx, userId);
  // Après suppression : reçu déjà scellé pour CE compte, accusé sans contenu clinique.
  if (!replayed && !await tx.vaccinationSubject.findFirst({ where: { id, patientId }, select: { id: true } })) throw notFound('Sujet introuvable');
}
