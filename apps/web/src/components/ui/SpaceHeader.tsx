'use client';

import { KenteBar, LangSwitcher, StatusBar } from '@/components/ui';
import { HeaderLogout } from '@/components/auth/HeaderLogout';
import { HeaderProfileLink } from '@/components/auth/HeaderProfileLink';
import { cn } from '@/lib/cn';

/** En-tête sombre générique (thème passé via headerClass). */
export function SpaceHeader({
  title,
  subtitle,
  headerClass = 'bg-ocre-900',
  profileHref,
}: {
  title: string;
  subtitle?: string;
  headerClass?: string;
  /** Si fourni, ajoute un lien icône vers l'écran profil de l'espace. */
  profileHref?: string;
}) {
  return (
    <header className={cn(headerClass, 'bogolan-dark relative pb-14 text-white')}>
      <StatusBar dark right={<div className="flex items-center gap-2"><LangSwitcher dark />{profileHref && <HeaderProfileLink href={profileHref} />}<HeaderLogout /></div>} />
      <div className="px-6 pt-2">
        {subtitle && <p className="text-[12px] text-white/70">{subtitle}</p>}
        <h1 className="font-display font-extrabold text-2xl">{title}</h1>
      </div>
      <KenteBar className="absolute bottom-0 left-0 right-0" />
    </header>
  );
}
