import { cn } from '@/lib/cn';
import { Nkyinkyim } from './Nkyinkyim';

type IconName = 'home' | 'file' | 'calendar' | 'user';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, JSX.Element> = {
    home: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
    file: <path d="M7 3h7l5 5v13H7zM14 3v5h5" />,
    calendar: <path d="M4 5h16v16H4zM4 9h16M8 3v4M16 3v4" />,
    user: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" />,
  };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

interface NavItem {
  label: string;
  icon: IconName;
  active?: boolean;
}

const DEFAULT_ITEMS: NavItem[] = [
  { label: 'Accueil', icon: 'home', active: true },
  { label: 'Dossier', icon: 'file' },
  { label: 'Agenda', icon: 'calendar' },
  { label: 'Profil', icon: 'user' },
];

/** Barre de navigation basse : 5 emplacements, FAB centrale (card-pagne rotate-3). */
export function BottomNav({ items = DEFAULT_ITEMS }: { items?: NavItem[] }) {
  const left = items.slice(0, 2);
  const right = items.slice(2);
  return (
    <nav className="relative bg-white border-t border-stone-200">
      <Nkyinkyim className="absolute -top-3 left-0 right-0" />
      <div className="grid grid-cols-5 items-end pt-2 pb-3">
        {left.map((it) => (
          <NavButton key={it.label} item={it} />
        ))}
        {/* FAB centrale */}
        <div className="flex justify-center">
          <div className="w-14 h-14 -mt-7 card-pagne bg-terre-500 text-white flex items-center justify-center border-4 border-creme rotate-3 shadow-[0_10px_24px_rgba(194,84,43,.45)]">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
        </div>
        {right.map((it) => (
          <NavButton key={it.label} item={it} />
        ))}
      </div>
    </nav>
  );
}

function NavButton({ item }: { item: NavItem }) {
  return (
    <button
      type="button"
      className={cn(
        'flex flex-col items-center gap-1 text-[10px] font-display',
        item.active ? 'text-sante-600 font-extrabold' : 'text-stone-400 font-bold',
      )}
    >
      <Icon name={item.icon} />
      {item.label}
    </button>
  );
}
