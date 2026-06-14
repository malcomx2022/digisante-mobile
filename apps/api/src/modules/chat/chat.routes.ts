// ─────────────────────────────────────────────────────────────
// Routes Messagerie (préfixe /api/v1/chat) — patient ↔ médecin.
// Réservé aux rôles PATIENT et MEDECIN ; accès aux fils contrôlé par participant.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as chat from './chat.service.js';

const idParams = z.object({ id: z.string().cuid() });
const openThreadSchema = z.object({ counterpartId: z.string().cuid() });
const sendSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const listMessagesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export default async function chatRoutes(app: FastifyInstance) {
  const participantOnly = { preHandler: [app.authenticate, requireRole('PATIENT', 'MEDECIN')] };

  // Mes conversations (avec non-lus).
  app.get('/threads', participantOnly, async (request) => {
    return chat.listThreads(app, request.user);
  });

  // Ouvre/récupère un fil avec un correspondant (counterpartId = Doctor.id ou Patient.id selon le rôle).
  app.post('/threads', participantOnly, async (request, reply) => {
    const { counterpartId } = zParse(openThreadSchema, request.body);
    const thread = await chat.getOrCreateThread(app, request.user, counterpartId);
    return reply.code(201).send(thread);
  });

  // Messages d'un fil (chronologique).
  app.get('/threads/:id/messages', participantOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    const { page, pageSize } = zParse(listMessagesQuery, request.query);
    return chat.listMessages(app, request.user, id, page, pageSize);
  });

  // Envoi d'un message.
  app.post('/threads/:id/messages', participantOnly, async (request, reply) => {
    const { id } = zParse(idParams, request.params);
    const { body } = zParse(sendSchema, request.body);
    const message = await chat.sendMessage(app, request.user, id, body);
    return reply.code(201).send(message);
  });

  // Marque les messages du correspondant comme lus.
  app.post('/threads/:id/read', participantOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    return chat.markRead(app, request.user, id);
  });
}
