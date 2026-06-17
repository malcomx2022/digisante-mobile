'use client';

import { KenteBar, LangSwitcher, StatusBar } from '@/components/ui';
import { HeaderLogout } from '@/components/auth/HeaderLogout';

/** En-tête sombre commun des écrans patient (bogolan sante-900 + kenté). */
export function PatientHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="bg-sante-900 bogolan-dark relative pb-14 text-white">
      {/* StatusBar (heure + langue + déconnexion) sur mobile ; sur desktop
          ces actions sont portées par la TopNav. */}
      <div className="lg:hidden">
        <StatusBar dark right={<div className="flex items-center gap-2"><LangSwitcher dark /><HeaderLogout /></div>} />
      </div>
      <div className="px-6 pt-2 lg:pt-6">
        {subtitle && <p className="text-[12px] text-white/80">{subtitle}</p>}
        <h1 className="font-display font-extrabold text-2xl">{title}</h1>
      </div>
      <KenteBar className="absolute bottom-0 left-0 right-0" />
    </header>
  );
}
