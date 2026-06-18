'use client';

import { LANGUAGE_LIST } from '@digisante/shared';
import Link from 'next/link';
import { useState } from 'react';

import { Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { beneficiariesApi, type Beneficiary } from '@/lib/api/beneficiaries';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

// Dérivé de l'enum Lang partagé (cohérence FR/EN/FON/BARIBA/DENDI) — code + endonyme affiché.
const LANGS = LANGUAGE_LIST.map((l) => ({ code: l.code, label: l.nativeName }));
const EMPTY = { name: '', relationship: '', phone: '', languagesSpoken: [] as string[], notes: '' };

// D-20b — Diaspora : carnet des proches (ajout / édition / suppression).
export default function BeneficiariesPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error } = useApi<Beneficiary[]>(() => beneficiariesApi.list(), [tick]);

  function startAdd() {
    setEditing('new');
    setForm({ ...EMPTY });
  }
  function startEdit(b: Beneficiary) {
    setEditing(b.id);
    setForm({ name: b.name, relationship: b.relationship ?? '', phone: b.phone ?? '', languagesSpoken: b.languagesSpoken, notes: b.notes ?? '' });
  }
  function toggleLang(l: string) {
    setForm((f) => ({ ...f, languagesSpoken: f.languagesSpoken.includes(l) ? f.languagesSpoken.filter((x) => x !== l) : [...f.languagesSpoken, l] }));
  }

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    setActionError(null);
    const payload = {
      name: form.name.trim(),
      relationship: form.relationship.trim() || undefined,
      phone: form.phone.trim() || undefined,
      languagesSpoken: form.languagesSpoken,
      notes: form.notes.trim() || undefined,
    };
    try {
      if (editing === 'new') await beneficiariesApi.add(payload);
      else if (editing) await beneficiariesApi.update(editing, payload);
      setEditing(null);
      setTick((n) => n + 1);
    } catch {
      setActionError(t('auth.error'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    // Suppression d'un proche → confirmation explicite.
    if (typeof window !== 'undefined' && !window.confirm(t('beneficiaries.remove_confirm'))) return;
    setActionError(null);
    try {
      await beneficiariesApi.remove(id);
      setTick((n) => n + 1);
    } catch {
      setActionError(t('auth.error'));
    }
  }

  const inputCls = 'w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-[0.875rem] focus:outline-none focus:border-ocre-500';

  return (
    <>
      <SpaceHeader title={t('beneficiaries.title')} subtitle={t('beneficiaries.sub')} headerClass="bg-ocre-900" profileHref="/diaspora/profile" />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
        {editing ? (
          <CardPagne stitch className="p-4 space-y-2">
            <p className="font-display font-extrabold text-[0.875rem] text-stone-800">
              {editing === 'new' ? t('beneficiaries.add') : t('beneficiaries.edit')}
            </p>
            <Nkyinkyim className="my-2" />
            <input className={inputCls} placeholder={t('beneficiaries.name')} aria-label={t('beneficiaries.name')} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <input className={inputCls} placeholder={t('beneficiaries.relationship')} aria-label={t('beneficiaries.relationship')} value={form.relationship} onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))} />
            <input className={inputCls} placeholder={t('beneficiaries.phone')} aria-label={t('beneficiaries.phone')} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            <div>
              <p className="text-[0.75rem] text-stone-500 mb-1"><span aria-hidden="true">🗣 </span>{t('common.spoken')}</p>
              <div className="flex flex-wrap gap-1.5">
                {LANGS.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => toggleLang(l.code)}
                    className={cn('card-pagne px-2.5 py-1 text-[0.6875rem] font-display font-bold border', form.languagesSpoken.includes(l.code) ? 'bg-ocre-400 text-stone-900 border-stone-900' : 'bg-white text-stone-500 border-stone-300')}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea className={inputCls} rows={2} placeholder={t('beneficiaries.notes')} aria-label={t('beneficiaries.notes')} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <div className="flex gap-2 pt-1">
              <Button variant="ocre" className="flex-1" onClick={save} disabled={busy || !form.name.trim()}>{t('beneficiaries.save')}</Button>
              <Button variant="outline" className="flex-1" onClick={() => setEditing(null)}>{t('common.close')}</Button>
            </div>
            {actionError && <p className="text-[0.75rem] text-sos-600 font-bold">{actionError}</p>}
          </CardPagne>
        ) : (
          <Button variant="ocre" full onClick={startAdd}>+ {t('beneficiaries.add')}</Button>
        )}

        {actionError && !editing && <p className="text-[0.75rem] text-sos-600 font-bold">{actionError}</p>}
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && !editing && <Empty label={t('beneficiaries.empty')} />}

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {(data ?? []).map((b, i) => (
            <CardPagne key={b.id} className={cn('p-4', i % 2 ? '-rotate-1' : 'rotate-1')}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display font-bold text-[0.875rem]">{b.name}</p>
                  {b.relationship && <p className="text-[0.75rem] text-stone-500">{b.relationship}</p>}
                  {b.languagesSpoken.length > 0 && <p className="text-[0.75rem] text-stone-400 mt-0.5">🗣 {b.languagesSpoken.join(' · ')}</p>}
                  {b.phone && <p className="text-[0.75rem] text-stone-400">{b.phone}</p>}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <button type="button" onClick={() => startEdit(b)} className="text-[0.75rem] text-ocre-700 font-display font-bold">{t('beneficiaries.edit')}</button>
                  <button type="button" onClick={() => remove(b.id)} className="text-[0.75rem] text-terre-600 font-display font-bold">{t('common.delete')}</button>
                </div>
              </div>
              <Link href="/diaspora/wallet" className="mt-3 inline-block bg-ocre-400 text-stone-900 font-display font-bold card-pagne px-3 py-1.5 text-[0.75rem]">
                {t('beneficiaries.send_money')}
              </Link>
            </CardPagne>
          ))}
        </div>
      </main>
    </>
  );
}
