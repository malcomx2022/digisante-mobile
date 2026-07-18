// ─────────────────────────────────────────────────────────────
// Service Daily.co — salles de téléconsultation WebRTC + jetons de réunion.
// Config résolue DYNAMIQUEMENT via le resolver d'intégrations (base → `.env`, §3.6) :
// STUB tant que apiKey/domain ne sont pas configurés.
// Piège (CLAUDE.md §8) : prévoir la bascule auto téléconsultation → chat (D-10)
// quand la bande passante chute — gérée côté contrat via le mode de consultation.
// ─────────────────────────────────────────────────────────────
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import { resolveConfiguredSecrets } from '@/lib/integrations.js';

export interface DailyRoom {
  name: string;
  url: string;
}

interface DailyCreds {
  apiKey: string;
  domain: string;
}

/** Résout apiKey/domain Daily (base → `.env`) ou null si config incomplète. */
async function resolveCreds(app: FastifyInstance): Promise<DailyCreds | null> {
  const secrets = await resolveConfiguredSecrets(app, 'DAILY');
  if (!secrets) return null;
  return { apiKey: secrets.apiKey!, domain: secrets.domain! };
}

/** Crée (ou réutilise) une salle de téléconsultation. */
export async function createRoom(opts: { app: FastifyInstance; name: string }): Promise<DailyRoom> {
  const log: FastifyBaseLogger = opts.app.log;
  const creds = await resolveCreds(opts.app);
  if (!creds) {
    log.warn({ room: opts.name }, '[STUB Daily] salle simulée (Daily.co non configuré)');
    return { name: opts.name, url: `https://stub.daily.co/${opts.name}` };
  }
  // Appel réel : POST https://api.daily.co/v1/rooms (privée). Si la salle existe
  // déjà (409) ou en cas d'erreur réseau, on retombe sur l'URL déterministe.
  const fallbackUrl = `https://${creds.domain}.daily.co/${opts.name}`;
  try {
    const res = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: opts.name, privacy: 'private' }),
    });
    if (res.ok) {
      const room = (await res.json()) as { name?: string; url?: string };
      return { name: room.name ?? opts.name, url: room.url ?? fallbackUrl };
    }
    if (res.status !== 409) {
      log.error({ status: res.status }, '[Daily] création salle en échec');
    }
  } catch (err) {
    log.error({ err }, '[Daily] erreur réseau création salle');
  }
  return { name: opts.name, url: fallbackUrl };
}

/** Émet un jeton de réunion pour un participant donné. */
export async function createMeetingToken(opts: {
  app: FastifyInstance;
  room: string;
  userId: string;
  isOwner: boolean;
}): Promise<string> {
  const log: FastifyBaseLogger = opts.app.log;
  const creds = await resolveCreds(opts.app);
  if (!creds) {
    return `stub-token.${opts.room}.${opts.userId}${opts.isOwner ? '.owner' : ''}`;
  }
  // Appel réel : POST https://api.daily.co/v1/meeting-tokens. En cas d'échec
  // réseau on retombe sur un jeton déterministe pour ne pas bloquer l'appelant.
  try {
    const res = await fetch('https://api.daily.co/v1/meeting-tokens', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
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
      log.error({ status: res.status }, '[Daily] émission jeton en échec');
    }
  } catch (err) {
    log.error({ err }, '[Daily] erreur réseau émission jeton');
  }
  return `daily-token.${opts.room}.${opts.userId}`;
}
