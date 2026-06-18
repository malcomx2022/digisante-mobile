'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { spaceFor } from '@/auth/spaces';
import { useLocale } from '@/i18n/LocaleProvider';

// Point d'entrée : redirige vers l'espace de l'utilisateur, ou vers l'onboarding.
export default function Home() {
  const { status, user } = useAuth();
  const router = useRouter();
  const { t } = useLocale();

  useEffect(() => {
    if (status === 'authed' && user) router.replace(spaceFor(user.role));
    else if (status === 'anon') router.replace('/onboarding');
  }, [status, user, router]);

  return (
    <div className="min-h-dvh-screen flex items-center justify-center bg-creme text-stone-500 font-body text-sm">
      {t('common.loading')}
    </div>
  );
}
