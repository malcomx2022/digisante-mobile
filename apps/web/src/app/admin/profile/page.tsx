'use client';

import { ProfileSettings } from '@/components/auth/ProfileSettings';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/i18n/LocaleProvider';

// Profil & paramètres — espace Admin (thème indigo nuit).
export default function AdminProfilePage() {
  const { t } = useLocale();
  const { user } = useAuth();
  return (
    <>
      <SpaceHeader title={t('profile.title')} subtitle={user?.phone} headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-4xl lg:mx-auto lg:w-full">
        <ProfileSettings accent="indigo" logoutVariant="outline" columns />
      </main>
    </>
  );
}
