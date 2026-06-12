'use client';
import { Protected } from '@/components/auth/Protected';
export default function LaboLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected role="LABORATOIRE">
      <div className="min-h-screen wax-ocre">
        <div className="mx-auto max-w-[420px] min-h-screen bg-creme flex flex-col shadow-xl">{children}</div>
      </div>
    </Protected>
  );
}
