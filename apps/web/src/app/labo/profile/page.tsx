'use client';

import Link from 'next/link';

import { ProfileSettings } from '@/components/auth/ProfileSettings';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/i18n/LocaleProvider';

// Profil & paramètres — espace Laboratoire (thème or).
export default function LaboProfilePage() {
  const { t } = useLocale();
  const { user } = useAuth();
  return (
    <>
      <SpaceHeader title={t('profile.title')} subtitle={user?.phone} headerClass="bg-ocre-900" />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-2xl lg:mx-auto">
        <Link href="/labo/kyc" className="block mb-4 text-center bg-ocre-400 card-pagne py-3 font-display font-extrabold">{t('labkyc.title')}</Link>
        <ProfileSettings accent="ocre" logoutVariant="outline" />
      </main>
    </>
  );
}
