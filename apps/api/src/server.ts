import { pathToFileURL } from 'node:url';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import Redis from 'ioredis';

import { env } from '@/lib/env.js';
import { sanitizeLogUrl, serializeErrorForLog } from '@/lib/log-sanitize.js';
import adherenceRoutes from '@/modules/adherence/adherence.routes.js';
import adminRoutes from '@/modules/admin/admin.routes.js';
import adminCampaignsRoutes from '@/modules/admin/campaigns.routes.js';
import adminIntegrationsRoutes from '@/modules/admin/integrations.routes.js';
import appointmentsRoutes from '@/modules/appointments/appointments.routes.js';
import ascRoutes from '@/modules/asc/asc.routes.js';
import authRoutes from '@/modules/auth/auth.routes.js';
import beneficiariesRoutes from '@/modules/beneficiaries/beneficiaries.routes.js';
import chatRoutes from '@/modules/chat/chat.routes.js';
import consultationsRoutes from '@/modules/consultations/consultations.routes.js';
import dmpRoutes from '@/modules/dmp/dmp.routes.js';
import educationRoutes from '@/modules/education/education.routes.js';
import healthRoutes from '@/modules/health/health.routes.js';
import insuranceRoutes from '@/modules/insurance/insurance.routes.js';
import kycRoutes from '@/modules/kyc/kyc.routes.js';
import laboratoryRoutes from '@/modules/laboratory/laboratory.routes.js';
import maternityRoutes from '@/modules/maternity/maternity.routes.js';
import notificationsRoutes from '@/modules/notifications/notifications.routes.js';
import paymentsRoutes from '@/modules/payments/payments.routes.js';
import pharmacyRoutes from '@/modules/pharmacy/pharmacy.routes.js';
import prescriptionsRoutes from '@/modules/prescriptions/prescriptions.routes.js';
import professionalsRoutes from '@/modules/professionals/professionals.routes.js';
import referralsRoutes from '@/modules/referrals/referrals.routes.js';
import remindersRoutes from '@/modules/reminders/reminders.routes.js';
import sosRoutes from '@/modules/sos/sos.routes.js';
import syncRoutes from '@/modules/sync/sync.routes.js';
import subscriptionsRoutes from '@/modules/subscriptions/subscriptions.routes.js';
import usersRoutes from '@/modules/users/users.routes.js';
import vaccinationsRoutes from '@/modules/vaccinations/vaccinations.routes.js';
import walletRoutes from '@/modules/wallet/wallet.routes.js';
import authenticate from '@/plugins/authenticate.js';
import errorHandler from '@/plugins/error-handler.js';
import prismaPlugin from '@/plugins/prisma.js';
import realtime from '@/plugins/realtime.js';
import redisPlugin from '@/plugins/redis.js';
import requestContext from '@/plugins/request-context.js';
// … enregistrer ici les autres modules métier (préfixe /api/v1)

let reqCounter = 0;

