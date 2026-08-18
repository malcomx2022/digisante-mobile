// ─────────────────────────────────────────────────────────────
// Client API typé (fetch) — base NEXT_PUBLIC_API_URL, retry sur GET,
// mise en file IndexedDB des mutations effectuées hors-ligne.
// ─────────────────────────────────────────────────────────────
import type { ApiError } from '@digisante/shared';

import { isOnline } from '@/lib/offline/online';
import { enqueue, flush, PermanentReplayError, type QueuedMutation } from '@/lib/offline/queue';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
const PREFIX = '/api/v1';

/** Endpoints d'auth exclus de l'intercepteur de refresh (évite toute boucle). */
const AUTH_PATHS = ['/auth/login', '/auth/refresh', '/auth/register'];
const isAuthPath = (path: string) => AUTH_PATHS.some((p) => path.startsWith(p));

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(error.message);
    this.name = 'ApiRequestError';
  }
}

/** Jeton d'accès courant (injecté par la couche auth en P5.4). */
let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}
/** Lecture du jeton d'accès courant (ex. authentification du WebSocket temps réel). */
export function getAccessToken(): string | null {
  return accessToken;
}

// ── Intercepteur de refresh JWT (point 1) ─────────────────────────────────────
// La logique de refresh vit dans la couche auth (AuthProvider) ; on l'injecte ici
// pour éviter un cycle d'import client.ts ↔ auth. `refreshHandler` doit rafraîchir
// le jeton, appeler setAccessToken et renvoyer le nouveau access token (ou null si
// le refresh est impossible). `sessionExpiredHandler` purge la session côté auth.
type RefreshHandler = () => Promise<string | null>;
let refreshHandler: RefreshHandler | null = null;
let sessionExpiredHandler: (() => void) | null = null;

export function setRefreshHandler(fn: RefreshHandler | null): void {
  refreshHandler = fn;
}
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  sessionExpiredHandler = fn;
}

