import { pathToFileURL } from 'node:url';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '@/lib/env.js';
import adminRoutes from '@/modules/admin/admin.routes.js';
import appointmentsRoutes from '@/modules/appointments/appointments.routes.js';
import authRoutes from '@/modules/auth/auth.routes.js';
import consultationsRoutes from '@/modules/consultations/consultations.routes.js';
import dmpRoutes from '@/modules/dmp/dmp.routes.js';
import educationRoutes from '@/modules/education/education.routes.js';
import healthRoutes from '@/modules/health/health.routes.js';
import kycRoutes from '@/modules/kyc/kyc.routes.js';
import laboratoryRoutes from '@/modules/laboratory/laboratory.routes.js';
import pharmacyRoutes from '@/modules/pharmacy/pharmacy.routes.js';
import prescriptionsRoutes from '@/modules/prescriptions/prescriptions.routes.js';
import professionalsRoutes from '@/modules/professionals/professionals.routes.js';
import referralsRoutes from '@/modules/referrals/referrals.routes.js';
import remindersRoutes from '@/modules/reminders/reminders.routes.js';
import translationsRoutes from '@/modules/translations/translations.routes.js';
import usersRoutes from '@/modules/users/users.routes.js';
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
  await app.register(usersRoutes, { prefix: '/api/v1/users' });
  await app.register(professionalsRoutes, { prefix: '/api/v1/professionals' });
  await app.register(kycRoutes, { prefix: '/api/v1/kyc' });
  await app.register(appointmentsRoutes, { prefix: '/api/v1/appointments' });
  await app.register(consultationsRoutes, { prefix: '/api/v1/consultations' });
  await app.register(referralsRoutes, { prefix: '/api/v1/referrals' });
  await app.register(dmpRoutes, { prefix: '/api/v1/dmp' });
  await app.register(prescriptionsRoutes, { prefix: '/api/v1/prescriptions' });
  await app.register(remindersRoutes, { prefix: '/api/v1/reminders' });
  await app.register(pharmacyRoutes, { prefix: '/api/v1/pharmacy' });
  await app.register(laboratoryRoutes, { prefix: '/api/v1/lab' });
  await app.register(educationRoutes, { prefix: '/api/v1/education' });
  await app.register(translationsRoutes, { prefix: '/api/v1/translations' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });

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
