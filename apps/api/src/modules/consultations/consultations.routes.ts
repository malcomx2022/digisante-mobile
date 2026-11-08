// ─────────────────────────────────────────────────────────────
// Routes Téléconsultation (préfixe /api/v1/consultations).
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as consultations from './consultations.service.js';

const startSchema = z.object({ appointmentId: z.string().cuid() });
// Strict : l'ancien champ `notes` (texte clinique EN CLAIR dans Consultation.notes)
// est refusé en 422 plutôt qu'ignoré en silence — le médecin ne doit pas croire son
// texte enregistré. Le compte rendu passe UNIQUEMENT par `report` → DMP chiffré.
const endSchema = z.strictObject({
  report: z.string().trim().min(1).max(5000).optional(),
});
const idParams = z.object({ id: z.string().cuid() });

export default async function consultationsRoutes(app: FastifyInstance) {
  const authed = { preHandler: [app.authenticate] };
  const doctorOnly = { preHandler: [app.authenticate, requireRole('MEDECIN')] };

  // Surveillance de l'état courant sans émission de jeton ni contenu médical.
  app.get('/:id/session', authed, async (request) => {
    const { id } = zParse(idParams, request.params);
    return consultations.session(app, request.user.sub, id);
  });

  // Démarrage par le médecin (crée la salle Daily.co).
  app.post('/', doctorOnly, async (request, reply) => {
    const { appointmentId } = zParse(startSchema, request.body);
    const result = await consultations.start(app, request.user.sub, appointmentId);
    return reply.code(201).send(result);
  });

  // Rejoindre (participant) → jeton Daily.
  app.post('/:id/join', authed, async (request) => {
    const { id } = zParse(idParams, request.params);
    return consultations.join(app, request.user.sub, id);
  });

  // Bascule réseau faible : VIDEO → AUDIO → CHAT.
  app.post('/:id/downgrade', authed, async (request) => {
    const { id } = zParse(idParams, request.params);
    return consultations.downgrade(app, request.user.sub, id);
  });

  // Clôture (médecin).
  app.post('/:id/end', doctorOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const { report } = zParse(endSchema, request.body ?? {});
    return consultations.end(app, request.user.sub, id, report ? { text: report, ip: request.ip } : undefined);
  });
}
