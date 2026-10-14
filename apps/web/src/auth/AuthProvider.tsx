'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { flushQueue, invalidateSessionRequests, refreshAccessToken, RefreshUnavailableError, setAccessToken, setRefreshHandler, setSessionExpiredHandler, withAuthCookieLock } from '@/lib/api/client';
import { authApi, type AuthUser, type OtpInfo, type RegisterBody } from '@/lib/api/auth';
import { isOnline } from '@/lib/offline/online';
import { installLocalGuards, lockVault } from '@/lib/offline/vault';
import { getQueueOwner, purgeAll, setQueueOwner } from '@/lib/offline/queue';
import { registerPushDevice } from './push';
import { sessionCache } from './storage';

type Status = 'loading' | 'authed' | 'anon';

interface AuthContextValue {
  cleanupFailed: boolean;
  status: Status;
  user: AuthUser | null;
  register: (b: RegisterBody) => Promise<OtpInfo>;
  requestOtp: (phone: string, channel?: 'SMS' | 'VOICE') => Promise<OtpInfo>;
  verifyOtp: (phone: string, code: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  useEffect(() => { try { setCleanupFailed(sessionStorage.getItem('digisante.cleanupFailed') === '1'); } catch { /* état mémoire disponible */ } }, []);
  const sessionEpoch = useRef(0);
  const sessionOwner = useRef<string | null>(null);
  const cleanupInFlight = useRef<Promise<void> | null>(null);
  const loginInFlight = useRef<number | null>(null);
  useEffect(() => installLocalGuards(), []);

  // Purge complète de la session (utilisée par logout ET par l'expiration de session).
  const clearSession = useCallback(() => {
    const owner = sessionOwner.current;
    sessionOwner.current = null;
    sessionEpoch.current += 1;
    invalidateSessionRequests();
    setQueueOwner(null);
    setAccessToken(null);
    setUser(null);
    setStatus('anon');
    try { if (owner && sessionCache.get()?.id === owner) sessionCache.clear(); } catch { setCleanupFailed(true); }
  }, []);

  // ── Intercepteur de refresh (point 1) : branché sur le client API ───────────
  // Le client appelle ce handler sur un 401 en cours de session. On rejoue le
  // refresh à partir du refresh token stocké, on persiste le nouveau couple, et on
  // renvoie le nouvel access token (ou null → session expirée, le client purgera).
  useEffect(() => {
    setRefreshHandler(async () => {
      const epoch = sessionEpoch.current;
      const cachedId = sessionCache.get()?.id;
      if (sessionOwner.current && sessionOwner.current !== cachedId) {
        clearSession();
        return null;
      }
      return withAuthCookieLock(async () => {
        if (epoch !== sessionEpoch.current || cachedId !== sessionCache.get()?.id) return null;
        // Le refresh est lu dans le cookie HttpOnly côté serveur (aucun jeton en JS).
        const { accessToken, user } = await authApi.refresh();
        if (epoch !== sessionEpoch.current) return null;
        if (cachedId && cachedId !== user.id) {
          // Le cookie partagé peut désormais désigner un autre compte : accepter
          // sa session sans rejouer les requêtes construites pour le profil ancien.
          sessionEpoch.current += 1;
          invalidateSessionRequests();
        }
        setAccessToken(accessToken);
        sessionCache.set(user);
        sessionOwner.current = user.id;
        setQueueOwner(user.id);
        setUser(user);
        return accessToken;
      });
    });
    setSessionExpiredHandler(() => clearSession());
    return () => {
      sessionEpoch.current += 1;
      invalidateSessionRequests();
      setRefreshHandler(null);
      setSessionExpiredHandler(null);
    };
  }, [clearSession]);

  // Reprise de session au démarrage. Le jeton d'accès vit en mémoire ; le refresh
  // est un cookie HttpOnly (C6). On reprend en UN appel via /auth/refresh (qui
  // renvoie { accessToken, user }). Hors-ligne : reprise OPTIMISTE depuis le cache
  // (offline-first §3) — le jeton d'accès sera ré-obtenu au retour du réseau.
  useEffect(() => {
    let active = true;
    const epoch = sessionEpoch.current;
    (async () => {
      const cached = sessionCache.get();
      if (!cached) {
        setQueueOwner(null);
        if (active) setStatus('anon');
        return;
      }
      sessionOwner.current = cached.id;
      // Optimiste : afficher l'app immédiatement avec le profil en cache.
      if (active) {
        setQueueOwner(isOnline() ? null : cached.id);
        setUser(cached);
        setStatus('authed');
      }
      if (!isOnline()) return; // hors-ligne : jeton ré-obtenu au 1er appel en ligne
      try {
        const token = await refreshAccessToken();
        if (!token) throw new Error('Session expirée');
        if (active && epoch === sessionEpoch.current) void flushQueue();
        // Reprise : propage une éventuelle ROTATION du token FCM, sans jamais
        // redemander la permission à l'ouverture de l'app.
        void registerPushDevice({ prompt: false });
      } catch (error) {
        // Un ancien refresh ne doit pas effacer une nouvelle connexion.
        if (active && epoch === sessionEpoch.current) {
          if (error instanceof RefreshUnavailableError && sessionCache.get()?.id === cached.id) {
            // navigator.onLine est indicatif : garder uniquement la lecture locale,
            // sans jeton réseau ni reprise, jusqu'à une authentification réussie.
            setAccessToken(null); setQueueOwner(cached.id);
          } else clearSession();
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [clearSession]);

  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if (e.key !== 'digisante.session') return;
      lockVault();
      // Une connexion explicite attend éventuellement la fin du logout/refresh
      // de l'autre onglet sous le verrou cookie. Sa publication vient ensuite.
      if (loginInFlight.current === sessionEpoch.current) return;
      // Ne pas effacer la nouvelle session de l'autre onglet.
      const next = sessionCache.get();
      if (!next || next.id !== getQueueOwner()) {
        sessionOwner.current = null;
        invalidateSessionRequests();
        sessionEpoch.current += 1; setAccessToken(null); setQueueOwner(null); setUser(null); setStatus('anon');
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [clearSession]);

  const register = useCallback<AuthContextValue['register']>((b) => authApi.register(b).then((r) => r.otp), []);
  const requestOtp = useCallback<AuthContextValue['requestOtp']>((phone, channel) => authApi.requestOtp({ phone, channel }), []);

  const verifyOtp = useCallback<AuthContextValue['verifyOtp']>(async (phone, code) => {
    const epoch = ++sessionEpoch.current;
    invalidateSessionRequests();
    loginInFlight.current = epoch;
    try {
      return await withAuthCookieLock(async () => {
        if (epoch !== sessionEpoch.current) throw new Error('Session changée');
        // Une purge déjà commencée termine avant toute publication de la session B.
        try { await cleanupInFlight.current; }
        catch {
          if (epoch === sessionEpoch.current) {
            setCleanupFailed(true);
            try { sessionStorage.setItem('digisante.cleanupFailed', '1'); } catch { /* avertissement mémoire */ }
            clearSession();
          }
          throw new Error('Purge locale échouée');
        }
        if (epoch !== sessionEpoch.current) throw new Error('Session changée');
        const res = await authApi.verifyOtp({ phone, code });
        if (epoch !== sessionEpoch.current) throw new Error('Session changée');
        setAccessToken(res.accessToken); // le refresh est posé en cookie HttpOnly par le serveur
        sessionCache.set(res.user);
        sessionOwner.current = res.user.id;
        setQueueOwner(res.user.id);
        setUser(res.user);
        void flushQueue();
        setStatus('authed');
        // Enregistrement du token push après connexion (best-effort, non bloquant).
        void registerPushDevice({ prompt: true });
        return res.user;
      });
    } finally { if (loginInFlight.current === epoch) loginInFlight.current = null; }
  }, [clearSession]);

  const logout = useCallback<AuthContextValue['logout']>(async () => {
    const epoch = ++sessionEpoch.current;
    const logoutOwner = sessionOwner.current;
    invalidateSessionRequests();
    setQueueOwner(null); // bloque le rejeu dès le début de la déconnexion
    return withAuthCookieLock(async () => {
      if (epoch !== sessionEpoch.current) return;
      if (sessionCache.get()?.id !== logoutOwner) { clearSession(); return; }
      // 1) Révocation serveur (le refresh est lu dans le cookie) — best-effort.
      try {
        await authApi.logout();
      } catch {
        /* hors-ligne ou token déjà révoqué : on purge quand même localement */
      }
      if (epoch !== sessionEpoch.current || sessionCache.get()?.id !== logoutOwner) return;
      // 2) Purge de la file hors-ligne : ses corps (constantes, messages…) ne doivent
      //    pas rester en clair sur un appareil partagé après une déconnexion (§4).
      const cleanup = purgeAll();
      cleanupInFlight.current = cleanup;
      try { await cleanup; }
      catch {
        if (epoch !== sessionEpoch.current || sessionCache.get()?.id !== logoutOwner) return;
        setCleanupFailed(true);
        try { sessionStorage.setItem('digisante.cleanupFailed', '1'); } catch { /* avertissement mémoire */ }
        clearSession(); throw new Error('Purge locale échouée');
      } finally { if (cleanupInFlight.current === cleanup) cleanupInFlight.current = null; }
      if (epoch !== sessionEpoch.current || sessionCache.get()?.id !== logoutOwner) return;
      setCleanupFailed(false);
      try { sessionStorage.removeItem('digisante.cleanupFailed'); } catch { /* purge déjà confirmée */ }
      // 3) Purge locale + redirection (assurée par la garde Protected → /onboarding).
      clearSession();
    });
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ cleanupFailed, status, user, register, requestOtp, verifyOtp, logout }),
    [cleanupFailed, status, user, register, requestOtp, verifyOtp, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un <AuthProvider>');
  return ctx;
}
