// ─────────────────────────────────────────────────────────────
// Firebase Cloud Messaging (FCM) — notifications push, API HTTP v1.
// Sans dépendance externe : JWT du compte de service signé via node:crypto,
// jeton OAuth2 mis en cache, envoi via fetch. STUB si Firebase non configuré.
// Config résolue DYNAMIQUEMENT via le resolver d'intégrations (base → `.env`, §3.6).
// ─────────────────────────────────────────────────────────────
import { createSign } from 'node:crypto';

import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import { resolveConfiguredSecrets } from '@/lib/integrations.js';
import { stubContent } from '@/lib/redact.js';

const OAUTH_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const fcmEndpoint = (projectId: string) =>
  `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

/** Les clés privées en variable d'env contiennent souvent des "\n" littéraux. */
export function normalizePrivateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

export interface FcmMessage {
  message: {
    token: string;
    notification: { title: string; body: string };
    android: { priority: 'high' };
    data?: Record<string, string>;
  };
}

/** Construit le corps d'un message FCM HTTP v1 (fonction pure, testable). */
export function buildFcmMessage(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): FcmMessage {
  return {
    message: {
      token,
      notification: { title, body },
      android: { priority: 'high' },
      ...(data ? { data } : {}),
    },
  };
}

/**
 * Un token invalide / non enregistré (appareil désinstallé, token périmé) doit
 * être purgé côté serveur. Décision PURE à partir du statut HTTP / code FCM.
 */
export function classifyFcmError(status: number, fcmStatus?: string): { invalidToken: boolean } {
  if (status === 404) return { invalidToken: true }; // UNREGISTERED
  if (status === 403 && fcmStatus === 'SENDER_ID_MISMATCH') return { invalidToken: true };
  if (status === 400 && fcmStatus === 'INVALID_ARGUMENT') return { invalidToken: true };
  return { invalidToken: false };
}

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

// Jeton OAuth2 mis en cache (module) : ~1 h, réutilisé entre les envois. Clé de
// cache = clientEmail → une rotation vers un AUTRE compte de service invalide le
// jeton précédent (on ne réutilise pas un token émis pour une autre identité).
let cachedToken: { key: string; value: string; expiresAt: number } | null = null;

/** Obtient un access token OAuth2 pour FCM (JWT service-account signé RS256). */
async function getAccessToken(clientEmail: string, privateKey: string, log: FastifyBaseLogger): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && cachedToken.key === clientEmail && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({ iss: clientEmail, scope: FCM_SCOPE, aud: OAUTH_TOKEN_URI, iat, exp: iat + 3600 }),
  );
  const signingInput = `${header}.${claims}`;

  let assertion: string;
  try {
    const signature = createSign('RSA-SHA256').update(signingInput).sign(normalizePrivateKey(privateKey), 'base64url');
    assertion = `${signingInput}.${signature}`;
  } catch (err) {
    log.error({ err }, '[FCM] signature JWT impossible (clé privée invalide ?)');
    return null;
  }

  try {
    const res = await fetch(OAUTH_TOKEN_URI, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) {
      log.error({ status: res.status }, '[FCM] échec d’obtention du jeton OAuth2');
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    cachedToken = { key: clientEmail, value: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
    return cachedToken.value;
  } catch (err) {
    log.error({ err }, '[FCM] erreur réseau OAuth2');
    return null;
  }
}

/**
 * Envoie une notification push à un token d'appareil (FCM HTTP v1).
 * Ne lève jamais (le dispatch ne doit pas casser). `invalidToken` signale au
 * caller de purger le token côté utilisateur.
 */
export async function sendPush(opts: {
  app: FastifyInstance;
  token: string | null;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<{ delivered: boolean; stub: boolean; invalidToken?: boolean; messageId?: string }> {
  const log = opts.app.log;
  if (!opts.token) {
    log.warn('[FCM] aucun token d’appareil — push ignoré');
    return { delivered: false, stub: true };
  }
  const secrets = await resolveConfiguredSecrets(opts.app, 'FIREBASE');
  if (!secrets) {
    log.warn({ title: stubContent(opts.title) }, `[STUB FCM] push: ${stubContent(opts.body)}`);
    return { delivered: false, stub: true };
  }

  const projectId = secrets.projectId!;
  const accessToken = await getAccessToken(secrets.clientEmail!, secrets.privateKey!, log);
  if (!accessToken) return { delivered: false, stub: false };

  try {
    const res = await fetch(fcmEndpoint(projectId), {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildFcmMessage(opts.token, opts.title, opts.body, opts.data)),
    });
    if (res.ok) {
      const ok = (await res.json().catch(() => ({}))) as { name?: string };
      return { delivered: true, stub: false, messageId: ok.name?.split('/').pop() };
    }

    const json = (await res.json().catch(() => ({}))) as { error?: { status?: string } };
    const { invalidToken } = classifyFcmError(res.status, json.error?.status);
    log.warn({ status: res.status, fcm: json.error?.status }, '[FCM] envoi non abouti');
    return { delivered: false, stub: false, invalidToken };
  } catch (err) {
    log.error({ err }, '[FCM] erreur réseau lors de l’envoi push');
    return { delivered: false, stub: false };
  }
}
