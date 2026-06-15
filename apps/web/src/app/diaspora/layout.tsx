'use client';

import { Protected } from '@/components/auth/Protected';
import { BottomNav, type NavItem } from '@/components/ui/BottomNav';

const NAV: NavItem[] = [
  { labelKey: 'nav.home', icon: 'home', href: '/diaspora' },
  { labelKey: 'wallet.title', icon: 'file', href: '/diaspora/wallet' },
  { labelKey: 'diaspora.family', icon: 'user', href: '/diaspora/beneficiaries' },
  { labelKey: 'nav.profil', icon: 'user', href: '/diaspora/profile' },
];

export default function DiasporaLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="DIASPORA">
      <div className="min-h-screen wax-ocre">
        <div className="mx-auto max-w-[420px] min-h-screen bg-creme flex flex-col shadow-xl">
          <div className="flex-1 flex flex-col">{children}</div>
          <BottomNav items={NAV} accent="ocre" fabHref="/diaspora/wallet" />
        </div>
      </div>
    </Protected>
  );
}
