'use client';

import { Protected } from '@/components/auth/Protected';
import { AppShell } from '@/components/spaces/AppShell';
import type { NavItem } from '@/components/ui/BottomNav';

// Navigation de l'espace Laboratoire (accent ocre). FAB = file des demandes.
const NAV: NavItem[] = [
  { labelKey: 'nav.home', icon: 'home', href: '/labo' },
  { labelKey: 'labo.orders_title', icon: 'file', href: '/labo/orders' },
  { labelKey: 'nav.profil', icon: 'user', href: '/labo/profile' },
];

export default function LaboLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="LABORATOIRE">
      <AppShell
        accent="ocre"
        items={NAV}
        fabHref="/labo/orders"
        fabLabelKey="labo.orders_title"
        profileHref="/labo/profile"
        bgWrap="wax-ocre"
      >
        {children}
      </AppShell>
    </Protected>
  );
}
