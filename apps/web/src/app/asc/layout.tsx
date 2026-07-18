'use client';

import { Protected } from '@/components/auth/Protected';
import { AppShell } from '@/components/spaces/AppShell';
import type { NavItem } from '@/components/ui/BottomNav';

// Espace Agent de Santé Communautaire (relais). Accent santé (vert). FAB = roster.
const NAV: NavItem[] = [
  { labelKey: 'nav.home', icon: 'home', href: '/asc' },
  { labelKey: 'nav.profil', icon: 'user', href: '/asc/profile' },
];

export default function AscLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="ASC">
      <AppShell accent="sante" items={NAV} fabHref="/asc" fabLabelKey="asc.title" profileHref="/asc/profile">
        {children}
      </AppShell>
    </Protected>
  );
}
