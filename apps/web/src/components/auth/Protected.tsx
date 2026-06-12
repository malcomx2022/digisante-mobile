'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import type { Role } from '@digisante/shared';

import { useAuth } from '@/auth/AuthProvider';
import { spaceFor } from '@/auth/spaces';
import { useLocale } from '@/i18n/LocaleProvider';

/** Garde de route : exige une session, et optionnellement un rôle précis. */
export function Protected({ role, children }: { role?: Role; children: React.ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const { t } = useLocale();

  useEffect(() => {
    if (status === 'anon') {
      router.replace('/onboarding');
    } else if (status === 'authed' && user && role && user.role !== role) {
      router.replace(spaceFor(user.role)); // redirige vers SON espace
    }
  }, [status, user, role, router]);

  if (status !== 'authed' || (role && user?.role !== role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-creme text-stone-500 font-body text-sm">
        {t('common.loading')}
      </div>
    );
  }
  return <>{children}</>;
}
