// ─────────────────────────────────────────────────────────────
// Routes Bénéficiaires (préfixe /api/v1/beneficiaries). RBAC : DIASPORA.
// ─────────────────────────────────────────────────────────────
import { langSchema } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as beneficiaries from './beneficiaries.service.js';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  relationship: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(30).optional(),
  languagesSpoken: z.array(langSchema).max(5).optional(),
  notes: z.string().trim().max(500).optional(),
});

const idParams = z.object({ id: z.string().cuid() });

export default async function beneficiariesRoutes(app: FastifyInstance) {
  const diaspora = { preHandler: [app.authenticate, requireRole('DIASPORA')] };

  app.get('/', diaspora, async (request) => beneficiaries.listMine(app, request.user.sub));

  app.post('/', diaspora, async (request, reply) => {
    const input = zParse(bodySchema, request.body);
    const created = await beneficiaries.addMine(app, request.user.sub, input);
    return reply.code(201).send(created);
  });

  app.patch('/:id', diaspora, async (request) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(bodySchema, request.body);
    return beneficiaries.updateMine(app, request.user.sub, id, input);
  });

  app.delete('/:id', diaspora, async (request) => {
    const { id } = zParse(idParams, request.params);
    return beneficiaries.removeMine(app, request.user.sub, id);
  });
}
