'use client';

import type { AdminScope } from '@digisante/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { HeaderLogout } from '@/components/auth/HeaderLogout';
import { BottomNav, type NavItem } from '@/components/ui/BottomNav';
import { LangSwitcher } from '@/components/ui/LangSwitcher';
import { useLocale } from '@/i18n/LocaleProvider';
import { adminsApi } from '@/lib/api/admins';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

// ─────────────────────────────────────────────────────────────
// Coquille de l'espace ADMIN (back-office) — densité desktop.
//  · Desktop (≥lg) : sidebar persistante indigo nuit (bogolan + kenté), nav
//    verticale + actions terre-500, conforme §5 et à la maquette opposable
//    `AdminDesktop_LotFinal.html`.
//  · Mobile (<lg) : coquille « carte téléphone » (max-w-[420px]) + BottomNav,
//    INCHANGÉE — chaque page garde son SpaceHeader sombre.
// ─────────────────────────────────────────────────────────────

type IconKey = 'dashboard' | 'users' | 'kyc' | 'audit' | 'education' | 'admins';

function NavIcon({ name }: { name: IconKey }) {
  const paths: Record<IconKey, JSX.Element> = {
    dashboard: (
      <>
        <rect width="7" height="9" x="3" y="3" rx="1" />
        <rect width="7" height="5" x="14" y="3" rx="1" />
        <rect width="7" height="9" x="14" y="12" rx="1" />
        <rect width="7" height="5" x="3" y="16" rx="1" />
      </>
    ),
    users: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    kyc: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    audit: <path d="M14 2v6h6M4 22V4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />,
    education: <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />,
    admins: (
      <>
        <circle cx="7.5" cy="15.5" r="5.5" />
        <path d="m21 2-9.6 9.6" />
        <path d="m15.5 7.5 3 3L22 7l-3-3" />
      </>
    ),
  };
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

// Navigation latérale (desktop) — jeu complet des destinations admin.
// `scope` : la destination n'est visible que si l'admin possède ce scope.
const SIDEBAR: { labelKey: string; href: string; icon: IconKey; scope?: AdminScope }[] = [
  { labelKey: 'admin.metrics', href: '/admin', icon: 'dashboard' },
  { labelKey: 'admin.users', href: '/admin/users', icon: 'users', scope: 'users:read' },
  { labelKey: 'adminkyc.title', href: '/admin/kyc', icon: 'kyc', scope: 'kyc:review' },
  { labelKey: 'admin.audit', href: '/admin/audit', icon: 'audit', scope: 'audit:read' },
  { labelKey: 'admin.education', href: '/admin/education', icon: 'education', scope: 'education:write' },
  { labelKey: 'admin.admins', href: '/admin/admins', icon: 'admins', scope: 'admin:manage' },
];

// Navigation basse (mobile) — 4 emplacements + FAB ; gated par scope également.
const BOTTOM: (NavItem & { scope?: AdminScope })[] = [
  { labelKey: 'admin.metrics', icon: 'home', href: '/admin' },
  { labelKey: 'admin.users', icon: 'user', href: '/admin/users', scope: 'users:read' },
  { labelKey: 'admin.audit', icon: 'file', href: '/admin/audit', scope: 'audit:read' },
  { labelKey: 'admin.education', icon: 'search', href: '/admin/education', scope: 'education:write' },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const me = useApi(() => adminsApi.me(), []);
  const scopes = me.data?.scopes;
  // Optimiste : tant que les scopes ne sont pas chargés, on n'ampute pas la nav.
  const can = (scope?: AdminScope) => !scope || !scopes || scopes.includes(scope);
  const sidebar = SIDEBAR.filter((it) => can(it.scope));
  const bottom = BOTTOM.filter((it) => can(it.scope));

  return (
    <div className="min-h-dvh-screen wax-indigo lg:flex">
      {/* Lien d'évitement (a11y clavier). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-white focus:text-nuit focus:card-pagne focus:shadow-lg focus:font-display focus:font-bold"
      >
        {t('a11y.skip')}
      </a>

      {/* ── Sidebar — desktop uniquement ── */}
      <aside
        className="hidden lg:flex lg:flex-col w-[260px] flex-shrink-0 sticky top-0 h-screen text-white bogolan-dark"
        style={{ background: 'linear-gradient(180deg,#1A2440 0%,#121A2E 100%)' }}
      >
        <div className="relative z-10 p-5 flex-1 flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 card-pagne bg-terre-500 flex items-center justify-center rotate-2 shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21C7 17 2 13.5 2 9a5.5 5.5 0 0 1 10-3 5.5 5.5 0 0 1 10 3c0 4.5-5 8-10 12Z" />
              </svg>
            </div>
            <div>
              <p className="font-display font-extrabold text-[1rem] leading-tight">DigiSanté</p>
              <p className="text-[0.625rem] text-indigo-300 font-bold uppercase tracking-widest">{t('admin.backoffice')}</p>
            </div>
          </div>
          <div className="kente-bar w-full rounded-full mb-4" />

          <nav className="space-y-1 flex-1" aria-label={t('admin.backoffice')}>
            {sidebar.map((it) => {
              const active = pathname === it.href;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center gap-3 px-3 py-2.5 card-pagne text-[0.8125rem] font-display transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70',
                    active ? 'text-white font-bold' : 'text-indigo-200 font-medium hover:text-white hover:bg-white/5',
                  )}
                  style={active ? { background: 'rgba(194,84,43,.18)' } : undefined}
                >
                  {active && <span className="absolute left-0 top-1 bottom-1 w-[3px] bg-terre-400 rounded-full" aria-hidden="true" />}
                  <NavIcon name={it.icon} />
                  <span>{t(it.labelKey)}</span>
                </Link>
              );
            })}
          </nav>

          <div className="pt-4 mt-4 border-t border-white/10 flex items-center justify-between gap-2">
            <LangSwitcher dark />
            <HeaderLogout />
          </div>
        </div>
      </aside>

      {/* ── Colonne contenu : pleine largeur desktop, cadre 420px sur mobile ── */}
      <div className="flex-1 min-w-0 flex flex-col mx-auto w-full max-w-[420px] lg:max-w-none bg-creme shadow-xl lg:shadow-none">
        <div id="main-content" tabIndex={-1} className="flex-1 flex flex-col outline-none">
          {children}
        </div>
        <div className="lg:hidden">
          <BottomNav items={bottom} accent="indigo" fabHref="/admin/education" fabLabelKey="admin.education" />
        </div>
      </div>
    </div>
  );
}
