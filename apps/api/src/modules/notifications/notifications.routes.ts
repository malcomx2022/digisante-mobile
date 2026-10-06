// ─────────────────────────────────────────────────────────────
// Routes Notifications (préfixe /api/v1/notifications).
// Le dispatch est déclenché par une tâche interne (cron), protégée par jeton.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { notFound, unauthorized } from '@/lib/errors.js';
import { mutateOnce } from '@/lib/idempotency.js';
import { zParse } from '@/lib/validation.js';
import { isValidServiceToken } from '@/lib/service-token.js';
import * as notifications from './notifications.service.js';

const idParams = z.object({ id: z.string().cuid() });

export default async function notificationsRoutes(app: FastifyInstance) {
  const authed = { preHandler: [app.authenticate] };

  // Mes notifications.
  app.get('/', authed, async (request) => notifications.listMine(app, request.user.sub));

  // Marquer comme lue.
  app.post('/:id/read', authed, async (request) => {
    const { id } = zParse(idParams, request.params);
    return (await mutateOnce(app, request, {
      path: `/notifications/${id}/read`,
      authorize: async (tx) => { if (!await tx.notification.findFirst({ where: { id, recipientId: request.user.sub }, select: { id: true } })) throw notFound('Notification introuvable'); },
      execute: (tx) => notifications.markRead(app, request.user.sub, id, tx),
    })).value;
  });

  // Dispatch des notifications dues (cron interne) — jeton de service requis.
  app.post('/dispatch', async (request) => {
    const token = request.headers['x-service-token'];
    if (!isValidServiceToken(token)) {
      throw unauthorized('Jeton de service invalide');
    }
    return notifications.dispatchPending(app);
  });
}
