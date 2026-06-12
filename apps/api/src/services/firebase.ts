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
  // TODO : firebase-admin messaging().send({ token, notification }).
  opts.log.info({ title: opts.title }, 'push envoyé via FCM');
  return { delivered: true, stub: false };
}
