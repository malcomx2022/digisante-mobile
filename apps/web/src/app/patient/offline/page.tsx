'use client';

import { useEffect, useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { CardPagne } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { allQueued, type QueuedMutation } from '@/lib/offline/queue';
import { useOnline } from '@/lib/offline/online';

const AVAILABLE = ['patient.quick.dmp', 'patient.quick.prescriptions', 'patient.quick.sos', 'reminders.title'];

// D-13 — Mode hors-ligne : disponibilités + file de synchronisation réelle.
export default function OfflinePage() {
  const { t } = useLocale();
  const online = useOnline();
  const [queue, setQueue] = useState<QueuedMutation[]>([]);

  useEffect(() => {
    let active = true;
    allQueued()
      .then((q) => active && setQueue(q))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [online]);

  return (
    <div className="flex-1 wax-ocre">
      <PatientHeader title={t('offline.title')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
        <div className="bg-ocre-400 trame-tissee text-stone-900 card-pagne px-4 py-2 text-center text-[0.8125rem] font-display font-bold">
          {online ? (
            <><span aria-hidden="true">🟢</span> En ligne</>
          ) : (
            <><span aria-hidden="true">🟠</span> {t('offline.banner')}</>
          )}
        </div>

        <CardPagne className="p-4">
          <p className="font-display font-extrabold text-[0.8125rem] text-stone-700 mb-2">{t('offline.available')}</p>
          <div className="grid grid-cols-2 gap-2">
            {AVAILABLE.map((k, i) => (
              <div key={k} className={`card-pagne bg-sante-50 text-sante-700 p-2 text-center text-[0.75rem] font-bold ${i % 2 ? '-rotate-1' : 'rotate-1'}`}>
                {t(k)}
              </div>
            ))}
          </div>
        </CardPagne>

        <CardPagne className="p-4">
          <p className="font-display font-extrabold text-[0.8125rem] text-stone-700 mb-2">
            {t('offline.queue')} {queue.length > 0 && `(${queue.length})`}
          </p>
          {queue.length === 0 ? (
            <p className="text-[0.8125rem] text-stone-400">{t('common.empty')}</p>
          ) : (
            queue.map((q) => (
              <div key={q.id} className="flex items-center justify-between py-1.5 border-b border-dashed border-stone-200 text-[0.75rem]">
                <span className="font-mono text-stone-600">{q.method} {q.path}</span>
                <span className="text-ocre-600" aria-hidden="true">⏳</span>
              </div>
            ))
          )}
        </CardPagne>

        <p className="text-center text-[0.75rem] text-sos-600 font-display font-bold"><span aria-hidden="true">⚠</span> {t('offline.sos_active')}</p>
      </main>
    </div>
  );
}
