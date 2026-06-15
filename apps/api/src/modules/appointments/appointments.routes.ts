// ─────────────────────────────────────────────────────────────
// Routes Rendez-vous (préfixe /api/v1/appointments).
// ─────────────────────────────────────────────────────────────
import { APPOINTMENT_STATUSES, APPOINTMENT_TYPES, paginationSchema } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '@/lib/env.js';
import { unauthorized } from '@/lib/errors.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as appts from './appointments.service.js';

const bookSchema = z.object({
  doctorId: z.string().cuid(),
  type: z.enum(APPOINTMENT_TYPES),
  scheduledAt: z.coerce.date(),
});

const listSchema = paginationSchema.extend({ status: z.enum(APPOINTMENT_STATUSES).optional() });
const cancelSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const triageSchema = z.object({ level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']), note: z.string().max(1000).optional() });
const agendaSchema = z.object({ from: z.coerce.date(), to: z.coerce.date() });
const idParams = z.object({ id: z.string().cuid() });

export default async function appointmentsRoutes(app: FastifyInstance) {
  const authed = { preHandler: [app.authenticate] };
  const doctorOnly = { preHandler: [app.authenticate, requireRole('MEDECIN')] };

  app.post('/', { preHandler: [app.authenticate, requireRole('PATIENT')] }, async (request, reply) => {
    const input = zParse(bookSchema, request.body);
    const created = await appts.book(app, request.user.sub, input);
    return reply.code(201).send(created);
  });

  app.get('/', authed, async (request) => {
    const q = zParse(listSchema, request.query);
    return appts.listMine(app, request.user, { page: q.page, pageSize: q.pageSize, status: q.status });
  });

  app.get('/agenda', doctorOnly, async (request) => {
    const { from, to } = zParse(agendaSchema, request.query);
    return appts.agenda(app, request.user.sub, { from, to });
  });

  app.get('/:id', authed, async (request) => {
    const { id } = zParse(idParams, request.params);
    return appts.getOne(app, request.user, id);
  });

  app.post('/:id/confirm', doctorOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    return appts.confirm(app, request.user.sub, id);
  });

  app.post('/:id/cancel', authed, async (request) => {
    const { id } = zParse(idParams, request.params);
    const { reason } = zParse(cancelSchema, request.body);
    return appts.cancel(app, request.user, id, reason, request.ip);
  });

  app.post('/:id/triage', doctorOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const triage = zParse(triageSchema, request.body);
    return appts.setTriage(app, request.user.sub, id, triage);
  });

  // Génération des rappels de RDV (cron interne) — jeton de service requis.
  app.post('/reminders/generate', async (request) => {
    const token = request.headers['x-service-token'];
    if (!env.RECONCILE_TOKEN || token !== env.RECONCILE_TOKEN) {
      throw unauthorized('Jeton de service invalide');
    }
    return appts.generateReminders(app);
  });
}
