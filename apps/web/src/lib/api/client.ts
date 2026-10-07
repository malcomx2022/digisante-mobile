// ─────────────────────────────────────────────────────────────
// Client API typé (fetch) — base NEXT_PUBLIC_API_URL, retry sur GET,
// mise en file IndexedDB des mutations effectuées hors-ligne.
// ─────────────────────────────────────────────────────────────
import { MUTATION_CLOCK_SKEW_MS, MUTATION_MAX_AGE_MS, isReplayableMutation, mutationKeyTime, type ApiError } from '@digisante/shared';

import { isVaultOpen, VaultLockedError } from '@/lib/offline/vault';
import { isOnline } from '@/lib/offline/online';
import { allFailed, allQueued, archiveFailed, enqueue, flush, getQueueOwner, hasReplayIdentity, PermanentReplayError, remove, type QueuedMutation } from '@/lib/offline/queue';

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
/** Indisponibilité réseau/serveur : ne prouve pas une révocation de session. */
export class RefreshUnavailableError extends Error {
  constructor() { super('Renouvellement de session temporairement indisponible'); this.name = 'RefreshUnavailableError'; }
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
      .catch((error) => {
        if (error instanceof ApiRequestError && [401, 403].includes(error.status)) return null;
        throw new RefreshUnavailableError();
      })
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
/** Hors-ligne pour une action qui ne doit PAS être différée (message affiché tel quel). */
export class OfflineError extends Error {
  constructor() {
    super('Connexion réseau requise pour cette action');
    this.name = 'OfflineError';
  }
}

/**
 * Actions JAMAIS mises en file, quel que soit l'appelant : argent (un transfert ou
 * un paiement rejoué des heures plus tard, sans retour à l'utilisateur, peut
 * partir deux fois), authentification (un OTP ou une déconnexion rejoués sous la
 * session suivante), administration et secrets d'intégration (écrits en clair
 * dans IndexedDB), fichiers du dossier médical, consentements et alertes SOS.
 */
export function isQueueable(path: string, method: string = 'POST'): boolean {
  return isReplayableMutation(method, path);
}

export async function mutate<T>(
  method: MutationMethod,
  path: string,
  body?: unknown,
  opts: { queue?: boolean } = {},
): Promise<T | { queued: true }> {
  const covered = isQueueable(path, method);
  if (!isOnline() && (opts.queue === false || !covered)) throw new OfflineError();
  if (covered && opts.queue !== false && !getQueueOwner()) throw new Error('Session requise pour cette mutation');
  if (covered && opts.queue !== false && !isOnline() && !isVaultOpen()) throw new VaultLockedError();
  const mutationOwner = getQueueOwner();
  // Photographie synchrone avant tout await : l'appelant ne peut plus modifier le corps.
  body = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
  if (covered && opts.queue !== false) {
    if ((await Promise.all([allQueued(), allFailed()])).flat().some((m) => m.onlineOnly)) throw new Error('Action précédente à vérifier avant une nouvelle saisie');
    if (mutationOwner !== getQueueOwner()) throw new VaultLockedError();
  }
  // Persister AVANT fetch : la fermeture d'onglet après commit serveur reste reprenable.
  const pending = covered && opts.queue !== false ? await enqueue({ method, path, body, onlineOnly: !isVaultOpen() }) : null;
  const key = pending?.idempotencyKey ?? (covered ? `v1.${Date.now()}.${crypto.randomUUID()}` : undefined);
  if (!isOnline()) return { queued: true };
  try {
    const res = await withAuthRetry(path, () => {
      if (pending && (pending.owner !== getQueueOwner() || (!pending.onlineOnly && !isVaultOpen()))) throw new VaultLockedError();
      return fetch(`${BASE}${PREFIX}${path}`, {
        method, headers: headers(key ? { 'Idempotency-Key': key } : undefined, body !== undefined),
        credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body),
      });
    });
    const result = await parse<T>(res);
    if (pending) await remove(pending.id);
    return result;
  } catch (error) {
    // 401/429/réseau/5xx restent en attente ; aucun nouveau UUID au prochain envoi.
    if (pending && error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) {
      await archiveFailed(pending, error.status);
    }
    throw error;
  }
}

