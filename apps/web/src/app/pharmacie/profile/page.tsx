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
      {/* StatusBar mobile uniquement ; sur desktop, langue/déconnexion via la TopNav. */}
      <div className="lg:hidden">
        <StatusBar dark right={<div className="flex items-center gap-2"><LangSwitcher dark /><HeaderLogout /></div>} />
      </div>
      {/* Fond + kenté plein-cadre ; titre recentré sur la colonne du contenu (2xl). */}
      <div className="px-6 pt-2 pb-4 relative">
        <div className="lg:max-w-2xl lg:mx-auto lg:w-full">
          <h1 className="font-display font-extrabold text-2xl">{t('profile.title')}</h1>
          <p className="text-[0.75rem] text-white/80">{user?.phone}</p>
        </div>
        <KenteBar className="absolute -bottom-1 left-0 right-0" />
      </div>
      <div className="flex-1 bg-creme wax-ocre text-nuit px-6 py-6">
        <div className="lg:max-w-2xl lg:mx-auto">
          <ProfileSettings accent="ocre" logoutVariant="outline" />
        </div>
      </div>
    </div>
  );
}
