'use client';

import { Badge, KenteBar, LangSwitcher, StatusBar } from '@/components/ui';
import { HeaderLogout } from '@/components/auth/HeaderLogout';
import { HeaderProfileLink } from '@/components/auth/HeaderProfileLink';

/** En-tête sombre de l'espace Médecin PRO (bogolan indigo-900 + badge PRO). */
export function ProHeader({ title, subtitle, profileHref = '/pro/profile' }: { title: string; subtitle?: string; profileHref?: string }) {
  return (
    <header className="bg-indigo-900 bogolan-dark relative pb-14 text-white">
      {/* StatusBar (heure + langue + déconnexion) sur mobile ; sur desktop
          ces actions sont portées par la TopNav. */}
      <div className="lg:hidden">
        <StatusBar dark right={<div className="flex items-center gap-2"><LangSwitcher dark />{profileHref && <HeaderProfileLink href={profileHref} />}<HeaderLogout /></div>} />
      </div>
      <div className="px-6 pt-2 lg:pt-6 flex items-center gap-2">
        <div className="flex-1">
          {subtitle && <p className="text-[12px] text-white/80">{subtitle}</p>}
          <h1 className="font-display font-extrabold text-2xl">{title}</h1>
        </div>
        <Badge variant="pro">PRO</Badge>
      </div>
      <KenteBar className="absolute bottom-0 left-0 right-0" />
    </header>
  );
}
