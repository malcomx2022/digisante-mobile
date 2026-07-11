'use client';

import { Protected } from '@/components/auth/Protected';
import { AppShell } from '@/components/spaces/AppShell';
import type { NavItem } from '@/components/ui/BottomNav';

// Navigation de l'espace Pharmacie (accent ocre). FAB = scan d'ordonnance.
const NAV: NavItem[] = [
  { labelKey: 'nav.home', icon: 'home', href: '/pharmacie' },
  { labelKey: 'stock.nav', icon: 'search', href: '/pharmacie/stock' },
  { labelKey: 'pharmacie.history', icon: 'file', href: '/pharmacie/history' },
  { labelKey: 'nav.profil', icon: 'user', href: '/pharmacie/profile' },
];

export default function PharmacieLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="PHARMACIE">
      <AppShell
        accent="ocre"
        items={NAV}
        fabHref="/pharmacie"
        fabLabelKey="pharmacie.scan"
        profileHref="/pharmacie/profile"
        bgWrap="bg-nuit"
        bgInner=""
      >
        {children}
      </AppShell>
    </Protected>
  );
}
