'use client';

import { ProfileSettings } from '@/components/auth/ProfileSettings';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/i18n/LocaleProvider';

// Profil & paramètres — espace Agent de Santé Communautaire (thème santé).
export default function AscProfilePage() {
  const { t } = useLocale();
  const { user } = useAuth();
  return (
    <>
      <SpaceHeader title={t('profile.title')} subtitle={user?.phone} headerClass="bg-sante-900" />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-2xl lg:mx-auto">
        <ProfileSettings accent="sante" logoutVariant="outline" />
      </main>
    </>
  );
}
