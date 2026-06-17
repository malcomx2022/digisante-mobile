'use client';

import { useState } from 'react';
import Link from 'next/link';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { adherenceApi, type AdherenceToday } from '@/lib/api/adherence';
import { remindersApi, type MedicationReminder } from '@/lib/api/reminders';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

// Mon traitement — observance : traitements actifs, « j'ai pris » persistant,
// streak + % d'observance, et RAPPELS HORAIRES récurrents par traitement.
export default function AdherencePage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [remTick, setRemTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [timeInputs, setTimeInputs] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState(false);

  const { data, loading, error } = useApi<AdherenceToday>(() => adherenceApi.today(), [tick]);
  const { data: reminders } = useApi<MedicationReminder[]>(() => remindersApi.listMedication(), [remTick]);

  const remindersByItem = new Map<string, MedicationReminder[]>();
  for (const r of reminders ?? []) {
    if (!r.itemId) continue;
    const arr = remindersByItem.get(r.itemId) ?? [];
    arr.push(r);
    remindersByItem.set(r.itemId, arr);
  }

  async function take(itemId: string, name: string) {
    setBusy(itemId);
    setActionError(false);
    try {
      await adherenceApi.take(itemId, name);
      setTick((n) => n + 1);
    } catch {
      setActionError(true);
    } finally {
      setBusy(null);
    }
  }

  async function addTime(itemId: string, name: string) {
    const time = timeInputs[itemId];
    if (!time) return;
    setActionError(false);
    try {
      await remindersApi.addMedication({ itemId, medicationName: name, time });
      setTimeInputs((m) => ({ ...m, [itemId]: '' }));
      setRemTick((n) => n + 1);
    } catch {
      setActionError(true);
    }
  }

  async function removeTime(id: string) {
    setActionError(false);
    try {
      await remindersApi.removeMedication(id);
      setRemTick((n) => n + 1);
    } catch {
      setActionError(true);
    }
  }

  const treatments = data?.treatments ?? [];
  const s = data?.summary;

  return (
    <>
      <PatientHeader title={t('adherence.title')} subtitle={t('adherence.subtitle')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-3xl lg:mx-auto lg:w-full">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {actionError && <ErrorState label={t('auth.error')} />}

        {s && (
          <CardPagne stitch className="p-5">
            <div className="grid grid-cols-2 divide-x divide-stone-200 text-center">
              <div>
                <p className="font-display font-extrabold text-3xl text-sante-700 leading-none"><span aria-hidden="true">🔥</span> {s.streak}</p>
                <p className="text-[11px] text-stone-500 mt-1">{t('adherence.streak_label')}</p>
              </div>
              <div>
                <p className="font-display font-extrabold text-3xl text-indigo-700 leading-none">{s.adherence7}%</p>
                <p className="text-[11px] text-stone-500 mt-1">{t('adherence.percent_label')}</p>
              </div>
            </div>
          </CardPagne>
        )}

        {!loading && !error && treatments.length === 0 && (
          <CardPagne className="p-5 text-center">
            <Empty label={t('adherence.empty')} />
            <Nkyinkyim className="my-3" />
            <Link href="/patient/prescriptions" className="text-[13px] font-display font-bold text-sante-700 underline decoration-dotted">
              {t('prescriptions.title')}
            </Link>
          </CardPagne>
        )}

        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {treatments.map((tr) => {
          const times = remindersByItem.get(tr.itemId) ?? [];
          return (
            <CardPagne key={tr.itemId} className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-display font-bold text-[15px] text-stone-800 truncate">{tr.medicationName}</p>
                  <p className="text-[12px] text-stone-500">
                    {tr.dosage} · {tr.frequency}
                  </p>
                </div>
                {tr.takenToday ? (
                  <span className="shrink-0 card-pagne bg-sante-600 text-white font-display font-extrabold text-[12px] px-3 py-2">
                    <span aria-hidden="true">✓</span> {t('adherence.taken')}
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
              </div>

              {/* Rappels horaires du traitement */}
              <div className="mt-3 pt-3 border-t border-dashed border-stone-200 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-stone-500 font-display font-bold"><span aria-hidden="true">⏰</span> {t('adherence.reminders')}</span>
                {times.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => removeTime(r.id)}
                    aria-label={`${t('common.delete')} ${r.time}`}
                    className="card-pagne bg-creme-deep text-stone-700 text-[12px] font-bold px-2.5 py-1"
                  >
                    {r.time} <span aria-hidden="true">✕</span>
                  </button>
                ))}
                <input
                  type="time"
                  value={timeInputs[tr.itemId] ?? ''}
                  onChange={(e) => setTimeInputs((m) => ({ ...m, [tr.itemId]: e.target.value }))}
                  aria-label={t('adherence.add_time')}
                  className="bg-white card-pagne border border-stone-300 px-2 py-1 text-[12px] focus:outline-none focus:border-sante-600"
                />
                <button
                  type="button"
                  onClick={() => addTime(tr.itemId, tr.medicationName)}
                  aria-label={t('adherence.add_time')}
                  className="card-pagne bg-sante-600 text-white font-display font-extrabold text-[13px] px-2.5 py-1"
                >
                  <span aria-hidden="true">+</span>
                </button>
              </div>
            </CardPagne>
          );
        })}
        </div>
      </main>
    </>
  );
}