/**
 * Rejoue la file des mutations en attente (à appeler au retour du réseau).
 * - 5xx / réseau → on relance (le `flush` s'arrête et réessaiera).
 * - 4xx → `PermanentReplayError` : la mutation est archivée (jamais perdue, point 2).
 * Premier envoi et rejeux portent le même `Idempotency-Key` persisté pour éviter
 * les doublons si le réseau coupe après envoi mais avant réception de la réponse.
 */
export async function flushQueue(): Promise<{ flushed: number; failed: number }> {
  return flush(async (m) => {
    if ((!m.onlineOnly && !isQueueable(m.path, m.method)) || !hasReplayIdentity(m)) throw new PermanentReplayError(409);
    const createdAt = mutationKeyTime(m.idempotencyKey!)!;
    if (m.onlineOnly) {
      const verifyPath = `/sync/receipts/${m.idempotencyKey}`;
      const receipt = await withAuthRetry(verifyPath, () => {
        if (m.owner !== getQueueOwner()) throw new Error('Session de mutation changée');
        return fetch(`${BASE}${PREFIX}${verifyPath}`, { headers: headers(), credentials: 'include' });
      });
      if (receipt.ok) {
        const confirmation = await receipt.json().catch(() => null);
        if (confirmation?.confirmed === true && confirmation.status >= 200 && confirmation.status < 300) return;
        throw new Error('Confirmation de reçu invalide');
      }
      if ([401, 408, 429].includes(receipt.status) || receipt.status >= 500) throw new Error('retry');
      // Sans corps on ne peut pas tenter l'effet : conserver l'identité pour revue.
      throw new PermanentReplayError(receipt.status);
    }
    const age = Date.now() - createdAt;
    if (age > MUTATION_MAX_AGE_MS) throw new PermanentReplayError(410);
    if (age < -MUTATION_CLOCK_SKEW_MS) throw new PermanentReplayError(400);
    const res = await withAuthRetry(m.path, () => {
      if (m.owner !== getQueueOwner() || !isVaultOpen()) throw new VaultLockedError();
      return fetch(`${BASE}${PREFIX}${m.path}`, {
        method: m.method,
        headers: headers({ 'Idempotency-Key': m.idempotencyKey! }, m.body !== undefined),
        credentials: 'include', body: m.body === undefined ? undefined : JSON.stringify(m.body),
      });
    });
    if (res.ok) return;
    // Authentification/rate-limit temporaires : arrêter, préserver l'ordre et la donnée.
    if (res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500) throw new Error('retry');
    // 4xx : rejet définitif. On NE perd PAS la donnée : journalisation + archivage.
    console.warn(
      `[offline] mutation rejetée au rejeu (${res.status}) — conservée pour vérification`,
    );
    throw new PermanentReplayError(res.status);
  });
}

export const post = <T>(path: string, body?: unknown) => mutate<T>('POST', path, body);
export const patch = <T>(path: string, body?: unknown) => mutate<T>('PATCH', path, body);
export const put = <T>(path: string, body?: unknown) => mutate<T>('PUT', path, body);
export const del = <T>(path: string) => mutate<T>('DELETE', path);

// Variantes « maintenant ou jamais » : jamais mises en file (OfflineError hors-ligne).
export const postNow = <T>(path: string, body?: unknown) => mutate<T>('POST', path, body, { queue: false }) as Promise<T>;
export const patchNow = <T>(path: string, body?: unknown) => mutate<T>('PATCH', path, body, { queue: false }) as Promise<T>;
export const putNow = <T>(path: string, body?: unknown) => mutate<T>('PUT', path, body, { queue: false }) as Promise<T>;
export const delNow = <T>(path: string) => mutate<T>('DELETE', path, undefined, { queue: false }) as Promise<T>;

export const api = { get, post, patch, put, del, postNow, patchNow, putNow, delNow };
