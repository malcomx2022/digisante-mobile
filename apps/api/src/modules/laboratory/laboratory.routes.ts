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
const interpretSchema = z.object({ interpretation: z.string().trim().min(1).max(2000) });

export default async function laboratoryRoutes(app: FastifyInstance) {
  const authed = { preHandler: [app.authenticate] };
  const labOnly = { preHandler: [app.authenticate, requireRole('LABORATOIRE')] };
  const doctorOnly = { preHandler: [app.authenticate, requireRole('MEDECIN')] };

  // Prescription d'une analyse (médecin).
  app.post('/orders', { preHandler: [app.authenticate, requireRole('MEDECIN')] }, async (request, reply) => {
    const input = zParse(orderSchema, request.body);
    const order = await lab.createOrder(app, request.user.sub, input);
    return reply.code(201).send(order);
  });

  // Mes demandes d'analyse (médecin : prescrites ; patient : siennes ; labo : prises en charge).
  app.get('/orders', authed, async (request) => lab.listOrders(app, request.user));

  // Résultats des analyses prescrites par ce médecin (boucle prescrire → résultat).
  app.get('/results', doctorOnly, async (request) => lab.listResultsForDoctor(app, request.user.sub));

  // Interprétation d'un résultat par le médecin prescripteur.
  app.post('/orders/:id/interpret', doctorOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const { interpretation } = zParse(interpretSchema, request.body);
    return lab.interpretResult(app, request.user.sub, id, interpretation);
  });

  // Pool des demandes en attente, anonymisées (labo). §4 : pas d'identité patient.
  app.get('/orders/available', labOnly, async (request) => lab.listAvailable(app, request.user.sub));

  // File des demandes prises en charge par ce labo.
  app.get('/orders/incoming', labOnly, async (request) => lab.listIncoming(app, request.user.sub));

  // Prise en charge d'une demande du pool (labo).
  app.post('/orders/:id/claim', labOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    return lab.claimOrder(app, request.user.sub, id, request.ip);
  });

  // Avance le statut d'une demande prise en charge (labo).
  app.post('/orders/:id/advance', labOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    return lab.advanceStatus(app, request.user.sub, id);
  });

  // Saisie d'un résultat (laboratoire) — détecte les valeurs critiques.
  app.post('/orders/:id/result', labOnly, async (request, reply) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(resultSchema, request.body);
    const out = await lab.submitResult(app, request.user.sub, id, input, request.ip);
    return reply.code(201).send(out);
  });
}
