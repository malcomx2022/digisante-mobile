'use client';

import { CONTENT_CATEGORIES, LANGS } from '@digisante/shared';
import { useEffect, useRef, useState } from 'react';

import { Badge, Button, CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { educationApi, type AdminContent, type ContentStatus, type Translation } from '@/lib/api/education';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

const STATUSES: ContentStatus[] = ['DRAFT', 'MEDICAL_REVIEW', 'TRANSLATION', 'PUBLISHED'];
// Langues cibles de traduction (le contenu source est en FR).
const TARGET_LANGS = LANGS.filter((l) => l !== 'FR');

function statusVariant(s: ContentStatus): 'normal' | 'eleve' | 'priorite' | 'indigo' {
  return s === 'PUBLISHED' ? 'normal' : s === 'MEDICAL_REVIEW' ? 'priorite' : s === 'TRANSLATION' ? 'indigo' : 'eleve';
}

// D-26 — Éducation santé (CMS) : pipeline éditorial complet
// (brouillon → relecture médicale → traduction → publié) + éditeur de traductions.
export default function AdminEducation() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<ContentStatus | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<string>('PREVENTION');
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminContent | null>(null);

  const list = useApi(() => educationApi.manage(filter, 1, 30), [filter, tick]);
  const items = list.data?.data ?? [];
  const refresh = () => setTick((x) => x + 1);

  async function create() {
    setErr(null);
    if (title.trim().length < 3 || !body.trim()) return;
    setBusyId('new');
    try {
      await educationApi.create({ title: title.trim(), body: body.trim(), category });
      setTitle('');
      setBody('');
      refresh();
    } catch {
      setErr(t('auth.error'));
    } finally {
      setBusyId(null);
    }
  }

  async function act(id: string, fn: () => Promise<unknown>) {
    setErr(null);
    setBusyId(id);
    try {
      await fn();
      refresh();
    } catch {
      setErr(t('auth.error'));
    } finally {
      setBusyId(null);
    }
  }

  const inputCls = 'w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-indigo-600';

  return (
    <>
      <SpaceHeader title={t('admin.education')} subtitle={t('edu.subtitle')} headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-5xl lg:mx-auto lg:w-full">
        <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-5 lg:items-start">
          {/* Création — colonne 1 */}
          <div className="lg:col-span-1 lg:sticky lg:top-4">
            <CardPagne stitch="indigo" className="p-4 space-y-2">
              <p className="font-display font-extrabold text-[0.8125rem] text-stone-900">{t('edu.new_article')}</p>
              <input className={inputCls} placeholder={t('edu.title_ph')} aria-label={t('edu.title_ph')} value={title} onChange={(e) => setTitle(e.target.value)} />
              <textarea className={`${inputCls} h-24`} placeholder={t('edu.body_ph')} aria-label={t('edu.body_ph')} value={body} onChange={(e) => setBody(e.target.value)} />
              <select className={inputCls} aria-label={t('admin.col_category')} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CONTENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <Button variant="indigo" full onClick={create} disabled={busyId === 'new' || title.trim().length < 3 || !body.trim()}>
                {t('edu.create')}
              </Button>
              {err && <p className="text-[0.75rem] text-sos-600 font-bold">{err}</p>}
            </CardPagne>
          </div>

          {/* Pipeline — colonne 2 */}
          <div className="lg:col-span-2 space-y-3">
            {/* Filtres de statut */}
            <div className="flex flex-wrap gap-2">
              <FilterChip active={filter === undefined} onClick={() => setFilter(undefined)} label={t('edu.all_status')} />
              {STATUSES.map((s) => (
                <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)} label={t(`edu.status_${s}`)} />
              ))}
            </div>

            {list.loading && !list.data && <SkeletonCards label={t('common.loading')} count={4} columns={false} />}
            {list.error && <ErrorState label={t('auth.error')} />}
            {!list.loading && !list.error && items.length === 0 && <p className="text-[0.8125rem] text-stone-400">{t('common.empty')}</p>}

            <div className="space-y-2">
              {items.map((c) => (
                <CardPagne key={c.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-display font-bold text-[0.875rem] truncate">{c.title}</p>
                      <p className="text-[0.6875rem] text-stone-400">{c.category}</p>
                    </div>
                    <Badge variant={statusVariant(c.status)}>{t(`edu.status_${c.status}`)}</Badge>
                  </div>
                  {/* Actions contextuelles selon l'état du workflow */}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {c.status === 'DRAFT' && (
                      <Button variant="indigo" className="text-[0.6875rem] px-2.5 py-1" onClick={() => act(c.id, () => educationApi.submitReview(c.id))} disabled={busyId === c.id}>
                        {t('edu.submit_review')}
                      </Button>
                    )}
                    {c.status === 'MEDICAL_REVIEW' && (
                      <span className="text-[0.6875rem] text-ocre-600 font-bold"><span aria-hidden="true">⏳ </span>{t('edu.waiting_review')}</span>
                    )}
                    {c.status === 'TRANSLATION' && (
                      <>
                        <Button variant="outline" className="text-[0.6875rem] px-2.5 py-1" onClick={() => setEditing(c)} disabled={busyId === c.id}>
                          {t('edu.translations')}
                        </Button>
                        <Button variant="indigo" className="text-[0.6875rem] px-2.5 py-1" onClick={() => act(c.id, () => educationApi.publish(c.id))} disabled={busyId === c.id}>
                          {t('edu.publish')}
                        </Button>
                      </>
                    )}
                    {c.status === 'PUBLISHED' && (
                      <span className="text-[0.6875rem] text-sante-700 font-bold"><span aria-hidden="true">✓ </span>{t('edu.published')}</span>
                    )}
                  </div>
                </CardPagne>
              ))}
            </div>
          </div>
        </div>
      </main>

      {editing && (
        <TranslationEditor
          content={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('card-pagne px-3 py-1.5 text-[0.71875rem] font-display font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600', active ? 'bg-indigo-600 text-white' : 'bg-creme-deep text-stone-600')}
    >
      {label}
    </button>
  );
}

// Éditeur de traductions par langue (le contenu source FR sert de référence).
function TranslationEditor({ content, onClose, onSaved }: { content: AdminContent; onClose: () => void; onSaved: () => void }) {
  const { t } = useLocale();
  const [draft, setDraft] = useState<Record<string, Translation>>(() => {
    const init: Record<string, Translation> = {};
    for (const lang of TARGET_LANGS) {
      const existing = content.translations?.[lang];
      init[lang] = { title: existing?.title ?? '', body: existing?.body ?? '' };
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // A11y modal (aligné sur ConfirmDialog) : focus initial + fermeture Échap.
  useEffect(() => {
    firstInputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  function update(lang: string, field: keyof Translation, value: string) {
    setDraft((d) => ({ ...d, [lang]: { ...d[lang], [field]: value } }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      // N'envoyer que les langues effectivement renseignées (titre + corps).
      const filled: Record<string, Translation> = {};
      for (const [lang, tr] of Object.entries(draft)) {
        if (tr.title.trim() && tr.body.trim()) filled[lang] = { title: tr.title.trim(), body: tr.body.trim() };
      }
      await educationApi.setTranslations(content.id, filled);
      onSaved();
    } catch {
      setErr(t('auth.error'));
      setBusy(false);
    }
  }

  const inputCls = 'w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-indigo-600';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-nuit/60 px-4 py-6" role="dialog" aria-modal="true" aria-label={t('edu.translations')} onClick={() => !busy && onClose()}>
      <CardPagne stitch="indigo" className="w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display font-extrabold text-lg text-nuit">{t('edu.translations')}</h2>
        <p className="text-[0.75rem] text-stone-500 mt-0.5">{t('edu.tr_source')} : <span className="font-bold text-stone-700">{content.title}</span></p>
        <div className="mt-3 space-y-4">
          {TARGET_LANGS.map((lang) => (
            <div key={lang} className="space-y-1.5">
              <p className="text-[0.6875rem] font-extrabold uppercase tracking-wide text-indigo-700">{lang}</p>
              <input ref={lang === TARGET_LANGS[0] ? firstInputRef : undefined} className={inputCls} placeholder={t('edu.title_ph')} aria-label={`${lang} ${t('edu.title_ph')}`} value={draft[lang].title} onChange={(e) => update(lang, 'title', e.target.value)} />
              <textarea className={`${inputCls} h-16`} placeholder={t('edu.body_ph')} aria-label={`${lang} ${t('edu.body_ph')}`} value={draft[lang].body} onChange={(e) => update(lang, 'body', e.target.value)} />
            </div>
          ))}
        </div>
        {err && <p className="text-[0.75rem] text-sos-600 font-bold mt-2">{err}</p>}
        <div className="mt-5 flex gap-2">
          <Button variant="outline" full onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="indigo" full onClick={save} disabled={busy}>{t('edu.save_tr')}</Button>
        </div>
      </CardPagne>
    </div>
  );
}
