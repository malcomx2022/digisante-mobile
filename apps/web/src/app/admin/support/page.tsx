'use client';

import { useEffect, useState } from 'react';

import { Button, CardPagne, ConfirmDialog } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { ErrorState, Skeleton, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { supportApi, type SupportAccount } from '@/lib/api/support';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/i18n/format';

interface UserLite {
  id: string;
  phone: string;
  role: string;
  status: string;
  profile: { firstName: string; lastName: string } | null;
}

function nameOf(u: { phone: string; profile: { firstName: string; lastName: string } | null }) {
  return u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : u.phone;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-stone-400">{label}</span>
      <span className="font-bold text-stone-900 truncate">{value}</span>
    </div>
  );
}

// D-25d — Console Support / OTP : lookup compte + verrou OTP + activité + notes.
export default function AdminSupport() {
  const { t } = useLocale();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const search = useApi<{ data: UserLite[] }>(
    () => (debouncedQ ? get(`/admin/users?q=${encodeURIComponent(debouncedQ)}&pageSize=8`) : Promise.resolve({ data: [] })),
    [debouncedQ],
  );
  const results = search.data?.data ?? [];

  const acc = useApi<SupportAccount | null>(() => (selectedId ? supportApi.account(selectedId) : Promise.resolve(null)), [selectedId, tick]);
  const account = selectedId ? acc.data : null;

  async function doUnlock() {
    if (!selectedId) return;
    setBusy(true);
    setErr(null);
    try {
      await supportApi.unlock(selectedId);
      setConfirmUnlock(false);
      setTick((x) => x + 1);
    } catch {
      setErr(t('auth.error'));
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!selectedId || !note.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await supportApi.addNote(selectedId, note.trim());
      setNote('');
      setTick((x) => x + 1);
    } catch {
      setErr(t('auth.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SpaceHeader title={t('admin.support')} subtitle={t('admin.support_sub')} headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-5xl lg:mx-auto lg:w-full space-y-4">
        {/* Recherche d'un compte */}
        <CardPagne className="p-3 space-y-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('admin.search_users')}
            aria-label={t('admin.search_users')}
            className="w-full bg-white card-pagne border border-stone-300 px-3 py-2 font-body text-base pagne-focus focus:outline-none focus:border-indigo-600"
          />
          {/* États de la recherche : chargement / erreur / aucun résultat / chips. */}
          {debouncedQ && search.loading && <Skeleton className="h-8 w-2/3" />}
          {debouncedQ && !search.loading && search.error && <p className="text-[0.75rem] text-sos-600 font-bold">{t('common.load_error')}</p>}
          {debouncedQ && !search.loading && !search.error && results.length === 0 && (
            <p className="text-[0.75rem] text-stone-400">{t('common.empty')}</p>
          )}
          {results.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelectedId(u.id)}
                  className={cn('card-pagne pagne-focus px-3 py-1.5 text-[0.75rem] font-display font-bold', selectedId === u.id ? 'bg-indigo-600 text-white' : 'bg-creme-deep text-stone-600')}
                >
                  {nameOf(u)} · {u.phone}
                </button>
              ))}
            </div>
          )}
        </CardPagne>

        {/* Recette L10 I1 : sans compte choisi, la page n'émet aucune requête et
            n'affichait qu'un champ — prise pour une page non chargée. */}
        {!selectedId && <p className="text-[0.8125rem] text-stone-500 text-center py-4">{t('admin.detail_hint')}</p>}
        {err && <p className="text-[0.75rem] text-sos-600 font-bold">{err}</p>}
        {acc.error && selectedId && <ErrorState label={t('auth.error')} />}
        {acc.loading && selectedId && !account && <SkeletonCards count={2} label={t('common.loading')} />}

        {account && (
          <div className="lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start space-y-4 lg:space-y-0">
            {/* Colonne 1 : compte + verrou */}
            <div className="space-y-4">
              <CardPagne stitch="indigo" className="p-4">
                <p className="font-display font-extrabold text-[0.9375rem] text-stone-900">{nameOf(account.user)}</p>
                <div className="mt-2 space-y-1 text-[0.71875rem]">
                  <Row label={t('admin.phone')} value={account.user.phone} />
                  {account.user.email && <Row label={t('admin.email')} value={account.user.email} />}
                  <Row label={t('admin.col_role')} value={account.user.role} />
                  <Row label={t('admin.col_status')} value={account.user.status} />
                  {account.user.lang && <Row label={t('admin.col_lang')} value={account.user.lang} />}
                  <Row label={t('admin.col_joined')} value={formatDate(account.user.createdAt, { dateStyle: 'medium' })} />
                </div>
              </CardPagne>

              <CardPagne stitch={account.lockout.locked ? 'sos' : false} className="p-4">
                <p className="font-display font-extrabold text-[0.8125rem] text-stone-900 mb-1">{t('admin.otp_lock')}</p>
                {account.lockout.locked ? (
                  <>
                    <p className="text-[0.75rem] text-sos-600 font-bold"><span aria-hidden="true">⚠ </span>{t('admin.locked')} · {account.lockout.attempts} {t('admin.attempts')}</p>
                    <Button variant="sos" full className="mt-2 text-[0.8125rem]" onClick={() => setConfirmUnlock(true)}>{t('admin.unlock')}</Button>
                  </>
                ) : (
                  <p className="text-[0.75rem] text-sante-700 font-bold"><span aria-hidden="true">✓ </span>{t('admin.no_lock')}</p>
                )}
              </CardPagne>
            </div>

            {/* Colonne 2 : activité + notes */}
            <div className="space-y-4">
              <CardPagne className="p-4">
                <p className="font-display font-extrabold text-[0.8125rem] text-stone-900 mb-2">{t('admin.activity')}</p>
                <div className="space-y-1.5">
                  {account.activity.length === 0 && <p className="text-[0.71875rem] text-stone-400">{t('common.empty')}</p>}
                  {account.activity.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 text-[0.6875rem]">
                      <span className="font-mono font-bold text-indigo-700 bg-indigo-50 card-pagne px-1.5 py-0.5">{a.action}</span>
                      <span className="text-stone-400 whitespace-nowrap">{formatDateTime(a.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                  ))}
                </div>
              </CardPagne>

              <CardPagne className="p-4">
                <p className="font-display font-extrabold text-[0.8125rem] text-stone-900 mb-2">{t('admin.notes')}</p>
                <div className="space-y-2 mb-2">
                  {account.notes.length === 0 && <p className="text-[0.71875rem] text-stone-400">{t('common.empty')}</p>}
                  {account.notes.map((n) => (
                    <div key={n.id} className="bg-creme card-pagne p-2">
                      <p className="text-[0.75rem] text-nuit">{n.body}</p>
                      <p className="text-[0.625rem] text-stone-400 mt-0.5">{formatDateTime(n.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</p>
                    </div>
                  ))}
                </div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder={t('admin.add_note')}
                  aria-label={t('admin.add_note')}
                  className="w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-indigo-600"
                />
                <Button variant="indigo" full className="mt-2 text-[0.8125rem]" onClick={addNote} disabled={busy || !note.trim()}>{t('admin.add_note_btn')}</Button>
              </CardPagne>
            </div>
          </div>
        )}
      </main>

      <ConfirmDialog
        open={confirmUnlock}
        busy={busy}
        title={t('admin.unlock')}
        message={t('admin.unlock_confirm')}
        confirmLabel={t('admin.unlock')}
        onConfirm={doUnlock}
        onCancel={() => setConfirmUnlock(false)}
      />
    </>
  );
}
