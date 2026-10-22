'use client';

import { useEffect, useRef, useState } from 'react';
import { DOCTOR_SUBSCRIPTION_CATALOG, type DoctorSubscription, type PaymentMethod } from '@digisante/shared';
import { ProHeader } from '@/components/pro/ProHeader';
import RevenuePanel from '@/components/pro/RevenuePanel';
import { PaymentReceipt } from '@/components/ui/PaymentReceipt';
import { Badge, Button, CardPagne, ConfirmDialog } from '@/components/ui';
import { ErrorState, SkeletonCards } from '@/components/ui/States';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, postNow } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

import { SUBSCRIPTION_METHODS, subscriptionOutcome, type SubscriptionCheckout as Checkout } from '@/lib/subscriptions';

interface SubscriptionHistory { id: string; amount: string; startsAt: string | null; endsAt: string | null; revokedAt: string | null; payment: { id: string; status: string } }

// D-18 — revenus L7 propres au médecin ; abonnement L6 à renouvellement manuel.
export default function ProStatsPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<'PRO' | 'FREE' | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('MTN_MOMO');
  const request = useRef<{ id: string; method: PaymentMethod } | null>(null);
  const running = useRef(false);
  const { data, loading, error } = useApi(() => Promise.all([
    get<DoctorSubscription>('/subscriptions/me'), get<typeof DOCTOR_SUBSCRIPTION_CATALOG>('/subscriptions/catalog'), get<SubscriptionHistory[]>('/subscriptions/history'),
  ]).then(([subscription, catalog, history]) => ({ subscription, catalog, history })), [tick]);
  const sub = data?.subscription;
  const offer = data?.catalog.plans.find((p) => p.plan === 'PRO');

  useEffect(() => {
    const refresh = () => setTick((n) => n + 1);
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);

  function receive(result: Checkout) {
    const outcome = subscriptionOutcome(result);
    if (outcome.kind === 'redirect') window.location.assign(outcome.url);
    else setNotice(t(`subscriptions.${outcome.kind}`));
  }
  async function execute(resume = false) {
    if (running.current) return;
    running.current = true; setBusy(true); setNotice(null);
    try {
      if (resume && sub?.pending) receive(await get<Checkout>(`/subscriptions/${sub.pending.id}/checkout`));
      else if (action === 'FREE') { await postNow('/subscriptions', { plan: 'FREE' }); setNotice(t('subscriptions.cancelled')); }
      else if (action === 'PRO') {
        if (!request.current || request.current.method !== method) request.current = { id: crypto.randomUUID(), method };
        const result = await postNow<Checkout>('/subscriptions', { plan: 'PRO', method, requestId: request.current.id });
        request.current = null; receive(result);
      }
    } catch { setNotice(t('subscriptions.error')); }
    finally { running.current = false; setBusy(false); setAction(null); setTick((n) => n + 1); }
  }

  return <>
    <ProHeader title={t('pro.stats')} />
    <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
      <RevenuePanel enabled={Boolean(sub?.rights.revenueStats) && !error && !loading} tick={tick} />
      {loading && !data && <SkeletonCards count={2} />}
      {error && <ErrorState label={t('subscriptions.error')} />}
      {data && sub && <CardPagne className="p-4 space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-display font-extrabold text-stone-700">{t('pro.plan')}</h2><Badge variant="pro">{sub.subscriptionPlan}</Badge></div>
        <p>{t(`subscriptions.status_${sub.subscriptionStatus.toLowerCase()}`)}</p>
        {sub.currentPeriodEnd && <p>{t('subscriptions.until', { date: formatDateTime(sub.currentPeriodEnd, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }) })}</p>}
        <p className="text-[0.875rem] text-stone-600">{t('subscriptions.manual')}</p>
        {sub.cancelAtPeriodEnd && <p>{t('subscriptions.cancelled')}</p>}
        <div className="nkyinkyim w-full opacity-30" />
        <p className="font-display font-extrabold">{t('subscriptions.price', { amount: formatNumber(offer?.amount ?? 0) })}</p>
        <p className="text-[0.875rem]">{t('subscriptions.rights')}</p>
        <label className="block font-bold" htmlFor="subscription-method">{t('subscriptions.method')}</label>
        <select id="subscription-method" value={method} disabled={busy || Boolean(sub.pending)} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full p-3 border border-indigo-200 bg-white text-[1rem] focus-visible:ring-2 focus-visible:ring-indigo-600">
          {SUBSCRIPTION_METHODS.map((value) => <option key={value} value={value}>{t(`subscriptions.method_${value.toLowerCase()}`)}</option>)}
        </select>
        {sub.pending ? <>
          <p>{t('subscriptions.pending')}</p>
          <Button variant="indigo" full disabled={busy || Boolean(error)} onClick={() => void execute(true)}>{t('subscriptions.resume')}</Button>
        </> : <Button variant="indigo" full disabled={busy || !offer || Boolean(error)} onClick={() => setAction('PRO')}>{t(sub.subscriptionPlan === 'PRO' ? 'subscriptions.renew' : 'subscriptions.pay')}</Button>}
        {(sub.subscriptionPlan === 'PRO' && !sub.cancelAtPeriodEnd || sub.pending) && <Button variant="outline" full disabled={busy || Boolean(error)} onClick={() => setAction('FREE')}>{t(sub.pending ? 'subscriptions.cancel_pending' : 'subscriptions.cancel')}</Button>}
      </CardPagne>}
      {data && data.history.length > 0 && <CardPagne className="p-4 space-y-3">
        <h2 className="font-display font-extrabold">{t('subscriptions.history')}</h2>
        {data.history.slice(0, 10).map((order) => <div key={order.id} className="border-b border-dashed border-stone-200 pb-3 text-[0.875rem] break-words">
          <p>{formatNumber(order.amount)} FCFA · {t(`subscriptions.payment_${order.payment.status.toLowerCase()}`)}</p>
          {order.endsAt && <p>{t('subscriptions.until', { date: formatDateTime(order.endsAt, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }) })}</p>}
          <p>{t('subscriptions.reference', { id: order.payment.id })}</p>
          {['COMPLETED', 'REFUNDED'].includes(order.payment.status) && <PaymentReceipt paymentId={order.payment.id} />}
          {order.revokedAt && order.payment.status === 'COMPLETED' && <p className="font-bold text-sos-600">{t('subscriptions.abandoned')}</p>}
        </div>)}
      </CardPagne>}
      {notice && <p role="status" className="text-[0.875rem] font-bold text-indigo-700">{notice}</p>}
    </main>
    <ConfirmDialog open={action !== null} busy={busy} title={t('pro.plan')} message={action === 'FREE' ? t(sub?.pending ? 'subscriptions.cancel_pending_confirm' : 'subscriptions.cancel_confirm') : t('subscriptions.confirm', { amount: formatNumber(offer?.amount ?? 0) })} confirmLabel={t(action === 'FREE' ? 'subscriptions.confirm_cancel' : 'subscriptions.pay')} onConfirm={() => void execute()} onCancel={() => !busy && setAction(null)} />
  </>;
}
