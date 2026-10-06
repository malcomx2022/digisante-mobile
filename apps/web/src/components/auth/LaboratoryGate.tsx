'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { laboratoryKycApi } from '@/lib/api/laboratoryKyc';
import { useApi } from '@/lib/api/useApi';

// Le serveur reste l'autorité ; cette porte explique le prérequis dans le parcours.
export function LaboratoryGate({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const { data, loading, error } = useApi(laboratoryKycApi.profile);
  if (!loading && !error && data?.canProcess) return <>{children}</>;
  return <>
    <SpaceHeader title={t('labo.title')} headerClass="bg-ocre-900" profileHref="/labo/profile" />
    <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-2xl lg:mx-auto">
      {loading ? <Loading label={t('common.loading')} /> : error ? <ErrorState label={t('auth.error')} /> :
        <CardPagne className="p-4 space-y-3" stitch="terre">
          <p className="font-display font-extrabold">{t('labkyc.required')}</p>
          <p className="text-sm text-stone-600">{t('labkyc.blocked')}</p>
          <Link href="/labo/kyc" className="block text-center bg-ocre-400 card-pagne py-3 font-display font-extrabold">{t('labkyc.title')}</Link>
        </CardPagne>}
    </main>
  </>;
}
