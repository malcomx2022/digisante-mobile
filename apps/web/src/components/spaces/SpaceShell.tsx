'use client';

import type { Role } from '@digisante/shared';

import { useAuth } from '@/auth/AuthProvider';
import { Protected } from '@/components/auth/Protected';
import { Button, CardPagne, KenteBar, LangSwitcher, StatusBar } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';

// Coquille commune des espaces (thème par rôle). Les écrans D-xx arrivent en Phase 6.
export function SpaceShell({ role, titleKey, headerClass }: { role: Role; titleKey: string; headerClass: string }) {
  const { user, logout } = useAuth();
  const { t } = useLocale();

  return (
    <Protected role={role}>
      <div className="min-h-screen wax-light">
        <div className="mx-auto max-w-[420px] min-h-screen bg-creme flex flex-col shadow-xl">
          <header className={cn(headerClass, 'bogolan-dark relative pb-14 text-white')}>
            <StatusBar dark right={<LangSwitcher dark />} />
            <div className="px-6 pt-2">
              <p className="text-[0.75rem] text-white/70">{t(titleKey)}</p>
              <h1 className="font-display font-extrabold text-2xl">{t('space.welcome', { name: user?.phone ?? '' })}</h1>
            </div>
            <KenteBar className="absolute bottom-0 left-0 right-0" />
          </header>

          <main className="px-6 -mt-8 relative z-20 flex-1 pb-6">
            <CardPagne stitch className="p-5">
              <p className="text-sm text-stone-600">Espace en construction — écrans dédiés à venir (Phase 6).</p>
              <Button variant="outline" className="mt-4" onClick={logout}>
                {t('auth.logout')}
              </Button>
            </CardPagne>
          </main>
        </div>
      </div>
    </Protected>
  );
}
