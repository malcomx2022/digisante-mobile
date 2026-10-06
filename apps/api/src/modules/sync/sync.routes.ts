// Purge interne des reçus expirés : cron authentifié, aucun contenu retourné.
import type { FastifyInstance } from 'fastify';

import { unauthorized } from '@/lib/errors.js';
import { isValidServiceToken } from '@/lib/service-token.js';

export default async function syncRoutes(app: FastifyInstance) {
  app.post('/receipts/prune', async (request) => {
    if (!isValidServiceToken(request.headers['x-service-token'])) throw unauthorized('Jeton de service invalide');
    const { count } = await app.prisma.mutationReceipt.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    return { deleted: count };
  });
}
