'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { Lang, Role } from '@digisante/shared';

import { setAccessToken } from '@/lib/api/client';
import { authApi, type AuthUser, type OtpInfo } from '@/lib/api/auth';
import { tokenStore } from './storage';

type Status = 'loading' | 'authed' | 'anon';

interface AuthContextValue {
  status: Status;
  user: AuthUser | null;
  register: (b: { phone: string; firstName: string; lastName: string; role: Role; lang: Lang; email?: string }) => Promise<OtpInfo>;
  requestOtp: (phone: string, channel?: 'SMS' | 'VOICE') => Promise<OtpInfo>;
  verifyOtp: (phone: string, code: string) => Promise<AuthUser>;
  logout: () => void;
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

  const register = useCallback<AuthContextValue['register']>((b) => authApi.register(b).then((r) => r.otp), []);
  const requestOtp = useCallback<AuthContextValue['requestOtp']>((phone, channel) => authApi.requestOtp({ phone, channel }), []);

  const verifyOtp = useCallback<AuthContextValue['verifyOtp']>(async (phone, code) => {
    const res = await authApi.verifyOtp({ phone, code });
    tokenStore.set(res.accessToken, res.refreshToken);
    setAccessToken(res.accessToken);
    setUser(res.user);
    setStatus('authed');
    return res.user;
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setAccessToken(null);
    setUser(null);
    setStatus('anon');
  }, []);

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
