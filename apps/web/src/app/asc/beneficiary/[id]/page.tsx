'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { ErrorState, SkeletonCards } from '@/components/ui/States';
import { formatDateTime } from '@/i18n/format';
import { useLocale } from '@/i18n/LocaleProvider';
import { type AscBeneficiaryDetail, type AscObservation, ascApi } from '@/lib/api/asc';
import { type DoctorListItem, professionalsApi } from '@/lib/api/professionals';
import { useApi } from '@/lib/api/useApi';

const TRIAGE = ['', 'EMERGENCY', 'CONSULT', 'HOME'] as const;

function obsSummary(o: AscObservation, t: (k: string) => string): string {
  const p: string[] = [];
  if (o.systolic != null && o.diastolic != null) p.push(`${o.systolic}/${o.diastolic} mmHg`);
  if (o.pulse != null) p.push(`${o.pulse} bpm`);
  if (o.temperature != null) p.push(`${o.temperature}°C`);
  if (o.weight != null) p.push(`${o.weight} kg`);
  if (o.triageOutcome) p.push(t(`triage.outcome.${o.triageOutcome}.title`));
  return p.join(' · ');
}

export default function AscBeneficiaryPage() {
  const { t } = useLocale();
  const params = useParams();
  const id = String(params.id);
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useApi<AscBeneficiaryDetail>(() => ascApi.get(id), [tick, id]);
  const doctors = useApi<{ data: DoctorListItem[] }>(() => professionalsApi.list({}), []);

  // Observation
  const [num, setNum] = useState<Record<string, string>>({});
  const [triage, setTriage] = useState('');
  const [note, setNote] = useState('');
  const [savingObs, setSavingObs] = useState(false);
  const n = (k: string) => (num[k]?.trim() ? Number(num[k]) : undefined);

  // Signalement
  const [doctorId, setDoctorId] = useState('');
  const [message, setMessage] = useState('');
  const [relaying, setRelaying] = useState(false);
  const [relayed, setRelayed] = useState(false);

  async function addObs() {
    setSavingObs(true);
    try {
      await ascApi.addObservation(id, {
        systolic: n('systolic'), diastolic: n('diastolic'), pulse: n('pulse'), temperature: n('temperature'), weight: n('weight'),
        triageOutcome: (triage || undefined) as AscObservation['triageOutcome'],
        note: note.trim() || undefined,
      });
      setNum({});
      setTriage('');
      setNote('');
      setTick((x) => x + 1);
    } finally {
      setSavingObs(false);
    }
  }

  async function relay() {
    if (!doctorId || !message.trim()) return;
    setRelaying(true);
    try {
      await ascApi.relay(id, doctorId, message.trim());
      setMessage('');
      setDoctorId('');
      setRelayed(true);
    } finally {
      setRelaying(false);
    }
  }

  const field = (k: string, label: string) => (
    <label className="block">
      <span className="text-[0.625rem] text-stone-500">{label}</span>
      <input inputMode="decimal" value={num[k] ?? ''} onChange={(e) => setNum((v) => ({ ...v, [k]: e.target.value }))} className="mt-0.5 w-full bg-white card-pagne border border-stone-300 px-2 py-1.5 text-base focus:outline-none focus:border-sante-600" />
    </label>
  );

  return (
    <>
      <SpaceHeader title={data?.name ?? t('asc.beneficiary')} subtitle={data?.village ?? undefined} headerClass="bg-sante-900" />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
        <Link href="/asc" className="inline-block text-[0.75rem] font-display font-bold text-sante-700">‹ {t('common.back')}</Link>
        {loading && !data && <SkeletonCards label={t('common.loading')} />}
        {error && <ErrorState label={t('common.load_error')} />}

        {data && (
          <>
            {/* Nouvelle observation */}
            <CardPagne stitch className="p-4">
              <h2 className="font-display font-extrabold text-[0.9375rem] text-sante-800">{t('asc.new_obs')}</h2>
              <Nkyinkyim className="my-2" />
              <div className="grid grid-cols-2 gap-2">
                {field('systolic', t('asc.systolic'))}
                {field('diastolic', t('asc.diastolic'))}
                {field('pulse', t('asc.pulse'))}
                {field('temperature', t('asc.temperature'))}
                {field('weight', t('asc.weight'))}
                <label className="block">
                  <span className="text-[0.625rem] text-stone-500">{t('asc.triage')}</span>
                  <select value={triage} onChange={(e) => setTriage(e.target.value)} className="mt-0.5 w-full bg-white card-pagne border border-stone-300 px-2 py-1.5 text-base focus:outline-none focus:border-sante-600">
                    {TRIAGE.map((x) => <option key={x} value={x}>{x ? t(`triage.outcome.${x}.title`) : '—'}</option>)}
                  </select>
                </label>
              </div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('asc.note_ph')} rows={2} className="mt-2 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base focus:outline-none focus:border-sante-600" />
              <Button variant="sante" full className="mt-2" disabled={savingObs} onClick={addObs}>
                {savingObs ? t('common.loading') : t('asc.save_obs')}
              </Button>
            </CardPagne>

            {/* Historique */}
            <section>
              <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700 mb-2">{t('asc.history')}</h2>
              {data.observations.length === 0 ? (
                <p className="text-[0.8125rem] text-stone-400">{t('common.empty')}</p>
              ) : (
                <CardPagne className="p-0 overflow-hidden">
                  <ul className="divide-y divide-stone-100">
                    {data.observations.map((o) => (
                      <li key={o.id} className="px-4 py-2 text-[0.8125rem]">
                        <p className="font-bold text-stone-800">{obsSummary(o, t) || t('asc.note')}</p>
                        {o.note && <p className="text-stone-600">{o.note}</p>}
                        <p className="text-[0.6875rem] text-stone-400">{formatDateTime(o.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</p>
                      </li>
                    ))}
                  </ul>
                </CardPagne>
              )}
            </section>

            {/* Signalement à un médecin */}
            <section>
              <h2 className="font-display font-extrabold text-[0.875rem] text-indigo-700 mb-2">{t('asc.relay')}</h2>
              <CardPagne stitch="indigo" className="p-4 space-y-2">
                <select value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setRelayed(false); }} className="w-full bg-white card-pagne border border-stone-300 px-2 py-2 text-base focus:outline-none focus:border-indigo-600">
                  <option value="">{t('asc.pick_doctor')}</option>
                  {(doctors.data?.data ?? []).filter((d) => d.isVerified).map((d) => (
                    <option key={d.id} value={d.id}>{d.profile ? `Dr ${d.profile.firstName} ${d.profile.lastName}` : d.id} — {d.speciality}</option>
                  ))}
                </select>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('asc.relay_ph')} rows={3} className="w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base focus:outline-none focus:border-indigo-600" />
                {relayed && <p className="text-[0.75rem] text-sante-700 font-bold">✓ {t('asc.relayed')}</p>}
                <Button variant="indigo" full disabled={relaying || !doctorId || !message.trim()} onClick={relay}>
                  {relaying ? t('common.loading') : t('asc.relay_btn')}
                </Button>
              </CardPagne>
            </section>
          </>
        )}
      </main>
    </>
  );
}
