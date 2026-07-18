'use client';

import { parsePosology, type PosologyForm, type PosologyMeal, type PosologyTiming } from '@digisante/shared';
import { useEffect, useState } from 'react';

import { useLocale } from '@/i18n/LocaleProvider';
import { speak, speechSupported, stopSpeaking } from '@/lib/speech';

// D-08b — Ordonnance ILLUSTRÉE : chaque ligne est rendue en PICTOGRAMMES
// indépendants de la langue (matin/soir, forme, repas, durée) + lecture vocale,
// pour les patients peu alphabétisés ou non francophones (barrière linguistique
// FON·YOR, CLAUDE.md §1). Les pictogrammes sont 100% SVG/CSS (aucune image
// bitmap, §5 design). Le texte original reste affiché = source de vérité.

interface Item {
  id: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  duration: string;
}

const ICON_STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function TimingIcon({ t }: { t: PosologyTiming }) {
  switch (t) {
    case 'MORNING': // soleil levant
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" {...ICON_STROKE}>
          <path d="M17 18a5 5 0 0 0-10 0" /><line x1="2" y1="18" x2="22" y2="18" />
          <line x1="12" y1="3" x2="12" y2="7" /><line x1="5" y1="7" x2="6.5" y2="8.5" /><line x1="19" y1="7" x2="17.5" y2="8.5" />
        </svg>
      );
    case 'NOON': // soleil haut
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" {...ICON_STROKE}>
          <circle cx="12" cy="12" r="4" />
          <line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" />
          <line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" />
          <line x1="5" y1="5" x2="7" y2="7" /><line x1="17" y1="17" x2="19" y2="19" /><line x1="17" y1="7" x2="19" y2="5" /><line x1="5" y1="19" x2="7" y2="17" />
        </svg>
      );
    case 'EVENING': // soleil couchant
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" {...ICON_STROKE}>
          <path d="M17 18a5 5 0 0 0-10 0" /><line x1="2" y1="18" x2="22" y2="18" />
          <line x1="12" y1="9" x2="12" y2="13" /><path d="m9.5 11.5 2.5 2.5 2.5-2.5" />
        </svg>
      );
    case 'NIGHT': // lune
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" {...ICON_STROKE}>
          <path d="M20 14.5A8 8 0 1 1 9.5 4a6 6 0 0 0 10.5 10.5Z" />
        </svg>
      );
  }
}

function FormIcon({ f }: { f: PosologyForm }) {
  switch (f) {
    case 'TABLET':
      return <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}><circle cx="12" cy="12" r="8" /><line x1="7" y1="12" x2="17" y2="12" /></svg>;
    case 'CAPSULE':
      return <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}><rect x="3" y="8" width="18" height="8" rx="4" /><line x1="12" y1="8" x2="12" y2="16" /></svg>;
    case 'SYRUP':
      return <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}><path d="M9 3h6v3l1 2v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8l1-2Z" /><line x1="8" y1="12" x2="16" y2="12" /></svg>;
    case 'DROPS':
      return <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z" /></svg>;
    case 'INJECTION':
      return <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}><path d="m18 2 4 4M17 3l4 4-9 9H8v-4l9-9ZM7 17l-4 4" /></svg>;
    case 'SACHET':
      return <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}><rect x="6" y="4" width="12" height="16" rx="1" /><line x1="6" y1="8" x2="18" y2="8" /></svg>;
    case 'INHALER':
      return <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}><rect x="8" y="9" width="6" height="12" rx="1" /><path d="M14 12h4M14 15h3" /></svg>;
    case 'CREAM':
      return <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}><path d="M6 8h12v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8Z" /><path d="M9 8V5h6v3" /></svg>;
    case 'SUPPOSITORY':
      return <svg viewBox="0 0 24 24" width="20" height="20" {...ICON_STROKE}><path d="M12 3c3 4 3 14 0 18-3-4-3-14 0-18Z" /></svg>;
  }
}

function MealIcon({ m }: { m: PosologyMeal }) {
  // Fourchette + couteau ; barré si à jeun.
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...ICON_STROKE}>
      <path d="M7 3v7M5 3v4a2 2 0 0 0 4 0V3M7 10v11" /><path d="M16 3c-1.5 0-2.5 2-2.5 5 0 2 1 3 2.5 3v10" />
      {m === 'FASTING' && <line x1="3" y1="21" x2="21" y2="3" />}
    </svg>
  );
}

function DaysIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" {...ICON_STROKE}><rect x="3" y="5" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="3" x2="8" y2="6" /><line x1="16" y1="3" x2="16" y2="6" /></svg>;
}

