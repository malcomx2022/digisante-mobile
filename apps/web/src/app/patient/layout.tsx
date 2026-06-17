'use client';

import { Protected } from '@/components/auth/Protected';
import { AppShell } from '@/components/spaces/AppShell';
import type { NavItem } from '@/components/ui/BottomNav';

// Navigation de l'espace Patient (accent sante). FAB = SOS.
const NAV: NavItem[] = [
  { labelKey: 'nav.home', icon: 'home', href: '/patient' },
  { labelKey: 'nav.dossier', icon: 'file', href: '/patient/dmp' },
  { labelKey: 'nav.search', icon: 'search', href: '/patient/doctors' },
  { labelKey: 'nav.profil', icon: 'user', href: '/patient/profile' },
];

// Coquille de l'espace Patient : garde de rôle + cadre adaptatif (mobile/desktop).
export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="PATIENT">
      <AppShell
        accent="sante"
        items={NAV}
        fabHref="/patient/sos"
        fabLabelKey="sos.title"
        profileHref="/patient/profile"
      >
        {children}
      </AppShell>
    </Protected>
  );
}
