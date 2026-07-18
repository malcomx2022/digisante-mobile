// ─────────────────────────────────────────────────────────────
// Routes Santé maternelle (préfixe /api/v1/maternity). Patiente : suivi de
// grossesse + CPN. Générateur de rappels protégé par jeton de service (cron).
// Cloisonnement §4 : jamais la grossesse d'une autre.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '@/lib/env.js';
import { unauthorized } from '@/lib/errors.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
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
    return reply.code(201).send(await maternity.startPregnancy(app, request.user.sub, input));
  });

  // Clôt la grossesse active.
  app.post('/end', patientOnly, async (request) => maternity.endPregnancy(app, request.user.sub));

  // Marque une CPN comme faite (ou l'annule).
  app.post('/visits/:id/done', patientOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(doneSchema, request.body ?? {});
    return maternity.setVisitDone(app, request.user.sub, id, input);
  });

  // Générateur des rappels CPN dus (cron interne) — jeton de service requis.
  app.post('/reminders/generate', async (request) => {
    const token = request.headers['x-service-token'];
    if (!env.RECONCILE_TOKEN || token !== env.RECONCILE_TOKEN) {
      throw unauthorized('Jeton de service invalide');
    }
    return maternity.generateDueReminders(app);
  });
}
