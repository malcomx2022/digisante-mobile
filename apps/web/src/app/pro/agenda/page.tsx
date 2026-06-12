'use client';

import { ProHeader } from '@/components/pro/ProHeader';
import { CardPagne } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface AgendaItem {
  id: string;
  type: string;
  status: string;
  scheduledAt: string;
  patient?: { user?: { profile?: { firstName: string; lastName: string } | null } | null };
}

const from = new Date();
from.setHours(0, 0, 0, 0);
const to = new Date(from);
to.setDate(to.getDate() + 7);

// D-15 — Agenda (7 jours).
export default function AgendaPage() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<AgendaItem[]>(
    () => get(`/appointments/agenda?from=${from.toISOString()}&to=${to.toISOString()}`),
    [],
  );

  return (
    <>
      <ProHeader title={t('pro.agenda')} />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('common.empty')} />}

        {(data ?? []).map((a) => {
          const p = a.patient?.user?.profile;
          return (
            <CardPagne key={a.id} className="p-4 flex items-center gap-3">
              <div className="text-center w-14 shrink-0">
                <p className="font-display font-extrabold text-indigo-700 text-[15px]">{new Date(a.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
                <p className="text-[10px] text-stone-400">{new Date(a.scheduledAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</p>
              </div>
              <span className={`w-1 self-stretch rounded-full ${a.status === 'CONFIRMED' ? 'bg-sante-500' : 'bg-ocre-400'}`} />
              <div className="flex-1">
                <p className="font-display font-bold text-[14px]">{p ? `${p.firstName} ${p.lastName}` : 'Patient'}</p>
                <p className="text-[12px] text-stone-400">{a.type === 'TELECONSULTATION' ? 'Téléconsultation' : 'Présentiel'} · {a.status}</p>
              </div>
            </CardPagne>
          );
        })}
      </main>
    </>
  );
}
