// Route interne des purges de conservation (D-8), appelée par le cron quotidien.
// Protégée par le jeton de service, comme les autres tâches internes.
import type { FastifyInstance } from 'fastify';
import { env } from '@/lib/env.js';
import { unauthorized } from '@/lib/errors.js';
import { isValidServiceToken } from '@/lib/service-token.js';
import { policyFromEnv, runRetention } from './retention.service.js';

export default async function retentionRoutes(app: FastifyInstance) {
  // `?dryRun=1` compte ce qui serait supprimé, sans rien supprimer ni auditer.
  app.post('/purge', async (request) => {
    if (!isValidServiceToken(request.headers['x-service-token'])) throw unauthorized('Jeton de service invalide');
    const q = request.query as { dryRun?: string };
    const dryRun = q.dryRun === '1' || q.dryRun === 'true';
    return runRetention(app.prisma, policyFromEnv(env), { dryRun });
  });
}
