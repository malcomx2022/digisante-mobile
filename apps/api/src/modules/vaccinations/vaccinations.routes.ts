// ─────────────────────────────────────────────────────────────
// Routes Vaccination PEV (préfixe /api/v1/vaccinations). Patient : carnet de soi
// et de ses proches + marquage des doses. Générateur de rappels protégé par
// jeton de service (cron). Cloisonnement §4 : jamais les données d'un autre.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { unauthorized } from '@/lib/errors.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import { isValidServiceToken } from '@/lib/service-token.js';
import * as vacc from './vaccinations.service.js';

const idParams = z.object({ id: z.string().cuid() });

const addSubjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  birthDate: z.coerce.date(),
  isSelf: z.boolean().optional(),
});

const administeredSchema = z.object({
  done: z.boolean().default(true),
  administeredAt: z.coerce.date().optional(),
});

export default async function vaccinationsRoutes(app: FastifyInstance) {
  const patientOnly = { preHandler: [app.authenticate, requireRole('PATIENT')] };

  // Carnet : sujets (soi + proches) et leurs vaccinations.
  app.get('/', patientOnly, async (request) => vacc.listSubjects(app, request.user.sub));

  // Ajoute un sujet et génère son calendrier PEV.
  app.post('/subjects', patientOnly, async (request, reply) => {
    const input = zParse(addSubjectSchema, request.body);
    return reply.code(201).send(await vacc.addSubject(app, request.user.sub, input));
  });

  // Supprime un sujet (et ses vaccinations).
  app.delete('/subjects/:id', patientOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    return vacc.removeSubject(app, request.user.sub, id);
  });

  // Marque une vaccination comme faite (ou l'annule).
  app.post('/:id/administered', patientOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(administeredSchema, request.body ?? {});
    return vacc.setAdministered(app, request.user.sub, id, input);
  });

  // Générateur des rappels dus du jour (cron interne) — jeton de service requis.
  app.post('/reminders/generate', async (request) => {
    const token = request.headers['x-service-token'];
    if (!isValidServiceToken(token)) {
      throw unauthorized('Jeton de service invalide');
    }
    return vacc.generateDueReminders(app);
  });
}
