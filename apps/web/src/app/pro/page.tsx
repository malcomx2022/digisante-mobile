'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, Button, CardPagne } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

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

  const list = data ?? [];
  const stats = {
    total: list.length,
    pending: list.filter((a) => a.status === 'PENDING').length,
    confirmed: list.filter((a) => a.status === 'CONFIRMED').length,
  };

  async function confirm(id: string) {
    setConfirmed((s) => new Set(s).add(id));
    try {
      await post(`/appointments/${id}/confirm`);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <ProHeader title={t('pro.dashboard')} subtitle="Dr" />
      <main className="px-6 -mt-10 relative z-20 space-y-5 pb-6">
        <CardPagne stitch className="p-4 grid grid-cols-3 text-center divide-x divide-stone-200">
          {[
            [stats.total, t('pro.queue')],
            [stats.pending, t('pro.confirm')],
            [stats.confirmed, t('pro.live')],
          ].map(([n, label], i) => (
            <div key={i}>
              <p className="font-display font-extrabold text-2xl text-indigo-700">{n as number}</p>
              <p className="text-[11px] text-stone-400">{label as string}</p>
            </div>
          ))}
        </CardPagne>

        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/pro/messages"
            className="flex items-center gap-2 bg-white card-pagne border border-stone-200 px-4 py-3 font-display font-bold text-[13px] text-indigo-700"
          >
            <span aria-hidden>💬</span> {t('chat.title')}
          </Link>
          <Link
            href="/pro/results"
            className="flex items-center gap-2 bg-white card-pagne border border-stone-200 px-4 py-3 font-display font-bold text-[13px] text-indigo-700"
          >
            <span aria-hidden>🧪</span> {t('proresults.title')}
          </Link>
        </div>

        <h2 className="font-display font-extrabold text-[14px] text-stone-700">{t('pro.queue')}</h2>
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && list.length === 0 && <Empty label={t('common.empty')} />}

        <div className="space-y-3">
          {list.map((a) => (
            <CardPagne key={a.id} className="p-4 flex items-center gap-3">
              <span className={`w-1.5 self-stretch rounded-full ${a.status === 'CONFIRMED' ? 'bg-sante-500' : 'bg-ocre-400'}`} />
              <div className="flex-1">
                <p className="font-display font-bold text-[14px]">{a.type === 'TELECONSULTATION' ? 'Téléconsultation' : 'Présentiel'}</p>
                <p className="text-[12px] text-stone-400">{new Date(a.scheduledAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p>
              </div>
              {a.status === 'PENDING' && !confirmed.has(a.id) ? (
                <Button variant="indigo" className="text-[12px] px-3 py-1.5" onClick={() => confirm(a.id)}>
                  {t('pro.confirm')}
                </Button>
              ) : (
                <Badge variant="indigo">{confirmed.has(a.id) ? 'CONFIRMED' : a.status}</Badge>
              )}
            </CardPagne>
          ))}
        </div>
      </main>
    </>
  );
}
