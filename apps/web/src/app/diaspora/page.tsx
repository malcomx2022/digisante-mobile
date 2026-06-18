'use client';

import Link from 'next/link';

import { CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { Empty, ErrorState, Skeleton } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { beneficiariesApi, type Beneficiary } from '@/lib/api/beneficiaries';
import { useApi } from '@/lib/api/useApi';

interface Wallet {
  balance: string | number;
  currency: string;
}

// D-20 — Dashboard diaspora (wallet + proches réels).
export default function DiasporaDashboard() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<Wallet>(() => get('/wallet'), []);
  const { data: family } = useApi<Beneficiary[]>(() => beneficiariesApi.list(), []);

  return (
    <>
      {/* TODO: le sous-titre (ville d'origine/résidence) devrait venir du profil diaspora, pas codé en dur. */}
      <SpaceHeader title={t('diaspora.title')} subtitle="Paris 🇫🇷 · Cotonou 🇧🇯" headerClass="bg-ocre-900" profileHref="/diaspora/profile" />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
        <CardPagne stitch className="p-5 bg-ocre-900 bogolan-dark text-white">
          <p className="text-[0.75rem] text-white/80">{t('wallet.balance')}</p>
          {loading ? (
            <Skeleton className="h-8 w-40 mt-1" />
          ) : error ? (
            <ErrorState label={t('auth.error')} />
          ) : (
            <p className="font-display font-extrabold text-3xl">
              {Number(data?.balance ?? 0).toLocaleString('fr-FR')} <span className="text-base">{data?.currency ?? 'XOF'}</span>
            </p>
          )}
          <Link href="/diaspora/wallet" className="inline-block mt-3 bg-ocre-400 text-stone-900 font-display font-bold card-pagne px-4 py-2 text-[0.8125rem]">
            {t('wallet.topup')}
          </Link>
        </CardPagne>

        <div className="flex items-center justify-between">
          <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700">{t('diaspora.family')}</h2>
          <Link href="/diaspora/beneficiaries" className="text-[0.75rem] text-ocre-700 font-display font-bold">
            {t('beneficiaries.manage')} →
          </Link>
        </div>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {(family ?? []).slice(0, 4).map((f, i) => (
            <CardPagne key={f.id} className={`p-4 flex items-center justify-between ${i % 2 ? '-rotate-1' : 'rotate-1'}`}>
              <div>
                <p className="font-display font-bold text-[0.875rem]">{f.name}</p>
                <p className="text-[0.75rem] text-stone-400">
                  {f.relationship ?? ''}{f.languagesSpoken.length > 0 ? ` · 🗣 ${f.languagesSpoken.join(' · ')}` : ''}
                </p>
              </div>
              <Link href="/diaspora/wallet" className="bg-ocre-400 text-stone-900 font-display font-bold card-pagne px-3 py-1.5 text-[0.75rem]">
                {t('beneficiaries.send_money')}
              </Link>
            </CardPagne>
          ))}
          {(family?.length ?? 0) === 0 && (
            <Link href="/diaspora/beneficiaries" className="block">
              <Empty label={t('beneficiaries.empty_cta')} />
            </Link>
          )}
        </div>
      </main>
    </>
  );
}
