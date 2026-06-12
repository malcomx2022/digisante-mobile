// ─────────────────────────────────────────────────────────────
// Gestionnaire d'erreurs global + 404 normalisé.
// Toute erreur non capturée passe par ici → réponse { code, message }.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { mapError } from '@/lib/http.js';

export default fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error, request, reply) => {
    const { statusCode, body } = mapError(error);

    const message = error instanceof Error ? error.message : String(error);
    if (statusCode >= 500) {
      // Détail interne journalisé côté serveur uniquement.
      request.log.error({ err: error, reqId: request.id }, 'Erreur non gérée');
    } else {
      request.log.warn({ code: body.code, reqId: request.id, msg: message }, 'Erreur client');
    }

    reply.code(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} introuvable`,
    });
  });
});
