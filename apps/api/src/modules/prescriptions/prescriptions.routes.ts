// ─────────────────────────────────────────────────────────────
// Routes Prescriptions (préfixe /api/v1/prescriptions).
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as prescriptions from './prescriptions.service.js';

const itemSchema = z.object({
  medicationName: z.string().trim().min(1).max(200), // DCI
  dosage: z.string().trim().min(1).max(100),
  frequency: z.string().trim().min(1).max(100),
  duration: z.string().trim().min(1).max(100),
});

const createSchema = z.object({
  patientId: z.string().cuid(),
  consultationId: z.string().cuid().optional(),
  validUntil: z.coerce.date(),
  items: z.array(itemSchema).min(1).max(20),
  overrideAllergyWarning: z.boolean().optional(),
});

const idParams = z.object({ id: z.string().cuid() });

export default async function prescriptionsRoutes(app: FastifyInstance) {
  const authed = { preHandler: [app.authenticate] };

  app.post('/', { preHandler: [app.authenticate, requireRole('MEDECIN')] }, async (request, reply) => {
    const input = zParse(createSchema, request.body);
    const created = await prescriptions.create(app, request.user.sub, input);
    return reply.code(201).send(created);
  });

  app.get('/', authed, async (request) => prescriptions.listMine(app, request.user));

  app.get('/:id', authed, async (request) => {
    const { id } = zParse(idParams, request.params);
    return prescriptions.getOne(app, request.user, id);
  });
}
