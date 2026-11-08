// ─────────────────────────────────────────────────────────────
// Droit à l'effacement — file admin (préfixe /api/v1/admin).
// Lecture : users:read ; exécution / refus : users:write. §4 : identité et
// statut uniquement, jamais de contenu médical.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { zParse } from '@/lib/validation.js';
import * as privacy from '@/modules/users/users.privacy.js';
import { adminGuards, idParams } from './admin.shared.js';

const listSchema = z.object({ status: z.enum(['PENDING', 'COMPLETED', 'REJECTED']).optional() });
const rejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export default async function adminDeletionsRoutes(app: FastifyInstance) {
  const { withScope } = adminGuards(app);

  app.get('/deletion-requests', withScope('users:read'), async (request) => {
    const { status } = zParse(listSchema, request.query);
    return privacy.listDeletionRequests(app, status);
  });

  // Irréversible : anonymisation + effacement des données de santé du patient.
  app.post('/deletion-requests/:id/execute', withScope('users:write'), async (request) => {
    const { id } = zParse(idParams, request.params);
    return privacy.executeDeletion(app, request.user.sub, id, request.ip);
  });

  app.post('/deletion-requests/:id/reject', withScope('users:write'), async (request) => {
    const { id } = zParse(idParams, request.params);
    const { reason } = zParse(rejectSchema, request.body);
    return privacy.rejectDeletion(app, request.user.sub, id, reason, request.ip);
  });
}
