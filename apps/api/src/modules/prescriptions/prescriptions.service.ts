// ─────────────────────────────────────────────────────────────
// Service Prescriptions : création (lignes en DCI), vérification d'allergies,
// signature numérique (N° d'Ordre) + génération QR, consultation.
// La délivrance (pharmacie) est traitée en P3.4.
// ─────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';

import type { Role } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';

import { env } from '@/lib/env.js';
import { badRequest, forbidden, notFound } from '@/lib/errors.js';
import { findAllergyConflicts } from './prescriptions.rules.js';

interface Actor {
  sub: string;
  role: Role;
}

interface PrescriptionItemInput {
  medicationName: string;
  dosage: string;
  frequency: string;
  duration: string;
}

interface CreateInput {
  patientId: string;
  consultationId?: string;
  validUntil: Date;
  items: PrescriptionItemInput[];
  /** Force la prescription malgré un conflit d'allergie (décision éclairée du médecin). */
  overrideAllergyWarning?: boolean;
}

/** Calcul pur du sceau de signature (testable). */
export function computeSignature(prescriptionId: string, licenseNumber: string, secret: string): string {
  return createHash('sha256').update(`${prescriptionId}:${licenseNumber}:${secret}`).digest('hex');
}

/** Signature numérique : sceau dérivé de l'ordonnance + N° d'Ordre du médecin. */
function signPrescription(prescriptionId: string, licenseNumber: string): string {
  return computeSignature(prescriptionId, licenseNumber, env.JWT_SECRET);
}

/** Vérifie l'authenticité du QR d'une ordonnance (intégrité de la signature). */
export function verifySignature(prescriptionId: string, licenseNumber: string, qrCode: string): boolean {
  return qrCode === signPrescription(prescriptionId, licenseNumber);
}

/** Crée une ordonnance signée pour un patient (médecin). */
export async function create(app: FastifyInstance, doctorUserId: string, input: CreateInput) {
  const doctor = await app.prisma.doctor.findUnique({
    where: { userId: doctorUserId },
    select: { id: true, licenseNumber: true, verifiedAt: true },
  });
  if (!doctor) throw forbidden('Profil médecin requis');

  const patient = await app.prisma.patient.findUnique({
    where: { id: input.patientId },
    select: { id: true, allergies: true },
  });
  if (!patient) throw notFound('Patient introuvable');

  // Vérification d'allergies (bloquante sauf décision explicite du médecin).
  const conflicts = findAllergyConflicts(input.items, patient.allergies);
  if (conflicts.length > 0 && !input.overrideAllergyWarning) {
    throw badRequest('Conflit d’allergie détecté', { allergyConflicts: conflicts });
  }

  const created = await app.prisma.prescription.create({
    data: {
      doctorId: doctor.id,
      patientId: patient.id,
      consultationId: input.consultationId,
      status: 'ACTIVE',
      validUntil: input.validUntil,
      items: { create: input.items },
    },
    include: { items: true },
  });

  // Signature + QR (token de vérification, scanné par la pharmacie en P3.4).
  const qrCode = signPrescription(created.id, doctor.licenseNumber);
  const signed = await app.prisma.prescription.update({
    where: { id: created.id },
    data: { qrCode },
    include: { items: true },
  });

  return { ...signed, allergyWarnings: conflicts };
}

/** Ordonnances de l'utilisateur courant (patient : reçues ; médecin : émises). */
export async function listMine(app: FastifyInstance, actor: Actor) {
  if (actor.role === 'MEDECIN') {
    const doctor = await app.prisma.doctor.findUnique({ where: { userId: actor.sub }, select: { id: true } });
    if (!doctor) throw forbidden('Profil médecin requis');
    return app.prisma.prescription.findMany({ where: { doctorId: doctor.id }, orderBy: { createdAt: 'desc' }, include: { items: true } });
  }
  const patient = await app.prisma.patient.findUnique({ where: { userId: actor.sub }, select: { id: true } });
  if (!patient) throw forbidden('Profil patient requis');
  return app.prisma.prescription.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: 'desc' }, include: { items: true } });
}

/** Détail d'une ordonnance (participant). */
export async function getOne(app: FastifyInstance, actor: Actor, id: string) {
  const presc = await app.prisma.prescription.findUnique({
    where: { id },
    include: { items: true, doctor: { select: { userId: true } }, patient: { select: { userId: true } } },
  });
  if (!presc) throw notFound('Ordonnance introuvable');
  const isParticipant = presc.doctor.userId === actor.sub || presc.patient.userId === actor.sub;
  if (!isParticipant) throw forbidden('Accès réservé aux participants');
  return presc;
}
