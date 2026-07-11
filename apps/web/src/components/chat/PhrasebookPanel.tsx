'use client';

import { LANGS, PHRASE_CATEGORIES, phraseText, phrasesByCategory, type Lang, type PhraseCategory } from '@digisante/shared';
import { useState } from 'react';

import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';

// Phrasier médical embarqué (barrière linguistique). 100% LOCAL — aucune traduction
// au runtime, aucun contenu de chat envoyé à un tiers (§4). L'utilisateur choisit
// une phrase courante dans une LANGUE CIBLE ; elle est insérée dans le message.
export function PhrasebookPanel({
  ownLang,
  onPick,
  onClose,
  accent,
}: {
  ownLang: Lang;
  onPick: (text: string) => void;
  onClose: () => void;
  accent: string; // classe de couleur d'accent selon l'espace (sante / indigo)
}) {
  const { t } = useLocale();
  // Langue cible par défaut : la « paire » la plus utile (FR↔EN) ; on montre aussi
  // la version dans MA langue pour savoir ce que j'envoie.
  const [target, setTarget] = useState<Lang>(ownLang === 'FR' ? 'EN' : 'FR');
  const [category, setCategory] = useState<PhraseCategory>('GREETING');
  const phrases = phrasesByCategory(category);

  return (
    <div className="bg-white card-pagne border border-stone-200 p-3 mb-2 max-h-[15rem] overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[0.75rem] font-display font-bold text-stone-700">{t('phrasebook.title')}</p>
        <button type="button" onClick={onClose} className="text-[0.75rem] text-stone-500" aria-label={t('common.close')}>
          ✕
        </button>
      </div>

      {/* Langue cible : la phrase sera insérée dans cette langue. */}
      <div className="flex items-center gap-1 mb-2">
        <span className="text-[0.625rem] text-stone-500 mr-1">{t('phrasebook.target')}</span>
        {LANGS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setTarget(l)}
            className={cn(
              'text-[0.625rem] font-bold px-2 py-0.5 card-pagne border',
              target === l ? `${accent} text-white border-transparent` : 'bg-white text-stone-600 border-stone-300',
            )}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Catégories */}
      <div className="flex flex-wrap gap-1 mb-2">
        {PHRASE_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              'text-[0.625rem] px-2 py-0.5 card-pagne',
              category === c ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-600',
            )}
          >
            {t(`phrasebook.cat.${c}`)}
          </button>
        ))}
      </div>

      {/* Phrases : libellé dans MA langue, insertion dans la langue cible. */}
      <div className="space-y-1">
        {phrases.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onPick(phraseText(p, target))}
            className="w-full text-left bg-stone-50 hover:bg-stone-100 card-pagne px-2 py-1.5 border border-stone-200"
          >
            <span className="block text-[0.8125rem] text-stone-800">{phraseText(p, ownLang)}</span>
            {target !== ownLang && <span className="block text-[0.6875rem] text-stone-500 mt-0.5">→ {phraseText(p, target)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
