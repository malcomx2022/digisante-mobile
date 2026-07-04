'use client';

import Link from 'next/link';

import { ADMIN_NAV, NavIcon } from '@/components/spaces/AdminShell';
import { CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { useLocale } from '@/i18n/LocaleProvider';
import { adminsApi } from '@/lib/api/admins';
import { useApi } from '@/lib/api/useApi';

// Menu mobile du back-office : liste TOUTES les sections accessibles (gated par
// scope). La BottomNav n'a que 4 emplacements + FAB — cette page garantit
// qu'aucune destination admin n'est orpheline sur téléphone.
export default function AdminMenu() {
  const { t } = useLocale();
  const me = useApi(() => adminsApi.me(), []);
  const scopes = me.data?.scopes;
  const items = ADMIN_NAV.filter((it) => !it.scope || !scopes || scopes.includes(it.scope));

  return (
    <>
      <SpaceHeader title={t('admin.menu')} subtitle={t('admin.backoffice')} headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
        <div className="grid grid-cols-2 gap-3">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600 card-pagne"
            >
              <CardPagne className="p-4 flex items-center gap-3 h-full">
                <span className="w-9 h-9 card-pagne bg-indigo-50 text-indigo-700 grid place-items-center shrink-0" aria-hidden="true">
                  <NavIcon name={it.icon} />
                </span>
                <span className="font-display font-bold text-[0.8125rem] text-stone-800">{t(it.labelKey)}</span>
              </CardPagne>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
