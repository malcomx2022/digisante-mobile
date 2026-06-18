'use client';

import { Protected } from '@/components/auth/Protected';
import { AdminShell } from '@/components/spaces/AdminShell';

// Espace Admin : coquille back-office dédiée (sidebar desktop + BottomNav mobile).
// La navigation est portée par AdminShell (jeu de destinations admin fixe).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="ADMIN">
      <AdminShell>{children}</AdminShell>
    </Protected>
  );
}
