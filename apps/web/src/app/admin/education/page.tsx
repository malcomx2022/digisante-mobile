'use client';

import { useState } from 'react';

import { Badge, Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { Loading } from '@/components/ui/States';
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

  const inputCls = 'w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-[14px] focus:outline-none focus:border-indigo-600';

  return (
    <>
      <SpaceHeader title={t('admin.education')} headerClass="bg-indigo-950" />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        <CardPagne stitch="indigo" className="p-4 space-y-2">
          <input className={inputCls} placeholder={t('edu.title_ph')} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={`${inputCls} h-20`} placeholder={t('edu.body_ph')} value={body} onChange={(e) => setBody(e.target.value)} />
          {draft ? (
            <div className="flex items-center justify-between">
              <Badge variant="eleve">{draft.status}</Badge>
              <Button variant="indigo" className="text-[12px] px-3 py-1.5" onClick={submitReview} disabled={draft.status !== 'DRAFT'}>
                {t('edu.submit_review')}
              </Button>
            </div>
          ) : (
            <Button variant="indigo" full onClick={create} disabled={title.length < 3 || !body}>
              {t('edu.create')}
            </Button>
          )}
          {actionError && <p className="text-[12px] text-sos-600 font-bold">{actionError}</p>}
        </CardPagne>

        <Nkyinkyim className="opacity-40" />

        {loading && <Loading label={t('common.loading')} />}
        <div className="space-y-2">
          {(data ?? []).map((c) => (
            <CardPagne key={c.id} className="p-3 flex items-center justify-between">
              <div>
                <p className="font-display font-bold text-[14px]">{c.title}</p>
                <p className="text-[11px] text-stone-400">{c.category}</p>
              </div>
              <Badge variant={c.isPublished ? 'normal' : 'eleve'}>{c.status}</Badge>
            </CardPagne>
          ))}
        </div>
      </main>
    </>
  );
}
