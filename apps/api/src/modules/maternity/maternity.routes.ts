// ─────────────────────────────────────────────────────────────
// Routes Santé maternelle (préfixe /api/v1/maternity). Patiente : suivi de
// grossesse + CPN. Générateur de rappels protégé par jeton de service (cron).
// Cloisonnement §4 : jamais la grossesse d'une autre.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { notFound, unauthorized } from '@/lib/errors.js';
import { mutateOnce } from '@/lib/idempotency.js';
import { mutationPatient, mutationVisit } from '@/lib/mutation-access.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import { isValidServiceToken } from '@/lib/service-token.js';
import * as maternity from './maternity.service.js';

const idParams = z.object({ id: z.string().cuid() });
const startSchema = z.object({ lmpDate: z.coerce.date() });
const doneSchema = z.object({ done: z.boolean().default(true), doneAt: z.coerce.date().optional() });

export default async function maternityRoutes(app: FastifyInstance) {
  const patientOnly = { preHandler: [app.authenticate, requireRole('PATIENT')] };

  // Grossesse active + CPN (ou null).
  app.get('/', patientOnly, async (request) => maternity.getActive(app, request.user.sub));

  // Démarre un suivi (génère le calendrier CPN depuis la LMP).
  app.post('/', patientOnly, async (request, reply) => {
    const input = zParse(startSchema, request.body);
    const result = await mutateOnce<Awaited<ReturnType<typeof maternity.startPregnancy>>>(app, request, {
      path: '/maternity', status: 201, roles: ['PATIENT'],
      authorize: async (tx, replayed, resourceId) => {
        const patientId = await mutationPatient(tx, request.user.sub);
        if (replayed && (!resourceId || !await tx.pregnancy.findFirst({ where: { id: resourceId, patientId }, select: { id: true } }))) throw notFound('Grossesse introuvable');
      },
      resourceId: (value) => value.id,
      execute: (tx) => maternity.startPregnancy(app, request.user.sub, input, tx),
    });
    return reply.code(201).send(result.value);
  });

  // Clôt la grossesse active.
  app.post('/end', patientOnly, async (request) => maternity.endPregnancy(app, request.user.sub));

  // Marque une CPN comme faite (ou l'annule).
  app.post('/visits/:id/done', patientOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(doneSchema, request.body ?? {});
    return (await mutateOnce(app, request, {
      path: `/maternity/visits/${id}/done`, roles: ['PATIENT'],
      authorize: (tx) => mutationVisit(tx, request.user.sub, id),
      execute: (tx) => maternity.setVisitDone(app, request.user.sub, id, input, tx),
    })).value;
  });

  // Générateur des rappels CPN dus (cron interne) — jeton de service requis.
  app.post('/reminders/generate', async (request) => {
    const token = request.headers['x-service-token'];
    if (!isValidServiceToken(token)) {
      throw unauthorized('Jeton de service invalide');
    }
    return maternity.generateDueReminders(app);
  });
}
