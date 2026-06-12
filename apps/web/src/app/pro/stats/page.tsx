'use client';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, Button, CardPagne } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { SUBSCRIPTION_PLANS } from '@digisante/shared';
import { post } from '@/lib/api/client';
import { useState } from 'react';

interface Sub {
  subscriptionPlan: string;
  subscriptionStatus: string;
}

// D-18 — Statistiques & revenus + abonnement professionnel.
export default function ProStatsPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const { data } = useApi<Sub>(() => get('/subscriptions/me'), [tick]);

  async function subscribe(plan: string) {
    await post('/subscriptions', { plan }).catch(() => {});
    setTick((x) => x + 1);
  }

  return (
    <>
      <ProHeader title={t('pro.stats')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        {/* Revenus (présentationnel — agrégation revenus pro à venir) */}
        <CardPagne stitch="indigo" className="p-5 bg-indigo-900 bogolan-dark text-white">
          <p className="text-[12px] text-white/70">{t('pro.revenue')}</p>
          <p className="font-display font-extrabold text-3xl">142 500 <span className="text-base">F</span></p>
          <p className="text-[12px] text-ocre-300 mt-1">+18% · {t('pro.commission')}</p>
        </CardPagne>

        <CardPagne className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-display font-extrabold text-[13px] text-stone-700">{t('pro.plan')}</p>
            {data && <Badge variant="pro">{data.subscriptionPlan}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SUBSCRIPTION_PLANS.map((p) => (
              <Button key={p} variant={data?.subscriptionPlan === p ? 'indigo' : 'outline'} className="text-[12px] py-2" onClick={() => subscribe(p)}>
                {p}
              </Button>
            ))}
          </div>
        </CardPagne>
      </main>
    </>
  );
}
