'use client';

import { useState } from 'react';
import Link from 'next/link';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { adherenceApi, type AdherenceToday } from '@/lib/api/adherence';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

// Mon traitement — observance médicamenteuse : traitements actifs, « j'ai pris »
// persistant, streak et % d'observance (suivi des maladies chroniques).
export default function AdherencePage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, loading, error } = useApi<AdherenceToday>(() => adherenceApi.today(), [tick]);

  async function take(itemId: string, name: string) {
    setBusy(itemId);
    try {
      await adherenceApi.take(itemId, name);
      setTick((n) => n + 1);
    } catch {
      /* best-effort */
    } finally {
      setBusy(null);
    }
  }

  const treatments = data?.treatments ?? [];
  const s = data?.summary;

  return (
    <>
      <PatientHeader title={t('adherence.title')} subtitle={t('adherence.subtitle')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}

        {/* Résumé : streak + observance 7 jours */}
        {s && (
          <CardPagne stitch className="p-5">
            <div className="grid grid-cols-2 divide-x divide-stone-200 text-center">
              <div>
                <p className="font-display font-extrabold text-3xl text-sante-700 leading-none">🔥 {s.streak}</p>
                <p className="text-[11px] text-stone-500 mt-1">{t('adherence.streak_label')}</p>
              </div>
              <div>
                <p className="font-display font-extrabold text-3xl text-indigo-700 leading-none">{s.adherence7}%</p>
                <p className="text-[11px] text-stone-500 mt-1">{t('adherence.percent_label')}</p>
              </div>
            </div>
          </CardPagne>
        )}

        {/* Traitements du jour */}
        {!loading && !error && treatments.length === 0 && (
          <CardPagne className="p-5 text-center">
            <Empty label={t('adherence.empty')} />
            <Nkyinkyim className="my-3" />
            <Link href="/patient/prescriptions" className="text-[13px] font-display font-bold text-sante-700 underline decoration-dotted">
              {t('prescriptions.title')}
            </Link>
          </CardPagne>
        )}

        {treatments.map((tr) => (
          <CardPagne key={tr.itemId} className="p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-[15px] text-stone-800 truncate">{tr.medicationName}</p>
              <p className="text-[12px] text-stone-500">
                {tr.dosage} · {tr.frequency}
              </p>
            </div>
            {tr.takenToday ? (
              <span className="shrink-0 card-pagne bg-sante-600 text-white font-display font-extrabold text-[12px] px-3 py-2">
                ✓ {t('adherence.taken')}
              </span>
            ) : (
              <Button
                variant="sante"
                className={cn('shrink-0 text-[12px] px-3 py-2', busy === tr.itemId && 'opacity-60')}
                onClick={() => take(tr.itemId, tr.medicationName)}
              >
                {t('adherence.take')}
              </Button>
            )}
          </CardPagne>
        ))}
      </main>
    </>
  );
}
