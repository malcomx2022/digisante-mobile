'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { setAccessToken, setRefreshHandler, setSessionExpiredHandler } from '@/lib/api/client';
import { authApi, type AuthUser, type OtpInfo, type RegisterBody } from '@/lib/api/auth';
import { isOnline } from '@/lib/offline/online';
import { registerPushDevice } from './push';
import { sessionCache } from './storage';

type Status = 'loading' | 'authed' | 'anon';

interface AuthContextValue {
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

  // Reprise de session au démarrage. Le jeton d'accès vit en mémoire ; le refresh
  // est un cookie HttpOnly (C6). On reprend en UN appel via /auth/refresh (qui
  // renvoie { accessToken, user }). Hors-ligne : reprise OPTIMISTE depuis le cache
  // (offline-first §3) — le jeton d'accès sera ré-obtenu au retour du réseau.
  useEffect(() => {
    let active = true;
    (async () => {
      const cached = sessionCache.get();
      if (!cached) {
        if (active) setStatus('anon');
        return;
      }
      // Optimiste : afficher l'app immédiatement avec le profil en cache.
      if (active) {
        setUser(cached);
        setStatus('authed');
      }
      if (!isOnline()) return; // hors-ligne : jeton ré-obtenu au 1er appel en ligne
      try {
        const { accessToken, user } = await authApi.refresh();
        setAccessToken(accessToken);
        sessionCache.set(user);
        if (active) setUser(user);
      } catch {
        // En ligne mais refresh refusé (session expirée/révoquée) → purge.
        sessionCache.clear();
        setAccessToken(null);
        if (active) {
          setUser(null);
          setStatus('anon');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Purge complète de la session (utilisée par logout ET par l'expiration de session).
  const clearSession = useCallback(() => {
    sessionCache.clear();
    setAccessToken(null);
    setUser(null);
    setStatus('anon');
  }, []);

  // ── Intercepteur de refresh (point 1) : branché sur le client API ───────────
  // Le client appelle ce handler sur un 401 en cours de session. On rejoue le
  // refresh à partir du refresh token stocké, on persiste le nouveau couple, et on
  // renvoie le nouvel access token (ou null → session expirée, le client purgera).
  useEffect(() => {
    setRefreshHandler(async () => {
      // Le refresh est lu dans le cookie HttpOnly côté serveur (aucun jeton en JS).
      const { accessToken, user } = await authApi.refresh();
      setAccessToken(accessToken);
      sessionCache.set(user);
      return accessToken;
    });
    setSessionExpiredHandler(() => clearSession());
    return () => {
      setRefreshHandler(null);
      setSessionExpiredHandler(null);
    };
  }, [clearSession]);

  const register = useCallback<AuthContextValue['register']>((b) => authApi.register(b).then((r) => r.otp), []);
  const requestOtp = useCallback<AuthContextValue['requestOtp']>((phone, channel) => authApi.requestOtp({ phone, channel }), []);

  const verifyOtp = useCallback<AuthContextValue['verifyOtp']>(async (phone, code) => {
    const res = await authApi.verifyOtp({ phone, code });
    setAccessToken(res.accessToken); // le refresh est posé en cookie HttpOnly par le serveur
    sessionCache.set(res.user);
    setUser(res.user);
    setStatus('authed');
    // Enregistrement du token push après connexion (best-effort, non bloquant).
    void registerPushDevice();
    return res.user;
  }, []);

  const logout = useCallback<AuthContextValue['logout']>(async () => {
    // 1) Révocation serveur (le refresh est lu dans le cookie) — best-effort.
    try {
      await authApi.logout();
    } catch {
      /* hors-ligne ou token déjà révoqué : on purge quand même localement */
    }
    // 2) Purge locale + redirection (assurée par la garde Protected → /onboarding).
    clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, register, requestOtp, verifyOtp, logout }),
    [status, user, register, requestOtp, verifyOtp, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un <AuthProvider>');
  return ctx;
}
