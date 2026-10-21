'use client';

import { Protected } from '@/components/auth/Protected';
import { AppShell } from '@/components/spaces/AppShell';
import type { NavItem } from '@/components/ui/BottomNav';

// Navigation de l'espace Diaspora (accent ocre). FAB = action « Recharger » : il
// mène au formulaire de recharge (`#topup`), la navigation garde « Mon portefeuille ».
const NAV: NavItem[] = [
  { labelKey: 'nav.home', icon: 'home', href: '/diaspora' },
  { labelKey: 'wallet.title', icon: 'file', href: '/diaspora/wallet' },
  { labelKey: 'diaspora.family', icon: 'user', href: '/diaspora/beneficiaries' },
  { labelKey: 'nav.profil', icon: 'user', href: '/diaspora/profile' },
];

export default function DiasporaLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="DIASPORA">
      <AppShell
        accent="ocre"
        items={NAV}
        fabHref="/diaspora/wallet#topup"
        fabLabelKey="wallet.topup"
        profileHref="/diaspora/profile"
        bgWrap="wax-ocre"
      >
        {children}
      </AppShell>
    </Protected>
  );
}
