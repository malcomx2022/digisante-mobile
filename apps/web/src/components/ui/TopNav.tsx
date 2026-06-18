'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { HeaderLogout } from '@/components/auth/HeaderLogout';
import { HeaderProfileLink } from '@/components/auth/HeaderProfileLink';
import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';
import type { NavItem } from './BottomNav';
import { KenteBar } from './KenteBar';
import { LangSwitcher } from './LangSwitcher';

// Aligné sur les accents de BottomNav (par espace).
type Accent = 'sante' | 'indigo' | 'ocre';

// Barre de navigation horizontale — DESKTOP uniquement (hidden lg:flex).
// Pendant de BottomNav sur grand écran ; même items + action principale (FAB).
const BAR: Record<Accent, string> = {
  sante: 'bg-sante-900',
  indigo: 'bg-indigo-900',
  ocre: 'bg-ocre-900',
};

export function TopNav({
  items,
  accent = 'sante',
  fabHref,
  fabLabelKey,
  profileHref,
}: {
  items: NavItem[];
  accent?: Accent;
  fabHref?: string;
  fabLabelKey?: string;
  profileHref?: string;
}) {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <header className={cn('hidden lg:block sticky top-0 z-30 bogolan-dark text-white', BAR[accent])}>
      <div className="mx-auto max-w-6xl flex items-center gap-2 px-6 h-14">
        <span className="font-display font-extrabold text-[0.9375rem] mr-4">DigiSanté</span>
        <nav className="flex items-center gap-1 flex-1" aria-label="Navigation principale">
          {items.map((it) => {
            const active = pathname === it.href;
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'px-3 py-1.5 card-pagne text-[0.8125rem] font-display font-bold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80',
                  active ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white hover:bg-white/10',
                )}
              >
                {t(it.labelKey)}
              </Link>
            );
          })}
          {fabHref && (
            <Link
              href={fabHref}
              className={cn(
                'ml-1 px-3 py-1.5 card-pagne text-[0.8125rem] font-display font-bold bg-white/20 hover:bg-white/30 text-white',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80',
              )}
            >
              {fabLabelKey ? t(fabLabelKey) : '+'}
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-2">
          <LangSwitcher dark />
          {profileHref && <HeaderProfileLink href={profileHref} />}
          <HeaderLogout />
        </div>
      </div>
      <KenteBar className="absolute bottom-0 left-0 right-0" />
    </header>
  );
}