export function PrescriptionPosology({ item }: { item: Item }) {
  const { t, lang } = useLocale();
  const parsed = parsePosology(item);
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    setSupported(speechSupported());
    return () => stopSpeaking();
  }, []);

  const timingLabel = (x: PosologyTiming) => t(`posology.timing.${x}`);
  const formLabel = (f: PosologyForm) => t(`posology.form.${f}`);
  const mealLabel = (m: PosologyMeal) => t(`posology.meal.${m}`);

  // Phrase d'instruction (lecture vocale + aria-label). Assemblée à partir des
  // fragments reconnus ; les fragments non traduits en FON/YOR retombent sur FR.
  const parts: string[] = [];
  if (parsed.doseCount != null || parsed.form) {
    parts.push([t('posology.take'), parsed.doseCount ?? '', parsed.form ? formLabel(parsed.form) : ''].filter(Boolean).join(' '));
  }
  if (parsed.timings.length) parts.push(parsed.timings.map(timingLabel).join(', '));
  else if (parsed.timesPerDay != null) parts.push(t('posology.per_day', { count: String(parsed.timesPerDay) }));
  if (parsed.meal) parts.push(mealLabel(parsed.meal));
  if (parsed.days != null) parts.push(t('posology.duration', { days: String(parsed.days) }));
  const instruction = `${item.medicationName}. ${parts.join('. ')}.`;

  const toggleSpeak = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speak(instruction, lang, () => setSpeaking(false));
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="font-display font-bold text-[0.875rem]">{item.medicationName}</p>
        {supported && parsed.recognized && (
          <button
            type="button"
            onClick={toggleSpeak}
            aria-label={speaking ? t('posology.stop') : t('posology.listen')}
            className="shrink-0 text-[0.6875rem] font-display font-bold text-sante-700 flex items-center gap-1 card-pagne px-2 py-1 bg-sante-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600"
          >
            <span aria-hidden="true">{speaking ? '⏹' : '🔊'}</span>
            {speaking ? t('posology.stop') : t('posology.listen')}
          </button>
        )}
      </div>

      {/* Pictogrammes (indépendants de la langue) — rendus seulement si reconnus. */}
      {parsed.recognized && (
        <div className="mt-1.5 flex flex-wrap items-stretch gap-1.5" role="img" aria-label={instruction}>
          {parsed.timings.map((tm) => (
            <Tile key={tm} label={timingLabel(tm)} accent="ocre">
              <span className="text-ocre-500"><TimingIcon t={tm} /></span>
            </Tile>
          ))}
          {parsed.timings.length === 0 && parsed.timesPerDay != null && (
            <Tile label={t('posology.per_day', { count: String(parsed.timesPerDay) })} accent="ocre">
              <span className="font-display font-extrabold text-ocre-500 text-[1.05rem]">{parsed.timesPerDay}×</span>
            </Tile>
          )}
          {parsed.form && (
            <Tile label={[parsed.doseCount, formLabel(parsed.form)].filter((x) => x != null && x !== '').join(' ')} accent="sante">
              <span className="text-sante-700 flex items-center gap-0.5">
                {parsed.doseCount != null && parsed.doseCount > 1 && <span className="font-display font-extrabold text-[0.9rem]">{parsed.doseCount}</span>}
                <FormIcon f={parsed.form} />
              </span>
            </Tile>
          )}
          {parsed.meal && (
            <Tile label={mealLabel(parsed.meal)} accent="indigo">
              <span className="text-indigo-500"><MealIcon m={parsed.meal} /></span>
            </Tile>
          )}
          {parsed.days != null && (
            <Tile label={t('posology.days_short', { days: String(parsed.days) })} accent="indigo">
              <span className="text-indigo-500"><DaysIcon /></span>
            </Tile>
          )}
        </div>
      )}

      {/* Texte original = source de vérité (toujours affiché). */}
      <p className="mt-1 text-[0.75rem] text-stone-500">
        {[item.dosage, item.frequency, item.duration].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}

function Tile({ children, label, accent }: { children: React.ReactNode; label: string; accent: 'ocre' | 'sante' | 'indigo' }) {
  const border = accent === 'ocre' ? 'border-ocre-200' : accent === 'sante' ? 'border-sante-200' : 'border-indigo-200';
  return (
    <span className={`card-pagne bg-white border ${border} px-2 py-1 flex flex-col items-center justify-center min-w-[3rem] text-center`}>
      {children}
      <span className="mt-0.5 text-[0.5625rem] font-bold text-stone-500 leading-tight">{label}</span>
    </span>
  );
}
