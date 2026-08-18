'use client';

import { DoctorProfileCard } from '@/components/pro/DoctorProfileCard';
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
      <main className="px-6 -mt-10 relative z-20 pb-6 space-y-4 lg:max-w-2xl lg:mx-auto">
        {/* Fiche PROFESSIONNELLE (tarif, spécialité, créneau, bio) — écart D4.
            Les langues parlées restent dans ProfileSettings ci-dessous : elles
            vivent sur Profile.spokenLangs, pas sur Doctor. */}
        <DoctorProfileCard />
        <ProfileSettings accent="indigo" logoutVariant="outline" />
      </main>
    </>
  );
}
