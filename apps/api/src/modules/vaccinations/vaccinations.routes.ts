// ─────────────────────────────────────────────────────────────
// Routes Vaccination PEV (préfixe /api/v1/vaccinations). Patient : carnet de soi
// et de ses proches + marquage des doses. Générateur de rappels protégé par
// jeton de service (cron). Cloisonnement §4 : jamais les données d'un autre.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { notFound, unauthorized } from '@/lib/errors.js';
import { mutateOnce } from '@/lib/idempotency.js';
import { mutationPatient, mutationSubject, mutationVaccination } from '@/lib/mutation-access.js';
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
    const result = await mutateOnce<Awaited<ReturnType<typeof vacc.addSubject>>>(app, request, {
      path: '/vaccinations/subjects', status: 201, roles: ['PATIENT'],
      authorize: async (tx, replayed, resourceId) => {
        await mutationPatient(tx, request.user.sub);
        if (replayed) {
          if (!resourceId) throw notFound('Sujet introuvable');
          await mutationSubject(tx, request.user.sub, resourceId, false);
        }
      },
      resourceId: (value) => value.id,
      execute: (tx) => vacc.addSubject(app, request.user.sub, input, tx),
    });
    return reply.code(201).send(result.value);
  });

  // Supprime un sujet (et ses vaccinations).
  app.delete('/subjects/:id', patientOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    return (await mutateOnce(app, request, {
      path: `/vaccinations/subjects/${id}`, roles: ['PATIENT'],
      authorize: (tx, replayed) => mutationSubject(tx, request.user.sub, id, replayed),
      execute: (tx) => vacc.removeSubject(app, request.user.sub, id, tx),
    })).value;
  });

  // Marque une vaccination comme faite (ou l'annule).
  app.post('/:id/administered', patientOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(administeredSchema, request.body ?? {});
    return (await mutateOnce(app, request, {
      path: `/vaccinations/${id}/administered`, roles: ['PATIENT'],
      authorize: (tx) => mutationVaccination(tx, request.user.sub, id),
      execute: (tx) => vacc.setAdministered(app, request.user.sub, id, input, tx),
    })).value;
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
