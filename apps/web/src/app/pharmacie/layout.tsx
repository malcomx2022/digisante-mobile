'use client';
import { Protected } from '@/components/auth/Protected';
export default function PharmacieLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="PHARMACIE">
      <div className="min-h-screen bg-nuit">
        <div className="mx-auto max-w-[420px] min-h-screen flex flex-col shadow-xl">{children}</div>
      </div>
    </Protected>
  );
}
