// ─────────────────────────────────────────────────────────────
// Service Firebase Cloud Messaging (FCM) — notifications push.
// STUB si Firebase non configuré.
// ─────────────────────────────────────────────────────────────
import type { FastifyBaseLogger } from 'fastify';

import { isFirebaseConfigured } from '@/lib/env.js';

/** Envoie une notification push à un token d'appareil (stub si non configuré). */
export async function sendPush(opts: {
  token: string | null;
  title: string;
  body: string;
  log: FastifyBaseLogger;
}): Promise<{ delivered: boolean; stub: boolean }> {
  if (!opts.token) {
    opts.log.warn('[FCM] aucun token d’appareil — push ignoré');
    return { delivered: false, stub: true };
  }
  if (!isFirebaseConfigured) {
    opts.log.warn({ title: opts.title }, `[STUB FCM] push: ${opts.body}`);
    return { delivered: false, stub: true };
  }

  // ── POINT D'INTÉGRATION FCM (à brancher) ──────────────────────────────
  // La dépendance `firebase-admin` n'est volontairement PAS ajoutée ici
  // (cf. consigne : ne pas modifier les dépendances). Deux options à l'install :
  //   1) firebase-admin :  admin.messaging().send({ token, notification: {title, body} })
  //   2) FCM HTTP v1 (sans lib) : POST https://fcm.googleapis.com/v1/projects/
  //      <FIREBASE_PROJECT_ID>/messages:send avec un Bearer OAuth2 obtenu en
  //      signant un JWT (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) sur le
  //      scope https://www.googleapis.com/auth/firebase.messaging.
  // Tant que ce n'est pas branché, on log et on signale « non livré » sans throw,
  // pour ne jamais casser le dispatch des notifications.
  opts.log.warn(
    { title: opts.title },
    '[FCM] configuré mais transport non branché (firebase-admin absent) — push non envoyé',
  );
  return { delivered: false, stub: false };
}
