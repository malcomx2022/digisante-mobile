import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { LangPill } from './LangPill';

/**
 * Barre d'actions en tête d'écran mobile : sélecteur de langue, déconnexion,
 * accès profil. Masquée sur desktop (la TopNav prend le relais).
 *
 * ⚠️ Elle portait jusqu'en août 2026 une **fausse heure figée à « 9:41 »** —
 * l'heure des maquettes Apple, héritée des écrans D-01…D-26 et jamais retirée.
 * En navigateur, elle imitait une barre d'OS sans en être une ; en PWA
 * installée, elle affichait une heure FAUSSE et FIGÉE juste sous l'heure système
 * réelle. Ne pas la réintroduire : l'horloge du téléphone est déjà à l'écran.
 *
 * `pt-safe` décale le contenu sous l'encoche / la Dynamic Island : le document
 * s'étend sous la barre d'état iOS (`viewportFit: 'cover'`), donc sans ce
 * décalage les actions passeraient sous l'heure système.
 */
export function StatusBar({
  dark = false,
  lang = 'FR',
  right,
}: {
  dark?: boolean;
  lang?: string;
  /** Slot droit (par défaut une pill langue ; passer un <LangSwitcher/> si interactif). */
  right?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'pt-safe flex items-center justify-end px-4 min-h-11 text-[0.6875rem]',
        dark ? 'text-white' : 'text-nuit',
      )}
    >
      {right ?? <LangPill lang={lang} dark={dark} />}
    </div>
  );
}
