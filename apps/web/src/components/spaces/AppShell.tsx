'use client';

import { BottomNav, type NavItem } from '@/components/ui/BottomNav';
import { TopNav } from '@/components/ui/TopNav';
import { cn } from '@/lib/cn';

// Aligné sur les accents de BottomNav (par espace).
type Accent = 'sante' | 'indigo' | 'ocre';

/**
 * Coquille applicative adaptative (refonte UX) :
 * - mobile (<lg) : conteneur étroit centré + BottomNav + FAB (inchangé) ;
 * - desktop (≥lg) : TopNav horizontale + conteneur élargi centré.
 *
 * Présentation only : les pages conservent leur contenu et leur en-tête.
 * Réutilisable par chaque espace via ses props (accent + items + fond).
 */
export function AppShell({
  accent = 'sante',
  items,
  fabHref,
  fabLabelKey,
  profileHref,
  bgWrap = 'wax-light',
  bgInner = 'bg-creme',
  children,
}: {
  accent?: Accent;
  items: NavItem[];
  fabHref: string;
  fabLabelKey?: string;
  profileHref?: string;
  /** Fond texturé de la zone hors conteneur (ex. wax-light, wax-ocre, bg-nuit). */
  bgWrap?: string;
  /** Fond du conteneur de contenu (ex. bg-creme, transparent pour les espaces sombres). */
  bgInner?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('min-h-screen', bgWrap)}>
      <TopNav items={items} accent={accent} fabHref={fabHref} fabLabelKey={fabLabelKey} profileHref={profileHref} />
      <div
        className={cn(
          // Desktop : conteneur élargi pour les grilles multi-colonnes ;
          // les contenus « lecture/formulaire » se recentrent eux-mêmes (max-w-2xl).
          'mx-auto w-full max-w-[420px] lg:max-w-5xl min-h-screen flex flex-col shadow-xl lg:shadow-none',
          bgInner,
        )}
      >
        <div className="flex-1 flex flex-col">{children}</div>
        <div className="lg:hidden">
          <BottomNav items={items} accent={accent} fabHref={fabHref} fabLabelKey={fabLabelKey} />
        </div>
      </div>
    </div>
  );
}
