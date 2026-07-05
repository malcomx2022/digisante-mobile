'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { ProHeader } from '@/components/pro/ProHeader';
import { Button, CardPagne } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { ApiRequestError, get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

interface Line {
  medicationName: string;
  dosage: string;
  frequency: string;
  duration: string;
}
interface ApptLite {
  patientId: string;
  patientName: string;
}

const empty = (): Line => ({ medicationName: '', dosage: '', frequency: '', duration: '' });

// D-17 — Prescription assistée (DCI, contrôle d'allergie, signature).
function PrescribeInner() {
  const { t } = useLocale();
  const params = useSearchParams();
  // Pré-remplissage du patient depuis la vue 360° (/pro/prescribe?patientId=...).
  const [patientId, setPatientId] = useState(params.get('patientId') ?? '');
  const [patientQuery, setPatientQuery] = useState('');
  const [lines, setLines] = useState<Line[]>([empty()]);

  // MES patients (dérivés de mes RDV — §4 : le médecin ne voit que les siens),
  // dédupliqués par patientId, filtrables par nom. Remplace la saisie de cuid.
  const appts = useApi<ApptLite[]>(() => get('/appointments?pageSize=100'), []);
  const myPatients = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of appts.data ?? []) {
      if (a.patientId && !seen.has(a.patientId)) seen.set(a.patientId, a.patientName);
    }
    const q = patientQuery.trim().toLowerCase();
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [appts.data, patientQuery]);
  const selectedName = useMemo(
    () => (appts.data ?? []).find((a) => a.patientId === patientId)?.patientName ?? null,
    [appts.data, patientId],
  );
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  function setLine(i: number, key: keyof Line, val: string) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));
  }

  async function submit(override = false) {
    setBusy(true);
    setConflicts([]);
    setSubmitError(false);
    const validUntil = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
    try {
      await post('/prescriptions', { patientId, validUntil, items: lines, overrideAllergyWarning: override });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiRequestError && Array.isArray((e.error.details as { allergyConflicts?: string[] })?.allergyConflicts)) {
        setConflicts((e.error.details as { allergyConflicts: string[] }).allergyConflicts);
      } else {
        // Autres erreurs (403/422/réseau) → message visible plutôt qu'avalé.
        setSubmitError(true);
      }
    } finally {
      setBusy(false);
    }
  }

  const inputCls = 'bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-indigo-600';

  return (
    <>
      <ProHeader title={t('pro.prescribe')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
        {/* Sélection du patient parmi MES patients (recherche par nom). */}
        <CardPagne className="p-3 space-y-2">
          <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('prescribe.select_patient')}</p>
          {patientId ? (
            <div className="flex items-center justify-between gap-2">
              {/* Nom si connu (RDV), sinon patient présélectionné via ?patientId= (vue 360°). */}
              <span className="card-pagne bg-indigo-600 text-white px-3 py-1.5 text-[0.8125rem] font-display font-bold truncate">{selectedName ?? t('prescribe.preselected')}</span>
              <button type="button" onClick={() => setPatientId('')} className="text-[0.75rem] text-indigo-700 font-display font-bold underline decoration-dotted underline-offset-4 shrink-0">
                {t('prescribe.change_patient')}
              </button>
            </div>
          ) : (
            <>
              <input
                className={`${inputCls} w-full`}
                placeholder={t('prescribe.search_patient')}
                aria-label={t('prescribe.search_patient')}
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
              />
              {appts.loading && <p className="text-[0.75rem] text-stone-400">{t('common.loading')}</p>}
              {!appts.loading && myPatients.length === 0 && <p className="text-[0.75rem] text-stone-400">{t('prescribe.no_patients')}</p>}
              <div className="flex flex-wrap gap-2">
                {myPatients.slice(0, 12).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPatientId(p.id)}
                    className={cn('card-pagne pagne-focus px-3 py-1.5 text-[0.75rem] font-display font-bold', patientId === p.id ? 'bg-indigo-600 text-white' : 'bg-creme-deep text-stone-600')}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </CardPagne>

        {conflicts.length > 0 && (
          <CardPagne stitch="sos" className="p-3 bg-sos-50">
            <p className="font-display font-extrabold text-sos-600 text-[0.8125rem]"><span aria-hidden="true">⚠</span> {t('pro.allergy_alert')}</p>
            <p className="text-[0.8125rem] text-stone-700">{conflicts.join(', ')}</p>
            <Button variant="sos" className="mt-2 text-[0.75rem] px-3 py-1.5" onClick={() => submit(true)} disabled={busy}>
              {t('prescribe.sign_override')}
            </Button>
          </CardPagne>
        )}

        {submitError && <p className="text-sos-600 font-bold text-[0.75rem]">{t('auth.error')}</p>}

        {lines.map((l, i) => (
          <CardPagne key={i} className="p-3 space-y-2">
            <input className={`${inputCls} w-full`} placeholder={t('pro.add_med')} aria-label={t('pro.add_med')} value={l.medicationName} onChange={(e) => setLine(i, 'medicationName', e.target.value)} />
            <div className="grid grid-cols-3 gap-2">
              <input className={inputCls} placeholder={t('prescribe.dosage')} aria-label={t('prescribe.dosage')} value={l.dosage} onChange={(e) => setLine(i, 'dosage', e.target.value)} />
              <input className={inputCls} placeholder={t('prescribe.frequency')} aria-label={t('prescribe.frequency')} value={l.frequency} onChange={(e) => setLine(i, 'frequency', e.target.value)} />
              <input className={inputCls} placeholder={t('prescribe.duration')} aria-label={t('prescribe.duration')} value={l.duration} onChange={(e) => setLine(i, 'duration', e.target.value)} />
            </div>
          </CardPagne>
        ))}

        <button type="button" onClick={() => setLines((ls) => [...ls, empty()])} className="w-full text-center text-[0.8125rem] text-indigo-700 underline decoration-dotted underline-offset-4">
          + {t('pro.add_med')}
        </button>

        {done ? (
          <p className="text-center text-sante-700 font-display font-bold"><span aria-hidden="true">✓</span> {t('prescribe.issued')}</p>
        ) : (
          <Button variant="indigo" full onClick={() => submit(false)} disabled={busy || !patientId || !lines[0]?.medicationName}>
            {t('pro.sign')}
          </Button>
        )}
      </main>
    </>
  );
}

export default function PrescribePage() {
  return (
    <Suspense fallback={null}>
      <PrescribeInner />
    </Suspense>
  );
}
