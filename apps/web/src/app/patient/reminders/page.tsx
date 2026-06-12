'use client';

import { useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Button, CardPagne } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface Reminder {
  id: string;
  title: string;
  body: string;
  status: string;
  scheduledAt: string | null;
}

// D-09 — Rappels de traitement (observance).
export default function RemindersPage() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<Reminder[]>(() => get('/reminders'), []);
  const [taken, setTaken] = useState<Set<string>>(new Set());

  async function markTaken(id: string) {
    setTaken((s) => new Set(s).add(id));
    try {
      await post(`/notifications/${id}/read`);
    } catch {
      /* hors-ligne → file */
    }
  }

  return (
    <>
      <PatientHeader title={t('reminders.title')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('common.empty')} />}

        {(data ?? []).map((r) => (
          <CardPagne key={r.id} stitch={taken.has(r.id) ? false : true} className="p-4">
            <p className="font-display font-extrabold text-[14px] text-stone-800">{r.title}</p>
            <p className="text-[13px] text-stone-500">{r.body}</p>
            {r.scheduledAt && (
              <p className="text-[12px] text-ocre-600 mt-1">
                ⏰ {new Date(r.scheduledAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            )}
            <div className="flex gap-2 mt-3">
              <Button variant="sante" className="text-[13px] px-3 py-2" onClick={() => markTaken(r.id)} disabled={taken.has(r.id)}>
                ✓ {t('reminders.taken')}
              </Button>
              <Button variant="outline" className="text-[13px] px-3 py-2">
                {t('reminders.snooze')}
              </Button>
            </div>
          </CardPagne>
        ))}
      </main>
    </>
  );
}
