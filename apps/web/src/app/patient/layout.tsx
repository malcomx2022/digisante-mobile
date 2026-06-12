'use client';

import { Protected } from '@/components/auth/Protected';
import { BottomNav } from '@/components/ui';

// Coquille de l'espace Patient : garde de rôle + cadre mobile + navigation basse.
export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="PATIENT">
      <div className="min-h-screen wax-light">
        <div className="mx-auto max-w-[420px] min-h-screen bg-creme flex flex-col shadow-xl">
          <div className="flex-1 flex flex-col">{children}</div>
          <BottomNav />
        </div>
      </div>
    </Protected>
  );
}
