'use client';

import { Protected } from '@/components/auth/Protected';
import { BottomNav, type NavItem } from '@/components/ui/BottomNav';

const NAV: NavItem[] = [
  { labelKey: 'admin.metrics', icon: 'home', href: '/admin' },
  { labelKey: 'admin.users', icon: 'user', href: '/admin/users' },
  { labelKey: 'admin.audit', icon: 'file', href: '/admin/audit' },
  { labelKey: 'admin.education', icon: 'search', href: '/admin/education' },
];

// Coquille Admin (indigo nuit). Responsive : plus large sur desktop (≥ xl).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="ADMIN">
      <div className="min-h-screen wax-indigo">
        <div className="mx-auto max-w-[420px] xl:max-w-3xl min-h-screen bg-creme flex flex-col shadow-xl">
          <div className="flex-1 flex flex-col">{children}</div>
          <BottomNav items={NAV} accent="indigo" fabHref="/admin/education" />
        </div>
      </div>
    </Protected>
  );
}
