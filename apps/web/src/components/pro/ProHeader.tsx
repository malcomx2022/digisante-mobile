'use client';

import { Badge, KenteBar, LangSwitcher, StatusBar } from '@/components/ui';

/** En-tête sombre de l'espace Médecin PRO (bogolan indigo-900 + badge PRO). */
export function ProHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="bg-indigo-900 bogolan-dark relative pb-14 text-white">
      <StatusBar dark right={<LangSwitcher dark />} />
      <div className="px-6 pt-2 flex items-center gap-2">
        <div className="flex-1">
          {subtitle && <p className="text-[12px] text-white/70">{subtitle}</p>}
          <h1 className="font-display font-extrabold text-2xl">{title}</h1>
        </div>
        <Badge variant="pro">PRO</Badge>
      </div>
      <KenteBar className="absolute bottom-0 left-0 right-0" />
    </header>
  );
}
