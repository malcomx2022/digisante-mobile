'use client';

import { Protected } from '@/components/auth/Protected';
import { AppShell } from '@/components/spaces/AppShell';
import type { NavItem } from '@/components/ui/BottomNav';

// Navigation de l'espace Médecin PRO (accent indigo). FAB = nouvelle ordonnance.
const PRO_NAV: NavItem[] = [
  { labelKey: 'nav.home', icon: 'home', href: '/pro' },
  { labelKey: 'pro.agenda', icon: 'calendar', href: '/pro/agenda' },
  { labelKey: 'pro.patients', icon: 'user', href: '/pro/patient' },
  { labelKey: 'pro.kyc', icon: 'file', href: '/pro/kyc' },
];

// Coquille de l'espace Médecin PRO : garde de rôle + cadre adaptatif (mobile/desktop).
export default function ProLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="MEDECIN">
      <AppShell
        accent="indigo"
        items={PRO_NAV}
        fabHref="/pro/prescribe"
        fabLabelKey="pro.prescribe"
        profileHref="/pro/profile"
        bgWrap="wax-indigo"
      >
        {children}
      </AppShell>
    </Protected>
  );
}
