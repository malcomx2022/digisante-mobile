'use client';

import { useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { Empty, ErrorState , SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { dmpApi, type DmpRecord, type VitalReading } from '@/lib/api/dmp';
import { useApi } from '@/lib/api/useApi';
import { formatDate, formatDateTime } from '@/i18n/format';

// Auto-mesures (constantes) — le patient enregistre tension, pouls, glycémie,
// poids dans son DMP (chiffré au repos). Suivi chronologique pour les maladies
// chroniques (cf. recherche e-santé : « vitals self-tracking »).
function summarize(v: VitalReading, t: (k: string) => string): string {
  const parts: string[] = [];
  if (v.systolic != null && v.diastolic != null) parts.push(`${v.systolic}/${v.diastolic} mmHg`);
  if (v.pulse != null) parts.push(`${v.pulse} bpm`);
  if (v.glucose != null) parts.push(`${v.glucose} g/L`);
  if (v.weight != null) parts.push(`${v.weight} kg`);
  return parts.join(' · ') || t('vitals.empty');
}

export default function VitalsPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useApi<DmpRecord[]>(() => dmpApi.vitals(), [tick]);

  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [glucose, setGlucose] = useState('');
  const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

  async function save() {
    const reading: VitalReading = {
      systolic: num(systolic),
      diastolic: num(diastolic),
      pulse: num(pulse),
      glucose: num(glucose),
      weight: num(weight),
      measuredAt: new Date().toISOString(),
    };
    const hasValue = [reading.systolic, reading.diastolic, reading.pulse, reading.glucose, reading.weight].some(
      (x) => x != null && !Number.isNaN(x),
    );
    if (!hasValue) return;
    setSaving(true);
    setSaved(false);
    setSaveError(false);
    try {
      await dmpApi.addVital(reading);
      setSystolic('');
      setDiastolic('');
      setPulse('');
      setGlucose('');
      setWeight('');
      setSaved(true);
      setTick((n) => n + 1);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  // Bornage temporel de l'historique (réseaux/mobiles d'entrée de gamme) :
  // par défaut 30 jours pour éviter de rendre des centaines de mesures d'un coup.
  const [periodDays, setPeriodDays] = useState<number>(30);

  const readings = (data ?? []).map((r) => ({ id: r.id, when: r.createdAt, v: (r.data ?? {}) as VitalReading }));
  const latest = readings[0]; // toujours la plus récente (indépendante du filtre)
  const periodStart = periodDays === 0 ? 0 : Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const inPeriod = readings.filter((r) => periodDays === 0 || new Date(r.when).getTime() >= periodStart);
  const history = inPeriod.slice(1); // exclut la « dernière mesure » déjà mise en évidence

  const periods: { days: number; label: string }[] = [
    { days: 7, label: t('vitals.period.7') },
    { days: 30, label: t('vitals.period.30') },
    { days: 365, label: t('vitals.period.365') },
    { days: 0, label: t('vitals.period.all') },
  ];

  const field = (label: string, value: string, set: (v: string) => void, ph: string) => (
    <label className="block">
      <span className="font-display font-bold text-[0.75rem] text-stone-600">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={ph}
        className="mt-1 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-sante-600"
      />
    </label>
  );

  return (
    <>
      <PatientHeader title={t('vitals.title')} subtitle={t('vitals.subtitle')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
        {/* Saisie d'une mesure */}
        <CardPagne className="p-4 space-y-3">
          <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('vitals.add')}</p>
          <div className="grid grid-cols-2 gap-2">
            {field(t('vitals.systolic'), systolic, setSystolic, '120')}
            {field(t('vitals.diastolic'), diastolic, setDiastolic, '80')}
            {field(t('vitals.pulse'), pulse, setPulse, '72')}
            {field(t('vitals.glucose'), glucose, setGlucose, '0.9')}
          </div>
          {field(t('vitals.weight'), weight, setWeight, '70')}
          {saved && <p className="text-sante-700 font-display font-bold text-[0.8125rem]">{t('vitals.saved')}</p>}
          {saveError && <p className="text-sos-600 font-display font-bold text-[0.8125rem]">{t('auth.error')}</p>}
          <Button variant="sante" full disabled={saving} onClick={save}>
            {saving ? t('common.loading') : t('vitals.save')}
          </Button>
        </CardPagne>

        {/* Dernière mesure en évidence */}
        {latest && (
          <CardPagne stitch className="p-4">
            <p className="text-[0.75rem] text-stone-500 font-display font-bold uppercase tracking-wide">{t('vitals.latest')}</p>
            <p className="font-display font-extrabold text-[1.125rem] text-sante-700 mt-1">{summarize(latest.v, t)}</p>
            <p className="text-[0.75rem] text-stone-400">{formatDateTime(latest.when, { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </CardPagne>
        )}

        {loading && <SkeletonCards count={3} columns={false} label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && readings.length === 0 && <Empty label={t('vitals.empty')} />}

        {/* Historique — borné par période pour limiter le rendu sur mobile */}
        {readings.length > 1 && (
          <CardPagne className="p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('vitals.history')}</p>
              <div className="flex gap-1" role="group" aria-label={t('vitals.period_label')}>
                {periods.map((p) => (
                  <button
                    key={p.days}
                    type="button"
                    onClick={() => setPeriodDays(p.days)}
                    aria-pressed={periodDays === p.days}
                    className={[
                      'card-pagne px-2 py-1 text-[0.6875rem] font-display font-bold transition',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600',
                      periodDays === p.days ? 'bg-sante-600 text-white' : 'bg-stone-100 text-stone-600',
                    ].join(' ')}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <Nkyinkyim className="my-3" />
            {history.length === 0 ? (
              <p className="text-[0.75rem] text-stone-400 text-center py-2">{t('vitals.history_empty_period')}</p>
            ) : (
              <div className="space-y-2">
                {history.map((r) => (
                  <div key={r.id} className="flex items-center justify-between border-b border-dashed border-stone-200 pb-1.5">
                    <span className="text-[0.8125rem] text-stone-700 font-bold">{summarize(r.v, t)}</span>
                    <span className="text-[0.6875rem] text-stone-400">{formatDate(r.when, { dateStyle: 'short' })}</span>
                  </div>
                ))}
              </div>
            )}
          </CardPagne>
        )}
      </main>
    </>
  );
}
