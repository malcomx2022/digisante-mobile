'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { ProHeader } from '@/components/pro/ProHeader';
import { Button, CardPagne } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { ApiRequestError, post } from '@/lib/api/client';

interface Line {
  medicationName: string;
  dosage: string;
  frequency: string;
  duration: string;
}

const empty = (): Line => ({ medicationName: '', dosage: '', frequency: '', duration: '' });

// D-17 — Prescription assistée (DCI, contrôle d'allergie, signature).
function PrescribeInner() {
  const { t } = useLocale();
  const params = useSearchParams();
  // Pré-remplissage du patient depuis la vue 360° (/pro/prescribe?patientId=...).
  // Le champ reste éditable en repli (saisie/collage manuel du cuid).
  const [patientId, setPatientId] = useState(params.get('patientId') ?? '');
  const [lines, setLines] = useState<Line[]>([empty()]);
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

  const inputCls = 'bg-white card-pagne border border-stone-300 px-3 py-2 text-[13px] focus:outline-none focus:border-indigo-600';

  return (
    <>
      <ProHeader title={t('pro.prescribe')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
        <input className={`${inputCls} w-full`} placeholder="patientId (cuid)" value={patientId} onChange={(e) => setPatientId(e.target.value)} />

        {conflicts.length > 0 && (
          <CardPagne stitch="sos" className="p-3 bg-sos-50">
            <p className="font-display font-extrabold text-sos-600 text-[13px]">⚠ {t('pro.allergy_alert')}</p>
            <p className="text-[13px] text-stone-700">{conflicts.join(', ')}</p>
            <Button variant="sos" className="mt-2 text-[12px] px-3 py-1.5" onClick={() => submit(true)} disabled={busy}>
              {t('pro.sign')} (override)
            </Button>
          </CardPagne>
        )}

        {submitError && <p className="text-sos-600 font-bold text-[12px]">{t('auth.error')}</p>}

        {lines.map((l, i) => (
          <CardPagne key={i} className="p-3 space-y-2">
            <input className={`${inputCls} w-full`} placeholder={t('pro.add_med')} value={l.medicationName} onChange={(e) => setLine(i, 'medicationName', e.target.value)} />
            <div className="grid grid-cols-3 gap-2">
              <input className={inputCls} placeholder="Posologie" value={l.dosage} onChange={(e) => setLine(i, 'dosage', e.target.value)} />
              <input className={inputCls} placeholder="Fréquence" value={l.frequency} onChange={(e) => setLine(i, 'frequency', e.target.value)} />
              <input className={inputCls} placeholder="Durée" value={l.duration} onChange={(e) => setLine(i, 'duration', e.target.value)} />
            </div>
          </CardPagne>
        ))}

        <button type="button" onClick={() => setLines((ls) => [...ls, empty()])} className="w-full text-center text-[13px] text-indigo-700 underline decoration-dotted underline-offset-4">
          + {t('pro.add_med')}
        </button>

        {done ? (
          <p className="text-center text-sante-700 font-display font-bold">✓ Ordonnance signée et émise</p>
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
