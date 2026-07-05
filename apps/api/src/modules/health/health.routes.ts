import type { FastifyInstance } from 'fastify';

/**
 * Module exemple — montre le pattern attendu pour les 25 modules métier :
 * un fichier *.routes.ts qui reçoit l'app et enregistre ses endpoints.
 * Les services/contrôleurs/schemas zod vivent dans le même dossier.
 */
export default async function healthRoutes(app: FastifyInstance) {
  // Liveness : le process répond
  app.get('/health', async () => ({
    status: 'ok',
    service: 'digisante-api',
    ts: new Date().toISOString(),
  }));

  // Readiness : DB + Redis joignables
  app.get('/ready', async (_req, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      await app.redis.ping();
      return { status: 'ready', db: 'up', redis: 'up' };
    } catch (err) {
      app.log.error(err);
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}
