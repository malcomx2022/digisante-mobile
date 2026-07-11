'use client';

import { evaluateTriage, type TriageFlow, type TriageOutcome, TRIAGE_FLOWS } from '@digisante/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { speak, speechSupported, stopSpeaking } from '@/lib/speech';
import { cn } from '@/lib/cn';

// D-06b — Triage / orientation HORS-LIGNE. Aide à décider quoi faire face à un
// symptôme quand on est loin d'un centre. Fondé sur les signes de danger OMS/PCIME,
// biais conservateur. ⚠️ Orientation, PAS un diagnostic (à valider médicalement).
const ICONS: Record<string, JSX.Element> = {
  thermometer: (
    <path d="M14 14.76V5a2 2 0 1 0-4 0v9.76a4 4 0 1 0 4 0Z" />
  ),
  drop: <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z" />,
  lungs: <path d="M12 4v9M8 21c-3 0-4-2-4-5s1-6 3-6 2 2 2 4M16 21c3 0 4-2 4-5s-1-6-3-6-2 2-2 4" />,
  pregnant: (
    <>
      <circle cx="12" cy="4" r="2" />
      <path d="M12 7v6M12 13c3 0 4 2 4 4a4 4 0 0 1-4 4M12 13c-1 2-2 3-2 5" />
    </>
  ),
};
function FlowIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name] ?? <circle cx="12" cy="12" r="9" />}
    </svg>
  );
}

const OUTCOME_STYLE: Record<TriageOutcome, { bg: string; text: string; ring: string }> = {
  EMERGENCY: { bg: 'bg-sos-50', text: 'text-sos-700', ring: 'border-sos-300' },
  CONSULT: { bg: 'bg-ocre-50', text: 'text-ocre-700', ring: 'border-ocre-300' },
  HOME: { bg: 'bg-sante-50', text: 'text-sante-800', ring: 'border-sante-200' },
};

export default function TriagePage() {
  const { t, lang } = useLocale();
  const [flow, setFlow] = useState<TriageFlow | null>(null);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [outcome, setOutcome] = useState<TriageOutcome | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(speechSupported());
    return () => stopSpeaking();
  }, []);

  const reset = () => {
    stopSpeaking();
    setFlow(null);
    setAnswers({});
    setOutcome(null);
  };
  const pick = (f: TriageFlow) => {
    setFlow(f);
    setAnswers({});
    setOutcome(null);
  };

  const disclaimer = (
    <p className="text-[0.6875rem] text-stone-500 bg-stone-50 card-pagne px-3 py-2">
      <span aria-hidden="true">ℹ️ </span>{t('triage.disclaimer')}
    </p>
  );

  return (
    <>
      <PatientHeader title={t('triage.title')} subtitle={t('triage.subtitle')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
        {disclaimer}

        {/* Étape 1 — choisir un motif */}
        {!flow && (
          <section>
            <h2 className="font-display font-extrabold text-[0.9375rem] text-sante-800 mb-2">{t('triage.pick')}</h2>
            <div className="grid grid-cols-2 gap-3">
              {TRIAGE_FLOWS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => pick(f)}
                  className="card-pagne bg-white border border-stone-200 p-4 flex flex-col items-center gap-2 text-sante-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600"
                >
                  <FlowIcon name={f.icon} />
                  <span className="font-display font-bold text-[0.8125rem] text-stone-800 text-center">{t(`triage.flow.${f.id}`)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Étape 2 — questions oui/non */}
        {flow && !outcome && (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sante-700">
              <FlowIcon name={flow.icon} />
              <h2 className="font-display font-extrabold text-[0.9375rem] text-stone-800">{t(`triage.flow.${flow.id}`)}</h2>
            </div>
            <Nkyinkyim />
            {flow.questions.map((q) => {
              const val = answers[q.key];
              return (
                <CardPagne key={q.key} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[0.875rem] font-bold text-stone-800 flex-1">{t(`triage.q.${q.key}`)}</p>
                    {supported && (
                      <button
                        type="button"
                        onClick={() => speak(t(`triage.q.${q.key}`), lang)}
                        aria-label={t('triage.listen')}
                        className="shrink-0 text-stone-400 hover:text-sante-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600 card-pagne px-1"
                      >
                        <span aria-hidden="true">🔊</span>
                      </button>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAnswers((a) => ({ ...a, [q.key]: true }))}
                      aria-pressed={val === true}
                      className={cn(
                        'card-pagne px-3 py-2 font-display font-bold text-[0.8125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sos-500',
                        val === true ? 'bg-sos-500 text-white' : 'bg-white border border-stone-300 text-stone-600',
                      )}
                    >
                      {t('triage.yes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnswers((a) => ({ ...a, [q.key]: false }))}
                      aria-pressed={val === false}
                      className={cn(
                        'card-pagne px-3 py-2 font-display font-bold text-[0.8125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600',
                        val === false ? 'bg-sante-600 text-white' : 'bg-white border border-stone-300 text-stone-600',
                      )}
                    >
                      {t('triage.no')}
                    </button>
                  </div>
                </CardPagne>
              );
            })}
            <div className="flex gap-2">
              <Button variant="sante" full onClick={() => setOutcome(evaluateTriage(flow, answers))}>
                {t('triage.result')}
              </Button>
              <Button variant="outline" onClick={reset}>{t('triage.restart')}</Button>
            </div>
          </section>
        )}

        {/* Étape 3 — orientation */}
        {flow && outcome && (
          <section className="space-y-3">
            <div className={cn('card-pagne border-2 p-4', OUTCOME_STYLE[outcome].bg, OUTCOME_STYLE[outcome].ring)}>
              <p className={cn('font-display font-extrabold text-[1.0625rem]', OUTCOME_STYLE[outcome].text)}>
                {t(`triage.outcome.${outcome}.title`)}
              </p>
              <p className="mt-1 text-[0.8125rem] text-stone-700">{t(`triage.outcome.${outcome}.advice`)}</p>
            </div>

            {outcome === 'EMERGENCY' && (
              <Link href="/patient/sos" className="block">
                <Button variant="sos" full>{t('triage.action.sos')}</Button>
              </Link>
            )}
            {outcome === 'CONSULT' && (
              <Link href="/patient/doctors" className="block">
                <Button variant="indigo" full>{t('triage.action.consult')}</Button>
              </Link>
            )}

            {disclaimer}
            <Button variant="outline" full onClick={reset}>{t('triage.restart')}</Button>
          </section>
        )}
      </main>
    </>
  );
}
