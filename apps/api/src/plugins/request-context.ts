// ─────────────────────────────────────────────────────────────
// Hooks transverses onRequest / onResponse :
//   - propage un identifiant de corrélation (x-request-id) dans la réponse,
//   - signale les requêtes lentes (observabilité).
// Le log « request completed » standard de Fastify reste actif par ailleurs.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

const SLOW_REQUEST_MS = 1000;

export default fp(async (app: FastifyInstance) => {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    if (reply.elapsedTime > SLOW_REQUEST_MS) {
      request.log.warn(
        { reqId: request.id, method: request.method, url: request.url, ms: Math.round(reply.elapsedTime) },
        'requête lente',
      );
    }
  });
});
