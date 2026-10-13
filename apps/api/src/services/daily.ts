// Daily : contrat privé, aucun accès inventé en cas d'échec fournisseur.
import type { FastifyInstance } from 'fastify';

import { badGateway, badRequest } from '@/lib/errors.js';
import { resolveConfiguredSecrets } from '@/lib/integrations.js';

export const ROOM_TTL_SECONDS = 4 * 60 * 60;
export const TOKEN_TTL_SECONDS = 15 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);

export function roomProperties(now: number) {
  return {
    exp: now + ROOM_TTL_SECONDS, eject_at_room_exp: true,
    enable_knocking: false, max_participants: 2, enforce_unique_user_ids: true,
    // `enable_recording` n'accepte qu'un mode (`cloud`, `local`…) : son ABSENCE
    // vaut « aucun enregistrement ». `false` sort du schéma Daily documenté.
    enable_chat: false, enable_screenshare: false,
    enable_transcription_storage: false,
    permissions: { canAdmin: false, canSend: ['audio', 'video'] },
  };
}

export function tokenProperties(opts: {
  room: string; userId: string; nowSeconds: number; roomExpiresAt: number; audioOnly?: boolean;
}) {
  const exp = Math.min(opts.nowSeconds + TOKEN_TTL_SECONDS, opts.roomExpiresAt);
  if (exp <= opts.nowSeconds) throw badRequest('La salle a expiré');
  return {
    room_name: opts.room, user_id: opts.userId, is_owner: false,
    exp, eject_at_token_exp: true, enable_screenshare: false,
    start_video_off: opts.audioOnly === true,
    permissions: { canAdmin: false, canSend: opts.audioOnly ? ['audio'] : ['audio', 'video'] },
  };
}

export interface DailyRoom { name: string; url: string | null; expiresAt: number }
interface DailyCreds { apiKey: string; domain: string }
async function resolveCreds(app: FastifyInstance): Promise<DailyCreds | null> {
  const secrets = await resolveConfiguredSecrets(app, 'DAILY');
  if (!secrets) return null;
  // L'admin historique accepte le sous-domaine ou le nom complet.
  const domain = secrets.domain!.replace(/\.daily\.co$/i, '').toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(domain)) throw badGateway('Configuration Daily invalide');
  return { apiKey: secrets.apiKey!, domain };
}

async function request(app: FastifyInstance, creds: DailyCreds, path: string, method = 'GET', body?: unknown) {
  try {
    return await fetch(`https://api.daily.co/v1/${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    // Ni exception brute, ni réponse fournisseur : peuvent contenir un secret.
    app.log.error({ operation: method }, '[Daily] service indisponible');
    throw badGateway('Téléconsultation indisponible, réessayez ou utilisez le chat');
  }
}

/** Tout mode d'enregistrement déclaré (chaîne ou liste) rend la salle non conforme. */
const recordingDisabled = (value: unknown) => value === undefined || value === null || value === false;

/** Contrôle aussi les salles historiques : jamais de confiance dans l'URL en DB. */
async function inspectRoom(app: FastifyInstance, creds: DailyCreds, name: string): Promise<DailyRoom> {
  const res = await request(app, creds, `rooms/${encodeURIComponent(name)}`);
  if (!res.ok) throw badGateway('Salle Daily indisponible');
  let data: { name?: string; url?: string; privacy?: string; config?: Record<string, unknown> };
  try { data = await res.json() as typeof data; } catch { throw badGateway('Réponse Daily invalide'); }
  const p = data.config;
  const url = `https://${creds.domain}.daily.co/${encodeURIComponent(name)}`;
  if (data.name !== name || data.url !== url || data.privacy !== 'private' ||
      p?.enable_knocking !== false || p.eject_at_room_exp !== true ||
      p.max_participants !== 2 || p.enforce_unique_user_ids !== true || p.enable_chat !== false || p.enable_screenshare !== false ||
      !recordingDisabled(p.enable_recording) || typeof p.exp !== 'number' || !Number.isSafeInteger(p.exp)) {
    throw badGateway('Salle Daily non conforme à la confidentialité requise');
  }
  if (p.exp <= nowSeconds()) throw badRequest('La salle a expiré');
  return { name, url, expiresAt: p.exp };
}

/** Sans configuration : absence explicite de média, jamais d'iframe stub externe. */
export async function createRoom(opts: { app: FastifyInstance; name: string }): Promise<DailyRoom> {
  const creds = await resolveCreds(opts.app);
  if (!creds) return { name: opts.name, url: null, expiresAt: nowSeconds() + ROOM_TTL_SECONDS };
  const res = await request(opts.app, creds, 'rooms', 'POST', {
    name: opts.name, privacy: 'private', properties: roomProperties(nowSeconds()),
  });
  if (!res.ok && res.status !== 409) throw badGateway('Création de salle Daily impossible');
  return inspectRoom(opts.app, creds, opts.name);
}

/** Jeton nominatif à privilèges minimaux, borné par la salle ET le début en DB. */
export async function createMeetingToken(opts: {
  app: FastifyInstance; room: string; userId: string; roomExpiresAt: number; audioOnly?: boolean;
}): Promise<{ token: string; roomUrl: string; expiresAt: number } | null> {
  const creds = await resolveCreds(opts.app);
  if (!creds) return null;
  const room = await inspectRoom(opts.app, creds, opts.room);
  const properties = tokenProperties({ ...opts, nowSeconds: nowSeconds(), roomExpiresAt: Math.min(room.expiresAt, opts.roomExpiresAt) });
  const res = await request(opts.app, creds, 'meeting-tokens', 'POST', { properties });
  if (!res.ok) throw badGateway('Émission du jeton Daily impossible');
  let data: { token?: unknown };
  try { data = await res.json() as typeof data; } catch { throw badGateway('Réponse Daily invalide'); }
  if (typeof data.token !== 'string' || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(data.token)) throw badGateway('Jeton Daily invalide');
  return { token: data.token, roomUrl: room.url!, expiresAt: properties.exp };
}

/** DELETE ne prouve pas l'éjection des participants déjà connectés. */
export async function ejectParticipants(opts: { app: FastifyInstance; name: string; userIds: string[] }): Promise<boolean> {
  try {
    const creds = await resolveCreds(opts.app);
    if (!creds) return true;
    const res = await request(opts.app, creds, `rooms/${encodeURIComponent(opts.name)}/eject`, 'POST', { user_ids: opts.userIds, ban: true });
    return res.ok || res.status === 404;
  } catch { return false; }
}

/** Best effort : l'échéance et l'éjection du jeton restent les filets indépendants. */
export async function deleteRoom(opts: { app: FastifyInstance; name: string }): Promise<boolean> {
  try {
    const creds = await resolveCreds(opts.app);
    if (!creds) return true;
    const res = await request(opts.app, creds, `rooms/${encodeURIComponent(opts.name)}`, 'DELETE');
    return res.ok || res.status === 404;
  } catch { return false; }
}
