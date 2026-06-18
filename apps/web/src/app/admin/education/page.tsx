'use client';

import { useState } from 'react';

import { Badge, Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { SkeletonCards } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface Content {
  id: string;
  title: string;
  category: string;
  status: string;
  isPublished: boolean;
}

// D-26 — Éducation santé (CMS) : création + workflow + catalogue.
export default function AdminEducation() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const { data, loading } = useApi<Content[]>(() => get('/education?pageSize=20'), [tick]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState<Content | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function create() {
    setActionError(null);
    try {
      const c = (await post('/education', { title, body, category: 'PREVENTION' })) as Content;
      setDraft(c);
      setTitle('');
      setBody('');
    } catch {
      setActionError(t('auth.error'));
    }
  }
  async function submitReview() {
    if (!draft) return;
    setActionError(null);
    try {
      await post(`/education/${draft.id}/submit-review`);
      // Réinitialiser pour permettre d'enchaîner une nouvelle création.
      setDraft(null);
      setTick((x) => x + 1);
    } catch {
      setActionError(t('auth.error'));
    }
  }

  const inputCls = 'w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-[0.875rem] focus:outline-none focus:border-indigo-600';

  return (
    <>
      <SpaceHeader title={t('admin.education')} headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-5xl lg:mx-auto lg:w-full">
        <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-5 lg:items-start">
          {/* Création — colonne 1 (desktop) */}
          <div className="lg:col-span-1 lg:sticky lg:top-4">
            <CardPagne stitch="indigo" className="p-4 space-y-2">
              <input className={inputCls} placeholder={t('edu.title_ph')} aria-label={t('edu.title_ph')} value={title} onChange={(e) => setTitle(e.target.value)} />
              <textarea className={`${inputCls} h-20`} placeholder={t('edu.body_ph')} aria-label={t('edu.body_ph')} value={body} onChange={(e) => setBody(e.target.value)} />
              {draft ? (
                <div className="flex items-center justify-between">
                  <Badge variant="eleve">{draft.status}</Badge>
                  <Button variant="indigo" className="text-[0.75rem] px-3 py-1.5" onClick={submitReview} disabled={draft.status !== 'DRAFT'}>
                    {t('edu.submit_review')}
                  </Button>
                </div>
              ) : (
                <Button variant="indigo" full onClick={create} disabled={title.length < 3 || !body}>
                  {t('edu.create')}
                </Button>
              )}
              {actionError && <p className="text-[0.75rem] text-sos-600 font-bold">{actionError}</p>}
            </CardPagne>
          </div>

          {/* Catalogue — colonne 2 (desktop : table, mobile : cartes) */}
          <div className="lg:col-span-2 space-y-3">
            <Nkyinkyim className="opacity-40 lg:hidden" />
            {loading && <SkeletonCards label={t('common.loading')} count={4} columns={false} />}

            {/* Mobile : cartes */}
            <div className="lg:hidden space-y-2">
              {(data ?? []).map((c) => (
                <CardPagne key={c.id} className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display font-bold text-[0.875rem] truncate">{c.title}</p>
                    <p className="text-[0.6875rem] text-stone-400">{c.category}</p>
                  </div>
                  <Badge variant={c.isPublished ? 'normal' : 'eleve'}>{c.status}</Badge>
                </CardPagne>
              ))}
            </div>

            {/* Desktop : table */}
            {(data?.length ?? 0) > 0 && (
              <div className="hidden lg:block bg-white card-pagne border border-stone-200 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-creme">
                      <th className="text-left px-5 py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide">{t('admin.col_article')}</th>
                      <th className="text-left px-3 py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide">{t('admin.col_category')}</th>
                      <th className="text-right px-5 py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide">{t('admin.col_status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {(data ?? []).map((c) => (
                      <tr key={c.id} className="hover:bg-creme">
                        <td className="px-5 py-3 font-bold text-[0.8125rem] text-stone-900">{c.title}</td>
                        <td className="px-3 py-3"><span className={cn('px-2 py-0.5 card-pagne text-[0.59375rem] font-extrabold', c.isPublished ? 'bg-sante-50 text-sante-700' : 'bg-indigo-50 text-indigo-600')}>{c.category}</span></td>
                        <td className="px-5 py-3 text-right"><Badge variant={c.isPublished ? 'normal' : 'eleve'}>{c.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
