'use client';

import Link from 'next/link';

import { LangSwitcher, StatusBar } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { HeaderLogout } from '@/components/auth/HeaderLogout';
import { useLocale } from '@/i18n/LocaleProvider';
import { pharmacyApi, type Dispensation } from '@/lib/api/pharmacy';
import { useApi } from '@/lib/api/useApi';

// D-22b — Pharmacie : journal des délivrances effectuées (historique local).
export default function PharmacieHistoryPage() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<Dispensation[]>(() => pharmacyApi.dispensations(), []);

  return (
    <div className="flex-1 bg-nuit bogolan-dark text-white flex flex-col">
      {/* StatusBar mobile uniquement ; sur desktop, langue/déconnexion via la TopNav. */}
      <div className="lg:hidden">
        <StatusBar dark right={<div className="flex items-center gap-2"><LangSwitcher dark /><HeaderLogout /></div>} />
      </div>
      <div className="px-6 pt-2 pb-4 flex items-start justify-between gap-2">
        <div>
          <h1 className="font-display font-extrabold text-2xl">{t('pharmacie.history')}</h1>
          <p className="text-[12px] text-white/80">{t('pharmacie.history_sub')}</p>
        </div>
        <Link href="/pharmacie" className="card-pagne bg-white/15 border border-white/20 px-3 py-1.5 text-[12px] font-display font-bold">
          {t('common.back')}
        </Link>
      </div>

      <div className="px-6 flex-1 space-y-3 pb-6 lg:max-w-5xl lg:mx-auto lg:w-full lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 lg:items-start">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('common.load_error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('pharmacie.no_history')} />}

        {(data ?? []).map((d) => (
          <div key={d.id} className="bg-creme text-nuit card-pagne p-4">
            <div className="flex items-center justify-between">
              <span className="font-display font-extrabold text-[14px]">
                {d.patient ? `${d.patient.firstName} ${d.patient.lastName}` : '—'}
              </span>
              <span className="text-[12px] text-stone-500">
                {new Date(d.dispensedAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
              </span>
            </div>
            <p className="text-[12px] text-ocre-600 font-display font-bold mt-0.5">
              {t(`prescription.status.${d.status}`)}
            </p>
            <ul className="mt-2 space-y-1">
              {d.lines.map((l, i) => (
                <li key={i} className="flex items-center justify-between text-[13px]">
                  <span className="text-stone-700">{l.medicationName}</span>
                  <span className="text-stone-400">{t(`pharmacie.line.${l.status}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
