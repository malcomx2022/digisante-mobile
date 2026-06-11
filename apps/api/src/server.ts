import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';

import { env } from '@/lib/env.js';
import prismaPlugin from '@/plugins/prisma.js';
import redisPlugin from '@/plugins/redis.js';

import healthRoutes from '@/modules/health/health.routes.js';
// import authRoutes from '@/modules/auth/auth.routes.js';
// import patientRoutes from '@/modules/patient/patient.routes.js';
// import consultationRoutes from '@/modules/consultation/consultation.routes.js';
// import paymentRoutes from '@/modules/payment/payment.routes.js';
// … enregistrer ici les 20 modules existants

export async function buildServer() {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty' } }
        : true,
  });

  // ── Sécurité de base ──
  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(jwt, { secret: env.JWT_SECRET });

  // ── Infrastructure (décorateurs app.prisma / app.redis) ──
  await app.register(prismaPlugin);
  await app.register(redisPlugin);

  // ── Modules métier (préfixe /api/v1) ──
  await app.register(healthRoutes, { prefix: '/api/v1' });
  // await app.register(authRoutes, { prefix: '/api/v1/auth' });
  // await app.register(patientRoutes, { prefix: '/api/v1/patients' });
  // await app.register(consultationRoutes, { prefix: '/api/v1/consultations' });
  // await app.register(paymentRoutes, { prefix: '/api/v1/payments' });

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

// Démarrage uniquement si lancé directement (pas en import de test)
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
