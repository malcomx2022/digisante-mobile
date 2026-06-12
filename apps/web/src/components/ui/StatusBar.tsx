import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { LangPill } from './LangPill';

/** Barre d'état mobile : heure + sélecteur/pill langue. En tête de chaque écran. */
export function StatusBar({
  dark = false,
  lang = 'FR',
  time = '9:41',
  right,
}: {
  dark?: boolean;
  lang?: string;
  time?: string;
  /** Slot droit (par défaut une pill langue ; passer un <LangSwitcher/> si interactif). */
  right?: ReactNode;
}) {
  return (
    <div className={cn('flex items-center justify-between px-4 h-11 text-[11px]', dark ? 'text-white' : 'text-nuit')}>
      <span className="font-display font-bold">{time}</span>
      {right ?? <LangPill lang={lang} dark={dark} />}
    </div>
  );
}
