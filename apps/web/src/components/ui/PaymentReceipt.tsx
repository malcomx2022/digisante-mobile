'use client';
import { useState } from 'react';
import { Button } from './Button';
import { get } from '@/lib/api/client';
import { useLocale } from '@/i18n/LocaleProvider';
import { formatDateTime, formatNumber } from '@/i18n/format';

interface Receipt { id: string; amount: string; currency: string; status: string; createdAt: string; confirmedAt: string | null }
export function PaymentReceipt({ paymentId }: { paymentId: string }) {
  const { t } = useLocale(); const [data, setData] = useState<Receipt | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  async function load() {
    setBusy(true); setError(false); setData(null);
    try { setData(await get<Receipt>(`/payments/${paymentId}/receipt`)); } catch { setError(true); } finally { setBusy(false); }
  }
  return <div className="space-y-2 text-[0.875rem]">
    <Button variant="outline" disabled={busy} onClick={() => void load()}>{t('revenue.receipt')}</Button>
    {error && <p role="alert">{t('revenue.error')}</p>}
    {data && <div aria-live="polite" className="border border-dashed border-stone-300 p-3 break-words">
      <p className="font-bold">{t('revenue.non_fiscal')}</p>
      <p>{t('subscriptions.reference', { id: data.id })}</p>
      <p>{formatNumber(data.amount)} {data.currency} · {t(`subscriptions.payment_${data.status.toLowerCase()}`)}</p>
      <p>{t(data.confirmedAt ? 'revenue.confirmed_at' : 'revenue.created_at', { date: formatDateTime(data.confirmedAt ?? data.createdAt, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }) })}</p>
    </div>}
  </div>;
}
