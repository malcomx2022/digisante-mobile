import { pathToFileURL } from 'node:url';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '@/lib/env.js';
import authRoutes from '@/modules/auth/auth.routes.js';
import healthRoutes from '@/modules/health/health.routes.js';
import authenticate from '@/plugins/authenticate.js';
import errorHandler from '@/plugins/error-handler.js';
import prismaPlugin from '@/plugins/prisma.js';
import redisPlugin from '@/plugins/redis.js';
import requestContext from '@/plugins/request-context.js';
// … enregistrer ici les autres modules métier (préfixe /api/v1)

let reqCounter = 0;

export async function buildServer() {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty' } }
        : env.NODE_ENV === 'test'
          ? false
          : true,
    // Honore un x-request-id entrant (corrélation), sinon identifiant incrémental.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && incoming.length > 0 ? incoming : `req-${++reqCounter}`;
    },
  });

  // ── Gestion d'erreurs + hooks transverses (avant tout le reste) ──
  await app.register(errorHandler);
  await app.register(requestContext);

  // ── Sécurité de base ──
  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(authenticate);

  // ── Infrastructure (décorateurs app.prisma / app.redis) ──
  await app.register(prismaPlugin);
  await app.register(redisPlugin);

  // ── Modules métier (préfixe /api/v1) ──
  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });

  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });
    app.log.info(`🌿 DigiSanté API prête sur ${env.API_HOST}:${env.API_PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Démarrage uniquement si lancé directement (pas en import de test).
// Comparaison cross-platform (Windows/Linux) via pathToFileURL.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) {
  start();
}
