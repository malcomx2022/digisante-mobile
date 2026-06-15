// ─────────────────────────────────────────────────────────────
// Routes Rappels de traitement (préfixe /api/v1/reminders).
// Note schéma : pas de modèle Reminder (26 verrouillés) → on planifie une
// Notification (scheduledAt). L'envoi multicanal dans la langue du destinataire
// est branché en P4.2 (module notifications). L'observance s'appuiera sur readAt.
// ─────────────────────────────────────────────────────────────
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '@/lib/env.js';
import { forbidden, unauthorized } from '@/lib/errors.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import * as med from './reminders.medication.js';

const createSchema = z.object({
  recipientId: z.string().cuid().optional(), // par défaut : soi-même
  type: z.enum(NOTIFICATION_TYPES).default('SYSTEM'),
  channel: z.enum(NOTIFICATION_CHANNELS).default('IN_APP'),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(1000),
  scheduledAt: z.coerce.date(),
});

const addMedSchema = z.object({
  medicationName: z.string().trim().min(1).max(200),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure « HH:mm » attendue'),
  itemId: z.string().cuid().optional(),
});
const idParams = z.object({ id: z.string().cuid() });

export default async function remindersRoutes(app: FastifyInstance) {
  const authed = { preHandler: [app.authenticate] };
  const patientOnly = { preHandler: [app.authenticate, requireRole('PATIENT')] };

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

  // ── Rappels horaires RÉCURRENTS d'observance (patient) ──
  app.get('/medication', patientOnly, async (request) => med.listMedicationReminders(app, request.user.sub));

  app.post('/medication', patientOnly, async (request, reply) => {
    const input = zParse(addMedSchema, request.body);
    return reply.code(201).send(await med.addMedicationReminder(app, request.user.sub, input));
  });

  app.delete('/medication/:id', patientOnly, async (request) => {
    const { id } = zParse(idParams, request.params);
    return med.removeMedicationReminder(app, request.user.sub, id);
  });

  // Générateur des rappels dus du jour (cron interne) — jeton de service requis.
  app.post('/generate', async (request) => {
    const token = request.headers['x-service-token'];
    if (!env.RECONCILE_TOKEN || token !== env.RECONCILE_TOKEN) {
      throw unauthorized('Jeton de service invalide');
    }
    return med.generateDueReminders(app);
  });
}
