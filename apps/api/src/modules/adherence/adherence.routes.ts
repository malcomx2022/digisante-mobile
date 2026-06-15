// ─────────────────────────────────────────────────────────────
// Routes Observance (préfixe /api/v1/adherence) — réservé au PATIENT.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as adherence from './adherence.service.js';

const intakeSchema = z.object({
  medicationName: z.string().trim().min(1).max(200),
  itemId: z.string().cuid().optional(),
});

export default async function adherenceRoutes(app: FastifyInstance) {
  const patientOnly = { preHandler: [app.authenticate, requireRole('PATIENT')] };

  // Traitements actifs du jour + résumé d'observance (streak, % 7 jours).
  app.get('/today', patientOnly, async (request) => adherence.today(app, request.user.sub));

  // Déclare une prise (« j'ai pris »).
  app.post('/intake', patientOnly, async (request, reply) => {
    const input = zParse(intakeSchema, request.body);
    const result = await adherence.logIntake(app, request.user.sub, input);
    return reply.code(201).send(result);
  });
}
