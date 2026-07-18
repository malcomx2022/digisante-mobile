'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { DEFAULT_LANG, type Lang } from '@digisante/shared';

import { setFormatLang } from './format';
import { messages } from './messages';

const STORAGE_KEY = 'digisante.lang';

type TFn = (key: string, vars?: Record<string, string | number>) => string;

interface LocaleContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFn;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function interpolate(raw: string, vars?: Record<string, string | number>): string {
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function LocaleProvider({ children, initialLang = DEFAULT_LANG }: { children: ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  // Restaure le choix persistant (offline-first).
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (stored && messages[stored]) setLangState(stored);
  }, []);

  // Synchronise les helpers de format (dates/nombres localisés) AVANT le rendu
  // des enfants — les composants re-rendent via le contexte au changement.
  setFormatLang(lang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next.toLowerCase();
  }, []);

  // Repli : langue courante → FR → clé brute.
  const t = useCallback<TFn>(
    (key, vars) => {
      const raw = messages[lang]?.[key] ?? messages[DEFAULT_LANG]?.[key] ?? key;
      return interpolate(raw, vars);
    },
    [lang],
  );

  const value = useMemo<LocaleContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale doit être utilisé dans un <LocaleProvider>');
  return ctx;
}
