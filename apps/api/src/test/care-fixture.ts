// Fixture de test : établit une RELATION DE SOIN médecin↔patient (cf. lib/care.ts).
// Depuis l'audit de release (sept. 2026), prescrire, commander une analyse, orienter,
// ouvrir un fil de chat ou programmer un rappel exige un médecin VÉRIFIÉ ayant une
// relation de soin avec le patient. Les tests passent par un vrai rendez-vous plutôt
// que d'affaiblir la garde.
import type { FastifyInstance } from 'fastify';

export async function linkCare(app: FastifyInstance, doctorUserId: string, patientId: string) {
  const doctor = await app.prisma.doctor.update({
    where: { userId: doctorUserId },
    // Tient lieu d'une approbation KYC (aucun effet si déjà vérifié).
    data: { verifiedAt: new Date() },
    select: { id: true },
  });
  return app.prisma.appointment.create({
    data: {
      doctorId: doctor.id,
      patientId,
      type: 'TELECONSULTATION',
      status: 'CONFIRMED',
      scheduledAt: new Date(Date.now() + 24 * 3600_000),
    },
  });
}
