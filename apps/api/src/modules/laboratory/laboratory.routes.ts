// ─────────────────────────────────────────────────────────────
// Routes Laboratoire (préfixe /api/v1/lab).
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as lab from './laboratory.service.js';

const orderSchema = z.object({
  patientId: z.string().cuid(),
  labId: z.string().cuid().optional(),
  testType: z.string().trim().min(2).max(160),
  scheduledAt: z.coerce.date().optional(),
});

const resultSchema = z.object({
  values: z.record(z.unknown()),
  reportUrl: z.string().url().optional(),
});

const idParams = z.object({ id: z.string().cuid() });

export default async function laboratoryRoutes(app: FastifyInstance) {
  const authed = { preHandler: [app.authenticate] };

  // Prescription d'une analyse (médecin).
  app.post('/orders', { preHandler: [app.authenticate, requireRole('MEDECIN')] }, async (request, reply) => {
    const input = zParse(orderSchema, request.body);
    const order = await lab.createOrder(app, request.user.sub, input);
    return reply.code(201).send(order);
  });

  // Mes demandes d'analyse.
  app.get('/orders', authed, async (request) => lab.listOrders(app, request.user));

  // Saisie d'un résultat (laboratoire) — détecte les valeurs critiques.
  app.post('/orders/:id/result', { preHandler: [app.authenticate, requireRole('LABORATOIRE')] }, async (request, reply) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(resultSchema, request.body);
    const out = await lab.submitResult(app, request.user.sub, id, input, request.ip);
    return reply.code(201).send(out);
  });
}
