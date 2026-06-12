'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';
import { Nkyinkyim } from './Nkyinkyim';

type IconName = 'home' | 'file' | 'search' | 'pill' | 'user' | 'calendar';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, JSX.Element> = {
    home: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
    file: <path d="M7 3h7l5 5v13H7zM14 3v5h5" />,
    search: <path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" />,
    pill: <path d="M10.5 20.5a5 5 0 01-7-7l6-6a5 5 0 017 7zM8 8l8 8" />,
    user: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" />,
    calendar: <path d="M4 5h16v16H4zM4 9h16M8 3v4M16 3v4" />,
  };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export interface NavItem {
  labelKey: string;
  icon: IconName;
  href: string;
}

type Accent = 'sante' | 'indigo' | 'ocre';
const ACTIVE_CLASS: Record<Accent, string> = {
  sante: 'text-sante-600',
  indigo: 'text-indigo-600',
  ocre: 'text-ocre-600',
};
const FAB_CLASS: Record<Accent, string> = {
  sante: 'bg-terre-500 shadow-[0_10px_24px_rgba(194,84,43,.45)]',
  indigo: 'bg-indigo-600 shadow-[0_10px_24px_rgba(43,58,103,.45)]',
  ocre: 'bg-ocre-400 text-stone-900 shadow-[0_10px_24px_rgba(212,168,67,.45)]',
};

const DEFAULT_ITEMS: NavItem[] = [
  { labelKey: 'nav.home', icon: 'home', href: '/patient' },
  { labelKey: 'nav.dossier', icon: 'file', href: '/patient/dmp' },
  { labelKey: 'nav.search', icon: 'search', href: '/patient/doctors' },
  { labelKey: 'nav.profil', icon: 'user', href: '/patient/profile' },
];

/** Barre de navigation basse : 5 emplacements, FAB centrale (card-pagne rotate-3). */
export function BottomNav({
  items = DEFAULT_ITEMS,
  fabHref = '/patient/sos',
  accent = 'sante',
}: {
  items?: NavItem[];
  fabHref?: string;
  accent?: Accent;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const left = items.slice(0, 2);
  const right = items.slice(2);

  return (
    <nav className="relative bg-white border-t border-stone-200">
      <Nkyinkyim className="absolute -top-3 left-0 right-0" />
      <div className="grid grid-cols-5 items-end pt-2 pb-3">
        {left.map((it) => (
          <NavLink key={it.href} item={it} label={t(it.labelKey)} active={pathname === it.href} accent={accent} />
        ))}
        <div className="flex justify-center">
          <Link
            href={fabHref}
            aria-label="Action"
            className={cn('w-14 h-14 -mt-7 card-pagne text-white flex items-center justify-center border-4 border-creme rotate-3', FAB_CLASS[accent])}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </Link>
        </div>
        {right.map((it) => (
          <NavLink key={it.href} item={it} label={t(it.labelKey)} active={pathname === it.href} accent={accent} />
        ))}
      </div>
    </nav>
  );
}

function NavLink({ item, label, active, accent }: { item: NavItem; label: string; active: boolean; accent: Accent }) {
  return (
    <Link
      href={item.href}
      className={cn(
        'flex flex-col items-center gap-1 text-[10px] font-display',
        active ? `${ACTIVE_CLASS[accent]} font-extrabold` : 'text-stone-400 font-bold',
      )}
    >
      <Icon name={item.icon} />
      {label}
    </Link>
  );
}
