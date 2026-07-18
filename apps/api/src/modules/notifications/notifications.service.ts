// ─────────────────────────────────────────────────────────────
// Service Notifications : dispatch multicanal (FCM / SMS Twilio / Resend / in-app)
// dans la langue du destinataire. SOS et alertes critiques traités en premier.
// Branché sur les Notification créées en PENDING par les autres modules.
// ─────────────────────────────────────────────────────────────
import type { Lang, NotificationType } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';

import { notFound } from '@/lib/errors.js';
import { sendPush } from '@/services/firebase.js';
import { sendEmail } from '@/services/resend.js';
import { sendSms } from '@/services/twilio.js';
import { localize } from './notifications.templates.js';
import { sortByPriority } from './notifications.priority.js';

/** Envoie une notification via son canal, dans la langue du destinataire. */
async function deliver(
  app: FastifyInstance,
  n: { id: string; recipientId: string; type: NotificationType; channel: string; title: string; body: string; recipient: { phone: string; email: string | null; fcmToken: string | null; lang: Lang } },
) {
  const content = localize(n.type, n.recipient.lang, { title: n.title, body: n.body });

  let delivered = false;
  switch (n.channel) {
    case 'PUSH_FCM': {
      const push = await sendPush({ app, token: n.recipient.fcmToken, title: content.title, body: content.body });
      delivered = push.delivered;
      // Token périmé / appareil désinstallé : on le purge pour ne plus réessayer.
      if (push.invalidToken) {
        await app.prisma.user.update({ where: { id: n.recipientId }, data: { fcmToken: null } }).catch(() => {});
        app.log.warn({ userId: n.recipientId }, '[FCM] token d’appareil invalide retiré');
      }
      break;
    }
    case 'SMS_TWILIO':
      ({ delivered } = await sendSms({ app, to: n.recipient.phone, body: `${content.title} — ${content.body}`, lang: n.recipient.lang }));
      break;
    case 'EMAIL':
      ({ delivered } = await sendEmail({ app, to: n.recipient.email, subject: content.title, body: content.body }));
      break;
    case 'IN_APP':
    default:
      delivered = true; // disponible dans l'app dès l'enregistrement
      break;
  }
  return delivered;
}

/**
 * Traite les notifications dues (PENDING, programmées dans le passé ou immédiates),
 * par ordre de priorité. Marque SENT/DELIVERED/FAILED.
 */
export async function dispatchPending(app: FastifyInstance, limit = 100) {
  const now = new Date();
  const pending = await app.prisma.notification.findMany({
    where: { status: 'PENDING', OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] },
    take: limit,
    include: { recipient: { select: { phone: true, email: true, fcmToken: true, lang: true } } },
  });

  const ordered = sortByPriority(pending);
  let sent = 0;
  let failed = 0;

  for (const n of ordered) {
    try {
      const delivered = await deliver(app, n);
      await app.prisma.notification.update({
        where: { id: n.id },
        data: { status: delivered ? 'DELIVERED' : 'SENT', sentAt: now },
      });
      sent += 1;
    } catch (err) {
      app.log.error({ err, id: n.id }, 'échec de dispatch de notification');
      await app.prisma.notification.update({ where: { id: n.id }, data: { status: 'FAILED' } });
      failed += 1;
    }
  }

  return { processed: ordered.length, sent, failed };
}

/** Notifications du destinataire courant. */
export async function listMine(app: FastifyInstance, userId: string) {
  return app.prisma.notification.findMany({
    where: { recipientId: userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

/** Marque une notification comme lue (destinataire). */
export async function markRead(app: FastifyInstance, userId: string, id: string) {
  const n = await app.prisma.notification.findFirst({ where: { id, recipientId: userId }, select: { id: true } });
  if (!n) throw notFound('Notification introuvable');
  return app.prisma.notification.update({ where: { id }, data: { status: 'READ', readAt: new Date() } });
}
