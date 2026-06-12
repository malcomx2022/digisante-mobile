'use client';

import { Protected } from '@/components/auth/Protected';
import { BottomNav, type NavItem } from '@/components/ui/BottomNav';

const PRO_NAV: NavItem[] = [
  { labelKey: 'nav.home', icon: 'home', href: '/pro' },
  { labelKey: 'pro.agenda', icon: 'calendar', href: '/pro/agenda' },
  { labelKey: 'pro.patients', icon: 'user', href: '/pro/patient' },
  { labelKey: 'pro.kyc', icon: 'file', href: '/pro/kyc' },
];

// Coquille de l'espace Médecin PRO : garde de rôle + nav basse indigo.
export default function ProLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="MEDECIN">
      <div className="min-h-screen wax-indigo">
        <div className="mx-auto max-w-[420px] min-h-screen bg-creme flex flex-col shadow-xl">
          <div className="flex-1 flex flex-col">{children}</div>
          <BottomNav items={PRO_NAV} accent="indigo" fabHref="/pro/prescribe" />
        </div>
      </div>
    </Protected>
  );
}