// Single-flight : un SEUL refresh en vol, partagé par toutes les requêtes 401.
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Force un refresh du jeton (single-flight partagé avec l'intercepteur 401).
 * Exposé pour le WebSocket chat : sur déconnexion, rafraîchir AVANT de reconnecter
 * évite une boucle de reconnexion sur jeton expiré (point 4). Renvoie le nouveau
 * token ou null si le refresh est impossible (pas de handler / refresh échoué).
 */
export function refreshAccessToken(): Promise<string | null> {
  return refreshOnce();
}

/** Lance (ou réutilise) le refresh en cours. Renvoie le nouveau token ou null. */
function refreshOnce(): Promise<string | null> {
  if (!refreshHandler) return Promise.resolve(null);
  if (!refreshInFlight) {
    refreshInFlight = refreshHandler()
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * En-têtes d'une requête. `json` n'est vrai QUE si un corps est réellement envoyé.
 *
 * ⚠️ Ne JAMAIS déclarer `content-type: application/json` sans corps : Fastify
 * rejette alors la requête en 400 (`FST_ERR_CTP_EMPTY_JSON_BODY`). C'est ce qui
 * cassait tous les POST sans corps de l'application — `/auth/refresh` et
 * `/auth/logout` (jeton dans le cookie), confirmation de RDV, soumission KYC,
 * prise en charge d'une analyse, publication d'un contenu… Symptôme visible :
 * l'utilisateur était déconnecté à chaque rechargement de page.
 */
function headers(extra?: HeadersInit, json = false): HeadersInit {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    ...extra,
  };
}

async function parse<T>(res: Response): Promise<T> {
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err: ApiError = data && typeof data === 'object' && 'code' in data ? data : { code: 'HTTP_ERROR', message: res.statusText };
    throw new ApiRequestError(res.status, err);
  }
  return data as T;
}

export interface GetOptions {
  /** Nombre de tentatives en cas d'échec réseau (défaut 1). */
  retries?: number;
  /** En-têtes additionnels pour CETTE requête (ex. x-share-token DMP). */
  headers?: Record<string, string>;
}

/**
 * Exécute une requête authentifiée et, sur 401 (hors endpoints d'auth), tente UN
 * refresh puis rejoue la requête UNE seule fois (single-flight, point 1).
 * `build` reçoit le jeton courant et construit l'objet Request à (re)jouer.
 */
async function withAuthRetry(path: string, build: () => Promise<Response>): Promise<Response> {
  let res = await build();
  if (res.status === 401 && !isAuthPath(path) && refreshHandler) {
    const newToken = await refreshOnce();
    if (newToken) {
      res = await build(); // rejeu unique avec le jeton rafraîchi
    } else {
      // Refresh impossible/échoué → session expirée : on purge côté auth.
      sessionExpiredHandler?.();
    }
  }
  return res;
}

/** GET typé avec un retry léger (réseau instable 2G/3G) et en-têtes par requête. */
export async function get<T>(path: string, opts: number | GetOptions = {}): Promise<T> {
  const { retries = 1, headers: extra } =
    typeof opts === 'number' ? { retries: opts, headers: undefined } : opts;
  try {
    const res = await withAuthRetry(path, () =>
      fetch(`${BASE}${PREFIX}${path}`, { headers: headers(extra), credentials: 'include' }),
    );
    return await parse<T>(res);
  } catch (err) {
    if (retries > 0 && !(err instanceof ApiRequestError)) {
      return get<T>(path, { retries: retries - 1, headers: extra });
    }
    throw err;
  }
}

/**
 * GET binaire authentifié (pièces KYC…) : renvoie un Blob. Jamais mis en file
 * hors-ligne ; les fichiers sont servis par endpoint authentifié uniquement (§4).
 */
export async function getBlob(path: string): Promise<Blob> {
  const res = await withAuthRetry(path, () =>
    fetch(`${BASE}${PREFIX}${path}`, { headers: headers(), credentials: 'include' }),
  );
  if (!res.ok) throw new ApiRequestError(res.status, { code: 'HTTP_ERROR', message: `HTTP ${res.status}` });
  return res.blob();
}

type MutationMethod = QueuedMutation['method'];

/**
 * Mutation typée. Hors-ligne → mise en file IndexedDB (rejouée plus tard) et
 * renvoie `{ queued: true }`. En ligne → exécution immédiate.
 */
export async function mutate<T>(
  method: MutationMethod,
  path: string,
  body?: unknown,
): Promise<T | { queued: true }> {
  if (!isOnline()) {
    await enqueue({ method, path, body });
    return { queued: true };
  }
  const res = await withAuthRetry(path, () =>
    fetch(`${BASE}${PREFIX}${path}`, {
      method,
      headers: headers(undefined, body !== undefined),
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return parse<T>(res);
}

/**
 * Rejoue la file des mutations en attente (à appeler au retour du réseau).
 * - 5xx / réseau → on relance (le `flush` s'arrête et réessaiera).
 * - 4xx → `PermanentReplayError` : la mutation est archivée (jamais perdue, point 2).
 * Chaque rejeu porte un en-tête `Idempotency-Key` = id de la mutation pour éviter
 * les doublons si le réseau coupe après envoi mais avant réception de la réponse.
 */
export async function flushQueue(): Promise<{ flushed: number; failed: number }> {
  return flush(async (m) => {
    const res = await withAuthRetry(m.path, () =>
      fetch(`${BASE}${PREFIX}${m.path}`, {
        method: m.method,
        headers: headers({ 'Idempotency-Key': m.id }, m.body !== undefined),
        credentials: 'include',
        body: m.body === undefined ? undefined : JSON.stringify(m.body),
      }),
    );
    if (res.ok) return; // succès → retirée de la file
    if (res.status >= 500) throw new Error('retry'); // serveur/réseau : on réessaiera
    // 4xx : rejet définitif. On NE perd PAS la donnée : journalisation + archivage.
    console.warn(
      `[offline] mutation rejetée au rejeu (${res.status}) : ${m.method} ${m.path} — conservée dans le magasin d'échecs`,
    );
    throw new PermanentReplayError(res.status);
  });
}

export const post = <T>(path: string, body?: unknown) => mutate<T>('POST', path, body);
export const patch = <T>(path: string, body?: unknown) => mutate<T>('PATCH', path, body);
export const put = <T>(path: string, body?: unknown) => mutate<T>('PUT', path, body);
export const del = <T>(path: string) => mutate<T>('DELETE', path);

export const api = { get, post, patch, put, del };
