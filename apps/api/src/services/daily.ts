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
  // Appel réel : POST https://api.daily.co/v1/rooms (privée). Si la salle existe
  // déjà (409) ou en cas d'erreur réseau, on retombe sur l'URL déterministe.
  const fallbackUrl = `https://${env.DAILY_DOMAIN}.daily.co/${opts.name}`;
  try {
    const res = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DAILY_API_KEY!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: opts.name, privacy: 'private' }),
    });
    if (res.ok) {
      const room = (await res.json()) as { name?: string; url?: string };
      return { name: room.name ?? opts.name, url: room.url ?? fallbackUrl };
    }
    if (res.status !== 409) {
      opts.log.error({ status: res.status }, '[Daily] création salle en échec');
    }
  } catch (err) {
    opts.log.error({ err }, '[Daily] erreur réseau création salle');
  }
  return { name: opts.name, url: fallbackUrl };
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
  // Appel réel : POST https://api.daily.co/v1/meeting-tokens. En cas d'échec
  // réseau on retombe sur un jeton déterministe pour ne pas bloquer l'appelant.
  try {
    const res = await fetch('https://api.daily.co/v1/meeting-tokens', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DAILY_API_KEY!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { room_name: opts.room, user_id: opts.userId, is_owner: opts.isOwner },
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { token?: string };
      if (data.token) return data.token;
    } else {
      opts.log.error({ status: res.status }, '[Daily] émission jeton en échec');
    }
  } catch (err) {
    opts.log.error({ err }, '[Daily] erreur réseau émission jeton');
  }
  return `daily-token.${opts.room}.${opts.userId}`;
}
