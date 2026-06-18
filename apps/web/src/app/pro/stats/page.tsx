'use client';

import { useState } from 'react';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, Button, CardPagne, ConfirmDialog } from '@/components/ui';
import { ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { SUBSCRIPTION_PLANS } from '@digisante/shared';

interface Sub {
  subscriptionPlan: string;
  subscriptionStatus: string;
}

// D-18 — Statistiques & revenus + abonnement professionnel.
export default function ProStatsPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [subError, setSubError] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const { data, loading, error } = useApi<Sub>(() => get('/subscriptions/me'), [tick]);

  // Changement d'abonnement potentiellement payant → confirmation explicite.
  function subscribe(plan: string) {
    if (busy) return; // anti-double-clic
    if (data?.subscriptionPlan === plan) return;
    setSubError(false);
    setPendingPlan(plan);
  }

  async function confirmSubscribe() {
    if (!pendingPlan) return;
    setBusy(true);
    setSubError(false);
    try {
      await post('/subscriptions', { plan: pendingPlan });
      setPendingPlan(null);
      setTick((x) => x + 1);
    } catch {
      setSubError(true);
      setPendingPlan(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ProHeader title={t('pro.stats')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
        {/* Revenus — agrégation revenus pro non encore disponible. On n'affiche
            AUCUN chiffre inventé : état explicite « indisponible / à venir ». */}
        <CardPagne stitch="indigo" className="p-5 bg-indigo-900 bogolan-dark text-white">
          <p className="text-[0.75rem] text-white/70">{t('pro.revenue')}</p>
          <p className="font-display font-extrabold text-xl">{t('pro.revenue_unavailable')}</p>
          <p className="text-[0.75rem] text-ocre-300 mt-1">{t('pro.revenue_soon')} · {t('pro.commission')}</p>
        </CardPagne>

        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}

        {!loading && !error && (
          <CardPagne className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('pro.plan')}</p>
              {data && <Badge variant="pro">{data.subscriptionPlan}</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SUBSCRIPTION_PLANS.map((p) => (
                <Button
                  key={p}
                  variant={data?.subscriptionPlan === p ? 'indigo' : 'outline'}
                  className="text-[0.75rem] py-2"
                  disabled={busy}
                  onClick={() => subscribe(p)}
                >
                  {p}
                </Button>
              ))}
            </div>
            {subError && <p className="text-sos-600 font-bold text-[0.75rem] mt-2">{t('auth.error')}</p>}
          </CardPagne>
        )}
      </main>

      <ConfirmDialog
        open={!!pendingPlan}
        busy={busy}
        title={t('pro.plan')}
        message={t('pro.plan_change_confirm')}
        confirmLabel={pendingPlan ?? ''}
        onConfirm={confirmSubscribe}
        onCancel={() => setPendingPlan(null)}
      />
    </>
  );
}
