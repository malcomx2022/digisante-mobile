// ─────────────────────────────────────────────────────────────
// Routes Référencement entre médecins (préfixe /api/v1/referrals).
// Un médecin oriente un patient vers un confrère ; le destinataire répond.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest, forbidden, notFound } from '@/lib/errors.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';

const createSchema = z.object({
  toDoctorId: z.string().cuid(),
  patientId: z.string().cuid(),
  reason: z.string().trim().min(3).max(1000),
});
const respondSchema = z.object({ action: z.enum(['ACCEPT', 'COMPLETE', 'CANCEL']) });
const idParams = z.object({ id: z.string().cuid() });

const ACTION_TO_STATUS = { ACCEPT: 'ACCEPTED', COMPLETE: 'COMPLETED', CANCEL: 'CANCELLED' } as const;

export default async function referralsRoutes(app: FastifyInstance) {
  const doctorOnly = { preHandler: [app.authenticate, requireRole('MEDECIN')] };

  async function myDoctorId(userId: string): Promise<string> {
    const d = await app.prisma.doctor.findUnique({ where: { userId }, select: { id: true } });
    if (!d) throw forbidden('Profil médecin requis');
    return d.id;
  }

  // Créer une orientation (médecin expéditeur).
  app.post('/', doctorOnly, async (request, reply) => {
    const input = zParse(createSchema, request.body);
    const fromDoctorId = await myDoctorId(request.user.sub);
    if (input.toDoctorId === fromDoctorId) throw badRequest('Impossible de s’orienter soi-même');

    const [toDoctor, patient] = await Promise.all([
      app.prisma.doctor.findUnique({ where: { id: input.toDoctorId }, select: { id: true } }),
      app.prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true } }),
    ]);
    if (!toDoctor) throw notFound('Médecin destinataire introuvable');
    if (!patient) throw notFound('Patient introuvable');

    const referral = await app.prisma.referral.create({
      data: { fromDoctorId, toDoctorId: input.toDoctorId, patientId: input.patientId, reason: input.reason, status: 'PENDING' },
    });
    return reply.code(201).send(referral);
  });

  // Lister mes orientations (envoyées et reçues).
  app.get('/', doctorOnly, async (request) => {
    const doctorId = await myDoctorId(request.user.sub);
    return app.prisma.referral.findMany({
      where: { OR: [{ fromDoctorId: doctorId }, { toDoctorId: doctorId }] },
      orderBy: { createdAt: 'desc' },
    });
  });

  // Répondre à une orientation reçue (destinataire).
  app.post('/:id/respond', doctorOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const { action } = zParse(respondSchema, request.body);
    const doctorId = await myDoctorId(request.user.sub);

    const referral = await app.prisma.referral.findUnique({ where: { id }, select: { toDoctorId: true, status: true } });
    if (!referral) throw notFound('Orientation introuvable');
    if (referral.toDoctorId !== doctorId) throw forbidden('Seul le médecin destinataire peut répondre');
    if (referral.status !== 'PENDING' && action === 'ACCEPT') throw badRequest('Orientation déjà traitée');

    return app.prisma.referral.update({ where: { id }, data: { status: ACTION_TO_STATUS[action] } });
  });
}
