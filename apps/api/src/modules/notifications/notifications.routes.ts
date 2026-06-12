// ─────────────────────────────────────────────────────────────
// Routes Notifications (préfixe /api/v1/notifications).
// Le dispatch est déclenché par une tâche interne (cron), protégée par jeton.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '@/lib/env.js';
import { unauthorized } from '@/lib/errors.js';
import { zParse } from '@/lib/validation.js';
import * as notifications from './notifications.service.js';

const idParams = z.object({ id: z.string().cuid() });

export default async function notificationsRoutes(app: FastifyInstance) {
  const authed = { preHandler: [app.authenticate] };

  // Mes notifications.
  app.get('/', authed, async (request) => notifications.listMine(app, request.user.sub));

  // Marquer comme lue.
  app.post('/:id/read', authed, async (request) => {
    const { id } = zParse(idParams, request.params);
    return notifications.markRead(app, request.user.sub, id);
  });

  // Dispatch des notifications dues (cron interne) — jeton de service requis.
  app.post('/dispatch', async (request) => {
    const token = request.headers['x-service-token'];
    if (!env.RECONCILE_TOKEN || token !== env.RECONCILE_TOKEN) {
      throw unauthorized('Jeton de service invalide');
    }
    return notifications.dispatchPending(app);
  });
}
