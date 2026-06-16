'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { setAccessToken, setRefreshHandler, setSessionExpiredHandler } from '@/lib/api/client';
import { authApi, type AuthUser, type OtpInfo, type RegisterBody } from '@/lib/api/auth';
import { registerPushDevice } from './push';
import { tokenStore } from './storage';

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

  // Reprise de session au démarrage (access → /me ; sinon tentative de refresh).
  useEffect(() => {
    let active = true;
    (async () => {
      const { access, refresh } = tokenStore.get();
      if (!access) {
        if (active) setStatus('anon');
        return;
      }
      setAccessToken(access);
      try {
        const me = await authApi.me();
        if (active) {
          setUser(me);
          setStatus('authed');
        }
      } catch {
        if (refresh) {
          try {
            const t = await authApi.refresh({ refreshToken: refresh });
            tokenStore.set(t.accessToken, t.refreshToken);
            setAccessToken(t.accessToken);
            const me = await authApi.me();
            if (active) {
              setUser(me);
              setStatus('authed');
            }
            return;
          } catch {
            /* refresh échoué */
          }
        }
        tokenStore.clear();
        setAccessToken(null);
        if (active) setStatus('anon');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Purge complète de la session (utilisée par logout ET par l'expiration de session).
  const clearSession = useCallback(() => {
    tokenStore.clear();
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
      const { refresh } = tokenStore.get();
      if (!refresh) return null;
      const tokens = await authApi.refresh({ refreshToken: refresh });
      tokenStore.set(tokens.accessToken, tokens.refreshToken);
      setAccessToken(tokens.accessToken);
      return tokens.accessToken;
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
    tokenStore.set(res.accessToken, res.refreshToken);
    setAccessToken(res.accessToken);
    setUser(res.user);
    setStatus('authed');
    // Enregistrement du token push après connexion (best-effort, non bloquant).
    void registerPushDevice();
    return res.user;
  }, []);

  const logout = useCallback<AuthContextValue['logout']>(async () => {
    // 1) Révocation serveur du refresh token (best-effort — on ignore l'échec).
    const { refresh } = tokenStore.get();
    if (refresh) {
      try {
        await authApi.logout({ refreshToken: refresh });
      } catch {
        /* hors-ligne ou token déjà révoqué : on purge quand même localement */
      }
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