export async function buildServer() {
  // Sérialiseur `req` : n'émet jamais les en-têtes (Authorization) et masque le
  // token de query (WS chat) — le JWT ne doit pas fuiter dans les journaux (§4).
  const logBase = {
    serializers: {
      // Erreurs : jamais le message d'une erreur Prisma (il recopie les arguments, §4).
      err: serializeErrorForLog,
      req(request: { method: string; url: string; ip: string; id: string }) {
        return {
          method: request.method,
          url: sanitizeLogUrl(request.url),
          remoteAddress: request.ip,
          reqId: request.id,
        };
      },
    },
  };
  const app = Fastify({
    // Derrière Nginx (même machine) : l'IP cliente vient de X-Forwarded-For, mais
    // SEULEMENT si le pair direct est local. Sans ça, `request.ip` valait 127.0.0.1
    // pour tout le monde ⇒ un SEUL seau de rate-limit pour toute la plateforme et
    // des IP d'audit inexploitables (audit de release, sept. 2026).
    trustProxy: 'loopback',
    logger:
      env.NODE_ENV === 'test'
        ? false
        : env.NODE_ENV === 'development'
          ? { transport: { target: 'pino-pretty' }, ...logBase }
          : logBase,
    // Honore un x-request-id entrant (corrélation), sinon identifiant incrémental.
    // Borné + charset restreint : anti-injection/pollution de logs via l'en-tête.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      if (typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming)) return incoming;
      return `req-${++reqCounter}`;
    },
  });

  // ── Gestion d'erreurs + hooks transverses (avant tout le reste) ──
  await app.register(errorHandler);
  await app.register(requestContext);
  // L4 : aucun corps API/session médical dans le cache HTTP du navigateur/proxy.
  // Le cache offline autorisé est uniquement la projection chiffrée explicite.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // ── Sécurité de base ──
  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  // Rate-limit partagé entre workers via Redis (cluster PM2 ×2) : sinon chaque
  // worker compte séparément et la limite effective double de façon non
  // déterministe. Connexion dédiée (hors chemin de test).
  const rateLimitStore =
    env.NODE_ENV === 'test'
      ? undefined
      : new Redis(env.REDIS_URL, {
          connectionName: 'digisante-ratelimit',
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
  await app.register(rateLimit, {
    // Les longues recettes financières ne partagent aucun seau de production.
    global: env.NODE_ENV !== 'test',
    max: 100,
    timeWindow: '1 minute',
    ...(rateLimitStore ? { redis: rateLimitStore } : {}),
  });
  if (rateLimitStore) {
    app.addHook('onClose', async () => {
      await rateLimitStore.quit();
    });
  }
  // Algorithme JWT épinglé (HS256) : refuse tout jeton signé avec un autre algo
  // (défense anti-confusion d'algorithme).
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });
  await app.register(authenticate);

  // ── Infrastructure (décorateurs app.prisma / app.redis) ──
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  // Temps réel (WebSocket + fan-out Redis) — avant les routes qui l'utilisent.
  await app.register(realtime);

  // ── Modules métier (préfixe /api/v1) ──
  await app.register(syncRoutes, { prefix: '/api/v1/sync' });
  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(usersRoutes, { prefix: '/api/v1/users' });
  await app.register(vaccinationsRoutes, { prefix: '/api/v1/vaccinations' });
  await app.register(professionalsRoutes, { prefix: '/api/v1/professionals' });
  await app.register(kycRoutes, { prefix: '/api/v1/kyc' });
  await app.register(appointmentsRoutes, { prefix: '/api/v1/appointments' });
  await app.register(ascRoutes, { prefix: '/api/v1/asc' });
  await app.register(consultationsRoutes, { prefix: '/api/v1/consultations' });
  await app.register(chatRoutes, { prefix: '/api/v1/chat' });
  await app.register(referralsRoutes, { prefix: '/api/v1/referrals' });
  await app.register(dmpRoutes, { prefix: '/api/v1/dmp' });
  await app.register(prescriptionsRoutes, { prefix: '/api/v1/prescriptions' });
  await app.register(remindersRoutes, { prefix: '/api/v1/reminders' });
  await app.register(adherenceRoutes, { prefix: '/api/v1/adherence' });
  await app.register(insuranceRoutes, { prefix: '/api/v1/insurance' });
  await app.register(pharmacyRoutes, { prefix: '/api/v1/pharmacy' });
  await app.register(laboratoryRoutes, { prefix: '/api/v1/lab' });
  await app.register(maternityRoutes, { prefix: '/api/v1/maternity' });
  await app.register(educationRoutes, { prefix: '/api/v1/education' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });
  await app.register(adminIntegrationsRoutes, { prefix: '/api/v1/admin' });
  await app.register(adminCampaignsRoutes, { prefix: '/api/v1/admin' });
  await app.register(paymentsRoutes, { prefix: '/api/v1/payments' });
  await app.register(walletRoutes, { prefix: '/api/v1/wallet' });
  await app.register(beneficiariesRoutes, { prefix: '/api/v1/beneficiaries' });
  await app.register(subscriptionsRoutes, { prefix: '/api/v1/subscriptions' });
  await app.register(notificationsRoutes, { prefix: '/api/v1/notifications' });
  await app.register(sosRoutes, { prefix: '/api/v1/sos' });

  return app;
}

export async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });
    app.log.info(`🌿 DigiSanté API prête sur ${env.API_HOST}:${env.API_PORT}`);
  } catch (err) {
    // Remontée à main.ts, qui sort en code 1 après avoir vidé son journal (port occupé…).
    app.log.error({ err }, 'écoute impossible');
    await app.close().catch(() => undefined);
    throw err;
  }
}

// Compatibilité `node dist/server.js` seulement : le point d'entrée de production est
// src/main.ts (PM2, `pnpm start`, `pnpm dev`). Cette garde est FAUSSE dès qu'un lanceur
// importe le script : sous PM2 (cluster ET fork), process.argv[1] vaut ProcessContainer*.js
// ⇒ l'API restait « online » sans jamais écouter, journaux vides (préprod 15/10/2026).
// Comparaison cross-platform (Windows/Linux) via pathToFileURL.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) {
  start();
}
