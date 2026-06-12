// ─────────────────────────────────────────────────────────────
// Service Daily.co — salles de téléconsultation WebRTC + jetons de réunion.
// STUB tant que DAILY_API_KEY/DOMAIN ne sont pas configurés (dev/local).
// Piège (CLAUDE.md §8) : prévoir la bascule auto téléconsultation → chat (D-10)
// quand la bande passante chute — gérée côté contrat via le mode de consultation.
// ─────────────────────────────────────────────────────────────
import type { FastifyBaseLogger } from 'fastify';

import { env, isDailyConfigured } from '@/lib/env.js';

export interface DailyRoom {
  name: string;
  url: string;
}

/** Crée (ou réutilise) une salle de téléconsultation. */
export async function createRoom(opts: { name: string; log: FastifyBaseLogger }): Promise<DailyRoom> {
  if (!isDailyConfigured) {
    opts.log.warn({ room: opts.name }, '[STUB Daily] salle simulée (Daily.co non configuré)');
    return { name: opts.name, url: `https://stub.daily.co/${opts.name}` };
  }
  // TODO : POST https://api.daily.co/v1/rooms (privée, expiration, propriétés).
  return { name: opts.name, url: `https://${env.DAILY_DOMAIN}.daily.co/${opts.name}` };
}

/** Émet un jeton de réunion pour un participant donné. */
export async function createMeetingToken(opts: {
  room: string;
  userId: string;
  isOwner: boolean;
  log: FastifyBaseLogger;
}): Promise<string> {
  if (!isDailyConfigured) {
    return `stub-token.${opts.room}.${opts.userId}${opts.isOwner ? '.owner' : ''}`;
  }
  // TODO : POST https://api.daily.co/v1/meeting-tokens (room_name, user_id, is_owner, exp).
  return `daily-token.${opts.room}.${opts.userId}`;
}
