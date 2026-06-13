'use client';

import { KenteBar, LangSwitcher, StatusBar } from '@/components/ui';
import { HeaderLogout } from '@/components/auth/HeaderLogout';
import { ProfileSettings } from '@/components/auth/ProfileSettings';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/i18n/LocaleProvider';

// Profil & paramètres — espace Pharmacie (coquille nuit + carte crème).
export default function PharmacieProfilePage() {
  const { t } = useLocale();
  const { user } = useAuth();
  return (
    <div className="flex-1 bg-nuit bogolan-dark text-white flex flex-col">
      <StatusBar dark right={<div className="flex items-center gap-2"><LangSwitcher dark /><HeaderLogout /></div>} />
      <div className="px-6 pt-2 pb-4 relative">
        <h1 className="font-display font-extrabold text-2xl">{t('profile.title')}</h1>
        <p className="text-[12px] text-white/60">{user?.phone}</p>
        <KenteBar className="absolute -bottom-1 left-0 right-0" />
      </div>
      <div className="flex-1 bg-creme wax-ocre text-nuit px-6 py-6">
        <ProfileSettings accent="ocre" logoutVariant="outline" />
      </div>
    </div>
  );
}
