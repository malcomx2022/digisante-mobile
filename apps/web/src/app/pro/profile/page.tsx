'use client';

import { ProHeader } from '@/components/pro/ProHeader';
import { ProfileSettings } from '@/components/auth/ProfileSettings';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/i18n/LocaleProvider';

// Profil & paramètres — espace Médecin PRO (thème indigo).
export default function ProProfilePage() {
  const { t } = useLocale();
  const { user } = useAuth();
  return (
    <>
      <ProHeader title={t('profile.title')} subtitle={user?.phone} />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-2xl lg:mx-auto">
        <ProfileSettings accent="indigo" logoutVariant="outline" />
      </main>
    </>
  );
}
