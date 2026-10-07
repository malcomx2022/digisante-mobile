// Routes minces ; catalogue, paiement et droits dans les services L6.
import { PAYMENT_METHODS, SUBSCRIPTION_PLANS } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as subscriptions from './subscriptions.service.js';

const subscribeSchema = z.object({ plan: z.enum(SUBSCRIPTION_PLANS), method: z.enum(PAYMENT_METHODS).optional(), requestId: z.string().uuid().optional() }).strict();
const idParams = z.object({ id: z.string().cuid() });

export default async function subscriptionsRoutes(app: FastifyInstance) {
  const doctorOnly = { preHandler: [app.authenticate, requireRole('MEDECIN')] };
  app.get('/catalog', doctorOnly, async () => subscriptions.catalog());
  app.get('/me', doctorOnly, async (request) => subscriptions.current(app, request.user.sub));
  app.get('/history', doctorOnly, async (request) => subscriptions.history(app, request.user.sub));
  app.get('/:id/checkout', doctorOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    return subscriptions.checkout(app, request.user.sub, id);
  });
  app.post('/', doctorOnly, async (request) => subscriptions.subscribe(app, request.user.sub, zParse(subscribeSchema, request.body)));
}
