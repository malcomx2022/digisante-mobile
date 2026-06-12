// ─────────────────────────────────────────────────────────────
// Client API typé (fetch) — base NEXT_PUBLIC_API_URL, retry sur GET,
// mise en file IndexedDB des mutations effectuées hors-ligne.
// ─────────────────────────────────────────────────────────────
import type { ApiError } from '@digisante/shared';

import { isOnline } from '@/lib/offline/online';
import { enqueue, flush, type QueuedMutation } from '@/lib/offline/queue';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
const PREFIX = '/api/v1';

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

function headers(extra?: HeadersInit): HeadersInit {
  return {
    'content-type': 'application/json',
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

/** GET typé avec un retry léger (réseau instable 2G/3G). */
export async function get<T>(path: string, retries = 1): Promise<T> {
  try {
    const res = await fetch(`${BASE}${PREFIX}${path}`, { headers: headers(), credentials: 'include' });
    return await parse<T>(res);
  } catch (err) {
    if (retries > 0 && !(err instanceof ApiRequestError)) {
      return get<T>(path, retries - 1);
    }
    throw err;
  }
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
  const res = await fetch(`${BASE}${PREFIX}${path}`, {
    method,
    headers: headers(),
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parse<T>(res);
}

/** Rejoue la file des mutations en attente (à appeler au retour du réseau). */
export async function flushQueue(): Promise<{ flushed: number }> {
  return flush(async (m) => {
    const res = await fetch(`${BASE}${PREFIX}${m.path}`, {
      method: m.method,
      headers: headers(),
      credentials: 'include',
      body: m.body === undefined ? undefined : JSON.stringify(m.body),
    });
    if (!res.ok && res.status >= 500) throw new Error('retry'); // réessaie sur erreur serveur/réseau
  });
}

export const api = {
  get,
  post: <T>(path: string, body?: unknown) => mutate<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => mutate<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => mutate<T>('PUT', path, body),
  del: <T>(path: string) => mutate<T>('DELETE', path),
};
