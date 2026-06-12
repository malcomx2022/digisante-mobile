// ─────────────────────────────────────────────────────────────
// Routes Rappels de traitement (préfixe /api/v1/reminders).
// Note schéma : pas de modèle Reminder (26 verrouillés) → on planifie une
// Notification (scheduledAt). L'envoi multicanal dans la langue du destinataire
// est branché en P4.2 (module notifications). L'observance s'appuiera sur readAt.
// ─────────────────────────────────────────────────────────────
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { forbidden } from '@/lib/errors.js';
import { zParse } from '@/lib/validation.js';

const createSchema = z.object({
  recipientId: z.string().cuid().optional(), // par défaut : soi-même
  type: z.enum(NOTIFICATION_TYPES).default('SYSTEM'),
  channel: z.enum(NOTIFICATION_CHANNELS).default('IN_APP'),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(1000),
  scheduledAt: z.coerce.date(),
});

export default async function remindersRoutes(app: FastifyInstance) {
  const authed = { preHandler: [app.authenticate] };

  // Programmer un rappel. Pour un autre destinataire : réservé aux médecins.
  app.post('/', authed, async (request, reply) => {
    const input = zParse(createSchema, request.body);
    const recipientId = input.recipientId ?? request.user.sub;
    if (recipientId !== request.user.sub && request.user.role !== 'MEDECIN') {
      throw forbidden('Seul un médecin peut programmer un rappel pour autrui');
    }
    const reminder = await app.prisma.notification.create({
      data: {
        recipientId,
        type: input.type,
        channel: input.channel,
        title: input.title,
        body: input.body,
        status: 'PENDING',
        scheduledAt: input.scheduledAt,
      },
    });
    return reply.code(201).send(reminder);
  });

  // Mes rappels programmés.
  app.get('/', authed, async (request) => {
    return app.prisma.notification.findMany({
      where: { recipientId: request.user.sub, scheduledAt: { not: null } },
      orderBy: { scheduledAt: 'asc' },
    });
  });
}
