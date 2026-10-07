// Purge interne des reçus expirés : cron authentifié, aucun contenu retourné.
import type { FastifyInstance } from 'fastify';

import { forbidden, notFound, unauthorized } from '@/lib/errors.js';
import { z } from 'zod';

import { zParse } from '@/lib/validation.js';
import { isValidServiceToken } from '@/lib/service-token.js';
import { verifyMutationReceipt } from './sync.service.js';

export default async function syncRoutes(app: FastifyInstance) {
  // Ticket en ligne sans corps local : confirmer uniquement un effet déjà committé.
  app.get('/receipts/:key', { preHandler: [app.authenticate] }, async (request) => {
    const { key } = zParse(z.object({ key: z.string().max(80) }), request.params);
    const { method, route } = zParse(z.object({ method: z.enum(['POST', 'DELETE']).optional(), route: z.string().max(255).optional() }), request.query);
    if (Boolean(method) !== Boolean(route)) throw forbidden('Portée incomplète');
    const result = await verifyMutationReceipt(app, request, { key, method, route });
    if (!result) throw notFound('Effet non confirmé ; revue manuelle requise');
    return result;
  });

  app.post('/receipts/prune', async (request) => {
    if (!isValidServiceToken(request.headers['x-service-token'])) throw unauthorized('Jeton de service invalide');
    const { count } = await app.prisma.mutationReceipt.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    return { deleted: count };
  });
}
