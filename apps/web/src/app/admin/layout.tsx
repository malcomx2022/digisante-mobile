'use client';

import { Protected } from '@/components/auth/Protected';
import { AppShell } from '@/components/spaces/AppShell';
import type { NavItem } from '@/components/ui/BottomNav';

// Navigation de l'espace Admin (accent indigo). FAB = CMS éducation.
const NAV: NavItem[] = [
  { labelKey: 'admin.metrics', icon: 'home', href: '/admin' },
  { labelKey: 'admin.users', icon: 'user', href: '/admin/users' },
  { labelKey: 'admin.audit', icon: 'file', href: '/admin/audit' },
  { labelKey: 'admin.education', icon: 'search', href: '/admin/education' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="ADMIN">
      <AppShell
        accent="indigo"
        items={NAV}
        fabHref="/admin/education"
        fabLabelKey="admin.education"
        profileHref="/admin/profile"
        bgWrap="wax-indigo"
      >
        {children}
      </AppShell>
    </Protected>
  );
}
