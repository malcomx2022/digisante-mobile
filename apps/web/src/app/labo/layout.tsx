'use client';

import { Protected } from '@/components/auth/Protected';
import { BottomNav, type NavItem } from '@/components/ui/BottomNav';

// Navigation de l'espace Laboratoire (accent ocre). FAB = file des demandes.
const NAV: NavItem[] = [
  { labelKey: 'nav.home', icon: 'home', href: '/labo' },
  { labelKey: 'labo.orders_title', icon: 'file', href: '/labo/orders' },
  { labelKey: 'nav.profil', icon: 'user', href: '/labo/profile' },
];

export default function LaboLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="LABORATOIRE">
      <div className="min-h-screen wax-ocre">
        <div className="mx-auto max-w-[420px] min-h-screen bg-creme flex flex-col shadow-xl">
          <div className="flex-1 flex flex-col">{children}</div>
          <BottomNav items={NAV} accent="ocre" fabHref="/labo/orders" fabLabelKey="labo.orders_title" />
        </div>
      </div>
    </Protected>
  );
}
