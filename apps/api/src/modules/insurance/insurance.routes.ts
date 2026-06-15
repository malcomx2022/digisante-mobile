// ─────────────────────────────────────────────────────────────
// Routes Assurance (préfixe /api/v1/insurance).
// Catalogue ouvert à tout utilisateur authentifié ; couvertures réservées PATIENT.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as insurance from './insurance.service.js';

const addSchema = z.object({
  insuranceId: z.string().cuid(),
  memberNumber: z.string().trim().min(1).max(80),
  expiresAt: z.coerce.date().optional(),
});

export default async function insuranceRoutes(app: FastifyInstance) {
  const patientOnly = { preHandler: [app.authenticate, requireRole('PATIENT')] };

  // Catalogue des assureurs (référentiel) — disponible à tout utilisateur connecté.
  app.get('/providers', { preHandler: [app.authenticate] }, async () => insurance.listProviders(app));

  // Couvertures déclarées par le patient courant.
  app.get('/me', patientOnly, async (request) => insurance.listMine(app, request.user.sub));

  // Déclare une couverture.
  app.post('/me', patientOnly, async (request, reply) => {
    const input = zParse(addSchema, request.body);
    const result = await insurance.addMine(app, request.user.sub, input);
    return reply.code(201).send(result);
  });

  // Supprime une couverture.
  app.delete('/me/:id', patientOnly, async (request) => {
    const { id } = zParse(z.object({ id: z.string().cuid() }), request.params);
    return insurance.removeMine(app, request.user.sub, id);
  });
}
