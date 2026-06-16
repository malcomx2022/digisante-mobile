'use client';

import { useState } from 'react';

import { LANGUAGE_LIST } from '@digisante/shared';

import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';
import { LangPill } from './LangPill';

/** Sélecteur de langue (pill FR ▾ + menu). Présent sur chaque écran. */
export function LangSwitcher({ dark = false }: { dark?: boolean }) {
  const { lang, setLang } = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'card-pagne focus-visible:outline-none focus-visible:ring-2',
          // L'anneau de focus repose sur l'en-tête (sombre) : un anneau clair neutre
          // reste visible et theme-agnostique dans tous les espaces (vert patient,
          // indigo médecin, ocre pharma/labo/diaspora, nuit admin). Vert uniquement en clair.
          dark
            ? 'focus-visible:ring-white/80'
            : 'focus-visible:ring-offset-2 focus-visible:ring-sante-600',
        )}
      >
        <LangPill lang={lang} dark={dark} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <ul
            role="listbox"
            className="absolute right-0 mt-1 z-40 w-44 bg-white card-pagne border border-stone-200 shadow-lg overflow-hidden"
          >
            {LANGUAGE_LIST.map((l) => (
              <li key={l.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={l.code === lang}
                  onClick={() => {
                    setLang(l.code);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 text-[13px] font-body flex items-center justify-between gap-2',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600',
                    l.code === lang ? 'bg-sante-600 text-white font-display font-bold' : 'text-nuit hover:bg-creme-deep',
                  )}
                >
                  <span>
                    <span className="font-display font-bold mr-1">{l.code}</span>
                    {l.nativeName}
                  </span>
                  {l.hasAudio && <span title="Audio disponible">🔊</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
