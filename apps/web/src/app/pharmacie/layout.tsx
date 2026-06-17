'use client';

import { Protected } from '@/components/auth/Protected';
import { BottomNav, type NavItem } from '@/components/ui/BottomNav';

// Navigation de l'espace Pharmacie (accent ocre). FAB = scan d'ordonnance.
const NAV: NavItem[] = [
  { labelKey: 'nav.home', icon: 'home', href: '/pharmacie' },
  { labelKey: 'pharmacie.history', icon: 'file', href: '/pharmacie/history' },
  { labelKey: 'nav.profil', icon: 'user', href: '/pharmacie/profile' },
];

export default function PharmacieLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="PHARMACIE">
      <div className="min-h-screen bg-nuit">
        <div className="mx-auto max-w-[420px] min-h-screen flex flex-col shadow-xl">
          <div className="flex-1 flex flex-col">{children}</div>
          <BottomNav items={NAV} accent="ocre" fabHref="/pharmacie" fabLabelKey="pharmacie.scan" />
        </div>
      </div>
    </Protected>
  );
}
