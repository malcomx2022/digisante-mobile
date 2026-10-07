// Intercepteur de refresh JWT — chemin de sécurité. Les invariants testés ici
// (un seul refresh en vol, un seul rejeu, pas de boucle sur /auth/*) sont ce qui
// sépare une reprise de session propre d'une tempête de requêtes sur un token mort.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiRequestError,
  RefreshUnavailableError,
  get,
  post,
  setAccessToken,
  setRefreshHandler,
  setSessionExpiredHandler,
} from './client';

/** Réponse fetch minimale (le client ne lit que status/ok/json). */
function res(status: number, body: unknown = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: `HTTP ${status}`,
    json: async () => body,
  } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  // `isOnline()` lit navigator.onLine : sans ça les mutations partiraient en file
  // hors-ligne au lieu du réseau, et ces tests ne testeraient rien.
  vi.stubGlobal('navigator', { onLine: true });
  fetchMock.mockReset();
  setAccessToken('jeton-initial');
  setRefreshHandler(null);
  setSessionExpiredHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client API — intercepteur de refresh', () => {
  it('refresh en panne réseau : ne déclare pas une révocation et ne rejoue pas', async () => {
    fetchMock.mockResolvedValue(res(401)); const expired = vi.fn(); setSessionExpiredHandler(expired);
    setRefreshHandler(async () => { throw new TypeError('offline'); });
    await expect(get('/users/me', { retries: 0 })).rejects.toBeInstanceOf(RefreshUnavailableError);
    expect(expired).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('refresh refusé 401 : ferme la session, sans lecture réseau optimiste', async () => {
    fetchMock.mockResolvedValue(res(401)); const expired = vi.fn(); setSessionExpiredHandler(expired);
    setRefreshHandler(async () => { throw new ApiRequestError(401, { code: 'UNAUTHORIZED', message: 'revoked' }); });
    await expect(get('/users/me', { retries: 0 })).rejects.toBeInstanceOf(ApiRequestError);
    expect(expired).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('rejoue UNE fois après un refresh réussi', async () => {
    fetchMock.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200, { ok: true }));
    const refresh = vi.fn(async () => {
      setAccessToken('jeton-neuf');
      return 'jeton-neuf';
    });
    setRefreshHandler(refresh);

    await expect(get('/users/me')).resolves.toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('porte le jeton rafraîchi dans la requête rejouée', async () => {
    fetchMock.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200, {}));
    setRefreshHandler(async () => {
      setAccessToken('jeton-neuf');
      return 'jeton-neuf';
    });

    await get('/users/me');
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');

    const replayHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    expect(replayHeaders.authorization).toBe('Bearer jeton-neuf');
  });

  // ── Single-flight : N requêtes qui prennent 401 ensemble ne font QU'UN refresh ──
  it('ne lance qu’UN SEUL refresh pour plusieurs 401 concurrents', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      return h.authorization === 'Bearer jeton-neuf' ? res(200, { ok: true }) : res(401);
    });

    let resolveRefresh: (t: string) => void = () => {};
    const gate = new Promise<string>((r) => {
      resolveRefresh = r;
    });
    const refresh = vi.fn(async () => {
      const t = await gate;
      setAccessToken(t);
      return t;
    });
    setRefreshHandler(refresh);

    const inflight = Promise.all([get('/a'), get('/b'), get('/c')]);
    // Laisse les trois requêtes prendre leur 401 avant de débloquer le refresh.
    await new Promise((r) => setTimeout(r, 10));
    resolveRefresh('jeton-neuf');

    await expect(inflight).resolves.toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refresh).toHaveBeenCalledTimes(1); // pas trois refresh parallèles
  });

  it('signale la session expirée et ne rejoue PAS si le refresh échoue', async () => {
    fetchMock.mockResolvedValue(res(401));
    const refresh = vi.fn(async () => null); // refresh impossible
    const expired = vi.fn();
    setRefreshHandler(refresh);
    setSessionExpiredHandler(expired);

    await expect(get('/users/me', { retries: 0 })).rejects.toThrow();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // aucun rejeu
  });

  it('ne rejoue jamais un 401 une seconde fois (pas de boucle)', async () => {
    // Le refresh « réussit » mais le serveur renvoie encore 401 : on s'arrête là.
    fetchMock.mockResolvedValue(res(401));
    const refresh = vi.fn(async () => 'jeton-neuf');
    setRefreshHandler(refresh);

    await expect(get('/users/me', { retries: 0 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2); // requête + UN rejeu, puis stop
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // ── Les routes d'auth sont exclues, sinon /auth/refresh se rafraîchirait lui-même ──
  it('n’intercepte PAS les routes d’authentification', async () => {
    fetchMock.mockResolvedValue(res(401));
    const refresh = vi.fn(async () => 'jeton-neuf');
    setRefreshHandler(refresh);

    await expect(post('/auth/refresh')).rejects.toThrow();
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// Régression : le client déclarait toujours `content-type: application/json`,
// y compris sans corps. Fastify rejette alors en 400 (FST_ERR_CTP_EMPTY_JSON_BODY),
// ce qui cassait TOUS les POST sans corps — /auth/refresh en tête, donc une
// déconnexion à chaque rechargement de page. Trouvé par les e2e.
describe('client API — content-type', () => {
  it('n’annonce PAS un corps JSON quand il n’y en a pas', async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    await post('/auth/logout');

    const sent = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(sent['content-type']).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it('annonce le JSON dès qu’un corps est envoyé', async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    await post('/dmp/records', { type: 'VITAL_SIGNS' });

    const sent = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(sent['content-type']).toBe('application/json');
  });

  it('n’annonce pas de corps JSON sur un GET', async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    await get('/users/me');

    const sent = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(sent['content-type']).toBeUndefined();
  });
});

describe('client API — résilience réseau', () => {
  it('réessaie un GET après une coupure réseau (2G instable)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(res(200, { ok: true }));

    await expect(get('/education')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ne réessaie PAS sur une erreur applicative (un 404 reste un 404)', async () => {
    fetchMock.mockResolvedValue(res(404, { code: 'NOT_FOUND', message: 'absent' }));

    await expect(get('/education/inconnu')).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('envoie les identifiants de session (cookie de refresh HttpOnly)', async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    await get('/users/me');
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
  });
});
