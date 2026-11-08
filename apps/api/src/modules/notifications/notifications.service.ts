// ─────────────────────────────────────────────────────────────
// Service Notifications : dispatch multicanal (FCM / SMS Twilio / Resend / in-app)
// dans la langue du destinataire. SOS et alertes critiques traités en premier.
// Branché sur les Notification créées en PENDING par les autres modules.
// ─────────────────────────────────────────────────────────────
import type { Lang, NotificationType } from '@digisante/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { notFound } from '@/lib/errors.js';
import { sendPush } from '@/services/firebase.js';
import { sendEmail } from '@/services/resend.js';
import { sendSms } from '@/services/twilio.js';
import { localize, pushMirrorText } from './notifications.templates.js';
import { sortByPriority } from './notifications.priority.js';

/**
 * Push FCM vers l'appareil COURANT du destinataire. La liaison peut avoir été
 * retirée (logout/changement de compte) depuis le chargement du lot : relire
 * avant chaque push ; un message déjà transmis au fournisseur ne peut toutefois
 * pas être rappelé.
 */
async function pushToRecipient(
  app: FastifyInstance,
  recipientId: string,
  content: { title: string; body: string },
  opts: { silentWithoutToken?: boolean } = {},
): Promise<boolean> {
  const recipient = await app.prisma.user.findUnique({
    where: { id: recipientId }, select: { fcmToken: true },
  });
  const token = recipient?.fcmToken ?? null;
  if (!token && opts.silentWithoutToken) return false;
  if (token) {
    // Les anciennes versions ont pu garder plusieurs propriétaires. Refus
    // fermé tant que la réinscription n'a pas résolu cette liaison ambiguë.
    const owners = await app.prisma.user.findMany({
      where: { fcmToken: token }, select: { id: true }, take: 2,
    });
    if (owners.length !== 1 || owners[0]!.id !== recipientId) {
      app.log.warn({ userId: recipientId }, '[FCM] liaison d’appareil ambiguë ou retirée — push ignoré');
      return false;
    }
  }
  const push = await sendPush({ app, token, title: content.title, body: content.body });
  // Token périmé / appareil désinstallé : on le purge pour ne plus réessayer.
  if (push.invalidToken && token) {
    // Une réponse fournisseur tardive ne doit jamais effacer un token tourné.
    const removed = await app.prisma.user.updateMany({
      where: { id: recipientId, fcmToken: token }, data: { fcmToken: null },
    }).catch(() => null);
    if (removed?.count) {
      app.log.warn({ userId: recipientId }, '[FCM] token d’appareil invalide retiré');
    }
  }
  return push.delivered;
}

/** Envoie une notification via son canal, dans la langue du destinataire. */
async function deliver(
  app: FastifyInstance,
  n: { id: string; recipientId: string; type: NotificationType; channel: string; title: string; body: string; recipient: { phone: string; email: string | null; lang: Lang } },
) {
  const content = localize(n.type, n.recipient.lang, { title: n.title, body: n.body });

  let delivered = false;
  switch (n.channel) {
    case 'PUSH_FCM':
      delivered = await pushToRecipient(app, n.recipientId, content);
      break;
    case 'SMS_TWILIO':
      ({ delivered } = await sendSms({ app, to: n.recipient.phone, body: `${content.title} — ${content.body}`, lang: n.recipient.lang }));
      break;
    case 'EMAIL':
      ({ delivered } = await sendEmail({ app, to: n.recipient.email, subject: content.title, body: content.body }));
      break;
    case 'IN_APP':
    default:
      // Disponible dans l'app dès l'enregistrement. Miroir push best-effort :
      // sans lui, rappels (traitement, RDV, PEV, CPN), démarrage de consultation,
      // orientation ou signalement ASC n'atteignaient personne app fermée.
      // Texte générique (§4) ; aucun appareil lié ⇒ aucun envoi ; un échec push
      // ne dégrade pas l'in-app.
      try {
        await pushToRecipient(app, n.recipientId, pushMirrorText(n.type, n.recipient.lang), { silentWithoutToken: true });
      } catch (err) {
        app.log.warn({ err, id: n.id }, '[FCM] miroir push d’une notification in-app en échec');
      }
      delivered = true;
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
    include: { recipient: { select: { phone: true, email: true, lang: true } } },
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
export async function markRead(app: FastifyInstance, userId: string, id: string, db: PrismaClient | Prisma.TransactionClient = app.prisma) {
  const n = await db.notification.findFirst({ where: { id, recipientId: userId }, select: { id: true } });
  if (!n) throw notFound('Notification introuvable');
  return db.notification.update({ where: { id }, data: { status: 'READ', readAt: new Date() } });
}
