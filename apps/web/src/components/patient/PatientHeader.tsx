'use client';

import { KenteBar, LangSwitcher, StatusBar } from '@/components/ui';
import { HeaderLogout } from '@/components/auth/HeaderLogout';
import { cn } from '@/lib/cn';

/** En-tête sombre commun des écrans patient (bogolan sante-900 + kenté).
 *  Le fond reste plein-cadre ; le titre se recentre sur la même colonne que le
 *  contenu (`2xl` par défaut, `5xl` via `wide` pour les pages-grilles) afin que
 *  l'en-tête et le contenu soient alignés sur desktop. */
export function PatientHeader({ title, subtitle, wide = false }: { title: string; subtitle?: string; wide?: boolean }) {
  return (
    <header className="bg-sante-900 bogolan-dark relative pb-14 text-white">
      {/* StatusBar (heure + langue + déconnexion) sur mobile ; sur desktop
          ces actions sont portées par la TopNav. */}
      <div className="lg:hidden">
        <StatusBar dark right={<div className="flex items-center gap-2"><LangSwitcher dark /><HeaderLogout /></div>} />
      </div>
      <div className={cn('px-6 pt-2 lg:pt-6 lg:mx-auto lg:w-full', wide ? 'lg:max-w-5xl' : 'lg:max-w-2xl')}>
        {subtitle && <p className="text-[12px] text-white/80">{subtitle}</p>}
        <h1 className="font-display font-extrabold text-2xl">{title}</h1>
      </div>
      <KenteBar className="absolute bottom-0 left-0 right-0" />
    </header>
  );
}
