'use client';

import { useMemo } from 'react';

import { ProHeader } from '@/components/pro/ProHeader';
import { CardPagne } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { formatDate, formatTime } from '@/i18n/format';

interface AgendaItem {
  id: string;
  type: string;
  status: string;
  scheduledAt: string;
  patient?: { user?: { profile?: { firstName: string; lastName: string } | null } | null };
}

// D-15 — Agenda (7 jours).
export default function AgendaPage() {
  const { t } = useLocale();
  // Fenêtre 7 jours calculée à chaque montage (et non figée au chargement du
  // bundle) — sinon en PWA persistante l'agenda resterait bloqué sur le jour
  // d'ouverture de l'app.
  const { from, to } = useMemo(() => {
    const f = new Date();
    f.setHours(0, 0, 0, 0);
    const t2 = new Date(f);
    t2.setDate(t2.getDate() + 7);
    return { from: f.toISOString(), to: t2.toISOString() };
  }, []);
  const { data, loading, error } = useApi<AgendaItem[]>(
    () => get(`/appointments/agenda?from=${from}&to=${to}`),
    [from, to],
  );

  return (
    <>
      <ProHeader title={t('pro.agenda')} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6 lg:max-w-5xl lg:mx-auto lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('common.empty')} />}

        {(data ?? []).map((a) => {
          const p = a.patient?.user?.profile;
          return (
            <CardPagne key={a.id} className="p-4 flex items-center gap-3">
              <div className="text-center w-14 shrink-0">
                <p className="font-display font-extrabold text-indigo-700 text-[0.9375rem]">{formatTime(a.scheduledAt, { hour: '2-digit', minute: '2-digit' })}</p>
                <p className="text-[0.625rem] text-stone-400">{formatDate(a.scheduledAt, { day: '2-digit', month: '2-digit' })}</p>
              </div>
              <span className={`w-1 self-stretch rounded-full ${a.status === 'CONFIRMED' ? 'bg-indigo-500' : 'bg-ocre-400'}`} />
              <div className="flex-1">
                <p className="font-display font-bold text-[0.875rem]">{p ? `${p.firstName} ${p.lastName}` : t('role.PATIENT')}</p>
                <p className="text-[0.75rem] text-stone-400">{t(`appt.type.${a.type}`)} · {t(`appt.status.${a.status}`)}</p>
              </div>
            </CardPagne>
          );
        })}
      </main>
    </>
  );
}
