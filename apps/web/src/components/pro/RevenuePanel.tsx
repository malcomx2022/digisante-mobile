'use client';

import { useState } from 'react';
import { Button, CardPagne } from '@/components/ui';
import { ErrorState, SkeletonCards } from '@/components/ui/States';
import { formatNumber } from '@/i18n/format';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface RevenueStats {
  revenue: { gross: string; refunds: string; commission: string; net: string };
  paidInPeriod: string; balance: { due: string; reserved: string; available: string };
  activity: { scheduled: number; completed: number; cancelled: number; cancellationRate: number | null };
  satisfaction: { count: number; average: number | null }; legacyUnproven: number;
}

export default function RevenuePanel({ enabled, tick }: { enabled: boolean; tick: number }) {
  const { t } = useLocale();
  const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`); const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const stats = useApi(() => enabled ? get<RevenueStats>(`/professionals/me/revenue?${query}`) : Promise.resolve(null), [enabled, from, to, tick]);
  // Ne pas montrer l'ancien résultat pendant une nouvelle période/vérification.
  const data = enabled && !stats.loading && !stats.error ? stats.data : null;
  async function download() {
    if (busy) return; setBusy(true); setError(false);
    try {
      const result = await get<{ content: string; filename: string }>(`/professionals/me/revenue/export?${query}`);
      const url = URL.createObjectURL(new Blob([result.content], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = result.filename; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <CardPagne stitch="indigo" className="p-5 space-y-3">
    <h2 className="font-display font-extrabold text-indigo-900">{t('pro.revenue')}</h2>
    <p className="text-[0.875rem] text-stone-600">{t(enabled ? 'revenue.definition' : 'revenue.pro_required')}</p>
    {enabled && <>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[0.875rem] font-bold">{t('revenue.from')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block w-full min-w-0 p-2 text-base bg-white border border-indigo-200 pagne-focus" /></label>
        <label className="text-[0.875rem] font-bold">{t('revenue.to')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block w-full min-w-0 p-2 text-base bg-white border border-indigo-200 pagne-focus" /></label>
      </div>
      {stats.loading && <SkeletonCards count={1} />}
      {(stats.error || error) && <ErrorState label={t('revenue.error')} />}
      {data && <>
        <dl className="grid grid-cols-2 gap-3 text-[0.875rem]">
          {(['gross', 'refunds', 'commission', 'net'] as const).map((key) => <div key={key}><dt>{t(`revenue.${key}`)}</dt><dd className="font-display font-extrabold text-indigo-800">{formatNumber(data.revenue[key])} FCFA</dd></div>)}
          <div><dt>{t('revenue.paid_period')}</dt><dd>{formatNumber(data.paidInPeriod)} FCFA</dd></div>
          <div><dt>{t('revenue.due')}</dt><dd>{formatNumber(data.balance.due)} FCFA</dd></div>
          <div><dt>{t('revenue.reserved')}</dt><dd>{formatNumber(data.balance.reserved)} FCFA</dd></div>
          <div><dt>{t('revenue.available')}</dt><dd>{formatNumber(data.balance.available)} FCFA</dd></div>
        </dl>
        <p className="text-[0.75rem] text-stone-500">{t('revenue.balance_definition')}</p>
        <div className="nkyinkyim w-full opacity-30" />
        <p>{t('revenue.activity', { completed: data.activity.completed, total: data.activity.scheduled, cancelled: data.activity.cancelled })}</p>
        <p>{t('revenue.cancellation', { rate: data.activity.cancellationRate === null ? '—' : formatNumber(data.activity.cancellationRate * 100, { maximumFractionDigits: 1 }) })}</p>
        <p>{t('revenue.satisfaction', { count: data.satisfaction.count, average: data.satisfaction.average === null ? '—' : formatNumber(data.satisfaction.average, { maximumFractionDigits: 1 }) })}</p>
        {data.legacyUnproven > 0 && <p className="text-ocre-700 font-bold">{t('revenue.legacy', { count: data.legacyUnproven })}</p>}
        <Button variant="indigo" disabled={busy} onClick={() => void download()}>{t('revenue.export')}</Button>
        <p className="text-[0.75rem] text-stone-500">{t('revenue.csv_notice')}</p>
      </>}
    </>}
  </CardPagne>;
}
