'use client';

import { useEffect, useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, CardPagne } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { educationApi, type HealthContent } from '@/lib/api/education';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';
import { speak, speechSupported, stopSpeaking } from '@/lib/speech';

const CATEGORIES = ['PREVENTION', 'NUTRITION', 'MATERNITY', 'VACCINATION', 'CHRONIC', 'MENTAL_HEALTH', 'EMERGENCY', 'OTHER'];

// Conseils santé — feed des contenus d'éducation publiés (prévention, nutrition,
// vaccination…), localisés dans la langue du patient si une traduction existe.
export default function EducationPage() {
  const { t, lang } = useLocale();
  const [category, setCategory] = useState<string | null>(null);
  const { data, loading, error } = useApi<HealthContent[]>(() => educationApi.list(category ?? undefined), [category]);

  // Lecture à voix haute (accessibilité). `supported` calculé côté client (anti-SSR).
  const [supported, setSupported] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  useEffect(() => {
    setSupported(speechSupported());
    return () => stopSpeaking();
  }, []);

  // Changer de catégorie recharge la liste : on coupe toute lecture vocale en cours
  // (les contenus affichés ne sont plus les mêmes).
  useEffect(() => {
    stopSpeaking();
    setSpeakingId(null);
  }, [category]);

  const items = data ?? [];
  const localized = (c: HealthContent) => {
    const tr = c.translations?.[lang];
    return { title: tr?.title || c.title, body: tr?.body || c.body };
  };

  function toggleSpeak(id: string, title: string, body: string) {
    if (speakingId === id) {
      stopSpeaking();
      setSpeakingId(null);
      return;
    }
    speak(`${title}. ${body}`, lang, () => setSpeakingId(null));
    setSpeakingId(id);
  }

  return (
    <>
      <PatientHeader title={t('education.title')} subtitle={t('education.subtitle')} />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6">
        {/* Filtre par catégorie */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            onClick={() => setCategory(null)}
            className={cn('shrink-0 card-pagne px-3 py-1.5 text-[12px] font-display font-bold', category === null ? 'bg-sante-600 text-white' : 'bg-creme-deep text-stone-600')}
          >
            {t('education.all')}
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn('shrink-0 card-pagne px-3 py-1.5 text-[12px] font-display font-bold', category === c ? 'bg-sante-600 text-white' : 'bg-creme-deep text-stone-600')}
            >
              {t(`edu.cat.${c}`)}
            </button>
          ))}
        </div>

        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && items.length === 0 && <Empty label={t('education.empty')} />}

        {items.map((c) => {
          const { title, body } = localized(c);
          return (
            <CardPagne key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-display font-extrabold text-[15px] text-stone-800">{title}</p>
                <Badge variant="normal">{t(`edu.cat.${c.category}`)}</Badge>
              </div>
              <p className="text-[13px] text-stone-600 mt-2 whitespace-pre-line">{body}</p>
              {c.tags?.length ? <p className="text-[11px] text-stone-400 mt-2">{c.tags.map((x) => `#${x}`).join(' ')}</p> : null}
              {supported && (
                <button
                  type="button"
                  onClick={() => toggleSpeak(c.id, title, body)}
                  className="mt-3 card-pagne bg-sante-50 text-sante-700 font-display font-bold text-[12px] px-3 py-1.5"
                >
                  {speakingId === c.id ? `⏹ ${t('education.stop')}` : `🔊 ${t('education.listen')}`}
                </button>
              )}
            </CardPagne>
          );
        })}
      </main>
    </>
  );
}
