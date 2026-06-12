// ─────────────────────────────────────────────────────────────
// Service Pharmacie : scan QR + vérification d'authenticité, délivrance
// partielle/totale, suggestion de générique, notification patient + médecin.
// ─────────────────────────────────────────────────────────────
import type { PrescriptionItemStatus } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';

import { badRequest, notFound } from '@/lib/errors.js';
import { verifySignature } from '@/modules/prescriptions/prescriptions.service.js';
import { suggestGeneric } from './generics.js';
import { computeDispenseStatus } from './pharmacy.rules.js';

/** Scanne un QR d'ordonnance : vérifie l'authenticité et renvoie le contenu. */
export async function scan(app: FastifyInstance, qrCode: string) {
  const presc = await app.prisma.prescription.findUnique({
    where: { qrCode },
    include: {
      items: true,
      doctor: { select: { licenseNumber: true, user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
      patient: { select: { user: { select: { profile: { select: { firstName: true, lastName: true } } } } } },
    },
  });
  if (!presc) throw notFound('Ordonnance introuvable ou QR invalide');

  const authentic = verifySignature(presc.id, presc.doctor.licenseNumber, qrCode);
  return {
    authentic,
    id: presc.id,
    status: presc.status,
    validUntil: presc.validUntil,
    expired: presc.validUntil.getTime() < Date.now(),
    doctor: presc.doctor.user.profile,
    patient: presc.patient.user.profile,
    items: presc.items.map((it) => ({
      id: it.id,
      medicationName: it.medicationName,
      dosage: it.dosage,
      frequency: it.frequency,
      duration: it.duration,
      status: it.status,
      genericSuggestion: suggestGeneric(it.medicationName),
    })),
  };
}

interface DispenseLine {
  itemId: string;
  status: Extract<PrescriptionItemStatus, 'DISPENSED' | 'PARTIALLY_DISPENSED' | 'UNAVAILABLE'>;
}

/** Délivrance (partielle/totale) : met à jour les lignes + le statut global, notifie. */
export async function dispense(app: FastifyInstance, prescriptionId: string, lines: DispenseLine[]) {
  const presc = await app.prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: { items: { select: { id: true } }, patient: { select: { userId: true } }, doctor: { select: { userId: true } } },
  });
  if (!presc) throw notFound('Ordonnance introuvable');
  if (presc.validUntil.getTime() < Date.now()) throw badRequest('Ordonnance expirée');

  const validIds = new Set(presc.items.map((i) => i.id));
  if (!lines.every((l) => validIds.has(l.itemId))) {
    throw badRequest('Une ligne ne correspond pas à cette ordonnance');
  }

  await app.prisma.$transaction(
    lines.map((l) =>
      app.prisma.prescriptionItem.update({ where: { id: l.itemId }, data: { status: l.status } }),
    ),
  );

  const items = await app.prisma.prescriptionItem.findMany({
    where: { prescriptionId },
    select: { status: true },
  });
  const status = computeDispenseStatus(items.map((i) => i.status));
  await app.prisma.prescription.update({ where: { id: prescriptionId }, data: { status } });

  // Notifie patient + médecin (envoi réel multicanal en P4.2).
  await app.prisma.notification.createMany({
    data: [presc.patient.userId, presc.doctor.userId].map((recipientId) => ({
      recipientId,
      type: 'PRESCRIPTION_READY' as const,
      channel: 'IN_APP' as const,
      title: 'Ordonnance délivrée',
      body: `Statut de délivrance : ${status}`,
      status: 'PENDING' as const,
    })),
  });

  return { prescriptionId, status };
}
