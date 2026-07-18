'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, Button, CardPagne } from '@/components/ui';
import { Empty, ErrorState , SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { formatDateTime } from '@/i18n/format';

interface Appointment {
  id: string;
  type: string;
  status: string;
  scheduledAt: string;
}

// D-14 — Dashboard médecin (file du jour + stats).
export default function ProDashboard() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<Appointment[]>(() => get('/appointments?pageSize=30'), []);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());

  const [confirmError, setConfirmError] = useState(false);

  const list = data ?? [];
  const stats = {
    total: list.length,
    pending: list.filter((a) => a.status === 'PENDING').length,
    confirmed: list.filter((a) => a.status === 'CONFIRMED').length,
  };

  async function confirm(id: string) {
    setConfirmError(false);
    // Optimiste : marquer confirmé puis rollback en cas d'échec (pas de faux positif).
    setConfirmed((s) => new Set(s).add(id));
    try {
      await post(`/appointments/${id}/confirm`);
    } catch {
      setConfirmed((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      setConfirmError(true);
    }
  }

  return (
    <>
      <ProHeader title={t('pro.dashboard')} subtitle={t('pro.dr')} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-5 pb-6 lg:max-w-5xl lg:mx-auto">
        <CardPagne stitch className="p-4 grid grid-cols-3 text-center divide-x divide-stone-200">
          {[
            [stats.total, t('pro.queue')],
            [stats.pending, t('pro.confirm')],
            [stats.confirmed, t('pro.live')],
          ].map(([n, label], i) => (
            <div key={i}>
              <p className="font-display font-extrabold text-2xl text-indigo-700">{n as number}</p>
              <p className="text-[0.6875rem] text-stone-400">{label as string}</p>
            </div>
          ))}
        </CardPagne>

        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/pro/messages"
            className="flex items-center gap-2 bg-white card-pagne border border-stone-200 px-4 py-3 font-display font-bold text-[0.8125rem] text-indigo-700"
          >
            <span aria-hidden>💬</span> {t('chat.title')}
          </Link>
          <Link
            href="/pro/results"
            className="flex items-center gap-2 bg-white card-pagne border border-stone-200 px-4 py-3 font-display font-bold text-[0.8125rem] text-indigo-700"
          >
            <span aria-hidden>🧪</span> {t('proresults.title')}
          </Link>
        </div>

        <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700">{t('pro.queue')}</h2>
        {confirmError && <p className="text-sos-600 font-bold text-[0.75rem]">{t('auth.error')}</p>}
        {loading && <SkeletonCards label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && list.length === 0 && <Empty label={t('common.empty')} />}

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((a) => (
            <CardPagne key={a.id} className="p-4 flex items-center gap-3">
              <span className={`w-1.5 self-stretch rounded-full ${a.status === 'CONFIRMED' ? 'bg-indigo-500' : 'bg-ocre-400'}`} />
              <div className="flex-1">
                <p className="font-display font-bold text-[0.875rem]">{t(`appt.type.${a.type}`)}</p>
                <p className="text-[0.75rem] text-stone-400">{formatDateTime(a.scheduledAt, { dateStyle: 'short', timeStyle: 'short' })}</p>
              </div>
              {a.status === 'PENDING' && !confirmed.has(a.id) ? (
                <Button variant="indigo" className="text-[0.75rem] px-3 py-1.5" onClick={() => confirm(a.id)}>
                  {t('pro.confirm')}
                </Button>
              ) : (
                <Badge variant="indigo">{t(`appt.status.${confirmed.has(a.id) ? 'CONFIRMED' : a.status}`)}</Badge>
              )}
            </CardPagne>
          ))}
        </div>
      </main>
    </>
  );
}
