// ─────────────────────────────────────────────────────────────
// Routes ASC (préfixe /api/v1/asc). RBAC : ASC. Cloisonnement §4 par `ascId` :
// un ASC ne voit/modifie QUE son roster (jamais un DMP patient).
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as asc from './asc.service.js';

const idParams = z.object({ id: z.string().cuid() });

const beneficiarySchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).optional(),
  village: z.string().trim().max(120).optional(),
  birthDate: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
});

const observationSchema = z.object({
  systolic: z.number().int().min(0).max(300).optional(),
  diastolic: z.number().int().min(0).max(200).optional(),
  pulse: z.number().int().min(0).max(300).optional(),
  temperature: z.number().min(25).max(45).optional(),
  weight: z.number().min(0).max(400).optional(),
  triageOutcome: z.enum(['EMERGENCY', 'CONSULT', 'HOME']).optional(),
  note: z.string().trim().max(1000).optional(),
});

const relaySchema = z.object({ doctorId: z.string().cuid(), message: z.string().trim().min(1).max(1000) });

export default async function ascRoutes(app: FastifyInstance) {
  const ascOnly = { preHandler: [app.authenticate, requireRole('ASC')] };

  app.get('/beneficiaries', ascOnly, async (request) => {
    const ascId = await asc.ascIdOf(app, request.user.sub);
    return asc.listBeneficiaries(app, ascId);
  });

  app.post('/beneficiaries', ascOnly, async (request, reply) => {
    const input = zParse(beneficiarySchema, request.body);
    const ascId = await asc.ascIdOf(app, request.user.sub);
    return reply.code(201).send(await asc.addBeneficiary(app, ascId, input));
  });

  app.get('/beneficiaries/:id', ascOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const ascId = await asc.ascIdOf(app, request.user.sub);
    return asc.getBeneficiary(app, ascId, id);
  });

  app.delete('/beneficiaries/:id', ascOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const ascId = await asc.ascIdOf(app, request.user.sub);
    return asc.removeBeneficiary(app, ascId, id);
  });

  app.post('/beneficiaries/:id/observations', ascOnly, async (request, reply) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(observationSchema, request.body);
    const ascId = await asc.ascIdOf(app, request.user.sub);
    return reply.code(201).send(await asc.addObservation(app, ascId, id, input));
  });

  app.post('/beneficiaries/:id/relay', ascOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const input = zParse(relaySchema, request.body);
    const ascId = await asc.ascIdOf(app, request.user.sub);
    return asc.relayToDoctor(app, ascId, id, input);
  });
}
