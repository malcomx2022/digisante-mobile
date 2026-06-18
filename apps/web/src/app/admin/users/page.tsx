'use client';

import { useState } from 'react';

import { Badge, Button, CardPagne, ConfirmDialog } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

interface User {
  id: string;
  phone: string;
  email?: string | null;
  role: string;
  status: string;
  lang?: string | null;
  createdAt: string;
  profile: { firstName: string; lastName: string } | null;
}
interface Paginated {
  data: User[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 20;

// Couleur du badge de rôle (cohérent avec les thèmes par espace).
const ROLE_BADGE: Record<string, string> = {
  PATIENT: 'bg-sante-50 text-sante-700',
  MEDECIN: 'bg-indigo-50 text-indigo-600',
  PHARMACIE: 'bg-ocre-50 text-ocre-600',
  LABORATOIRE: 'bg-ocre-50 text-ocre-600',
  DIASPORA: 'bg-ocre-50 text-ocre-600',
  ADMIN: 'bg-stone-100 text-stone-600',
};

function fullName(u: User): string {
  return u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : u.phone;
}
function initials(u: User): string {
  if (!u.profile) return u.phone.slice(-2);
  return `${u.profile.firstName[0] ?? ''}${u.profile.lastName[0] ?? ''}`.toUpperCase();
}

// D-25 (part 1) — Gestion des utilisateurs (SANS contenu médical, cf. §4).
// Desktop : table dense + panneau détail + pagination. Mobile : cartes.
export default function AdminUsers() {
  const { t } = useLocale();
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error } = useApi<Paginated>(
    () => get(`/admin/users?page=${page}&pageSize=${PAGE_SIZE}`),
    [page, tick],
  );

  const users = data?.data ?? [];
  const total = data?.total ?? 0;
  const selected = users.find((u) => u.id === selectedId) ?? null;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const hasPrev = page > 1;
  const hasNext = page * PAGE_SIZE < total;

  // Action sensible (journalisée USER_SUSPEND) → confirmation via dialogue stylé.
  function toggle(u: User) {
    setActionError(null);
    setPending(u);
  }

  async function confirmPending() {
    if (!pending) return;
    const action = pending.status === 'SUSPENDED' ? 'activate' : 'suspend';
    setBusy(true);
    setActionError(null);
    try {
      await post(`/admin/users/${pending.id}/${action}`);
      setPending(null);
      setTick((x) => x + 1);
    } catch {
      setActionError(t('auth.error'));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  function statusBadge(status: string) {
    return <Badge variant={status === 'SUSPENDED' ? 'eleve' : 'normal'}>{status}</Badge>;
  }

  function Pagination() {
    if (total <= PAGE_SIZE) return null;
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.6875rem] text-stone-400">{t('admin.results_range', { from, to, total })}</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={!hasPrev}
            className="card-pagne bg-white border border-stone-200 text-stone-600 text-[0.75rem] font-display font-bold px-3 py-1.5 disabled:opacity-40"
          >
            <span aria-hidden="true">‹ </span>{t('admin.prev')}
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext}
            className="card-pagne bg-white border border-stone-200 text-stone-600 text-[0.75rem] font-display font-bold px-3 py-1.5 disabled:opacity-40"
          >
            {t('admin.next')}<span aria-hidden="true"> ›</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <SpaceHeader title={t('admin.users')} headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-5xl lg:mx-auto lg:w-full space-y-3">
        <p className="text-[0.75rem] text-stone-400">{t('admin.no_medical')}</p>
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {actionError && <p className="text-[0.75rem] text-sos-600 font-bold">{actionError}</p>}
        {!loading && !error && total === 0 && <Empty label={t('common.empty')} />}

        {/* ── Mobile : cartes ── */}
        <div className="lg:hidden space-y-3">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            {users.map((u) => (
              <CardPagne key={u.id} stitch={u.status === 'SUSPENDED' ? 'sos' : false} className="p-4 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display font-bold text-[0.875rem] truncate">{fullName(u)}</p>
                  <p className="text-[0.75rem] text-stone-400 truncate">
                    {u.role} · {u.phone}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {statusBadge(u.status)}
                  <Button variant={u.status === 'SUSPENDED' ? 'sante' : 'sos'} className="text-[0.6875rem] px-2.5 py-1" onClick={() => toggle(u)}>
                    {u.status === 'SUSPENDED' ? t('admin.activate') : t('admin.suspend')}
                  </Button>
                </div>
              </CardPagne>
            ))}
          </div>
          <Pagination />
        </div>

        {/* ── Desktop : table dense + panneau détail ── */}
        <div className="hidden lg:grid grid-cols-3 gap-5 items-start">
          <div className="col-span-2 bg-white card-pagne border border-stone-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-creme">
                  {['admin.col_user', 'admin.col_role', 'admin.col_lang', 'admin.col_joined', 'admin.col_status'].map((k, i) => (
                    <th key={k} className={cn('text-left py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide', i === 0 ? 'px-5' : 'px-3')}>
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelectedId(u.id)}
                    className={cn(
                      'cursor-pointer transition-colors',
                      selectedId === u.id ? 'bg-indigo-50/60' : u.status === 'SUSPENDED' ? 'bg-sos-50/40 hover:bg-sos-50/60' : 'hover:bg-creme',
                    )}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={cn('w-9 h-9 card-pagne flex items-center justify-center font-display font-extrabold text-[0.6875rem] rotate-1 shrink-0', ROLE_BADGE[u.role] ?? 'bg-stone-200 text-stone-600')}>
                          {initials(u)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-[0.8125rem] text-stone-900 truncate">{fullName(u)}</p>
                          <p className="text-[0.625rem] text-stone-400 truncate">{u.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn('px-2 py-0.5 card-pagne text-[0.59375rem] font-extrabold whitespace-nowrap', ROLE_BADGE[u.role] ?? 'bg-stone-100 text-stone-500')}>{u.role}</span>
                    </td>
                    <td className="px-3 py-3 text-[0.75rem] font-bold text-stone-700 whitespace-nowrap">
                      {u.lang ? <><span aria-hidden="true">🗣</span> {u.lang}</> : '—'}
                    </td>
                    <td className="px-3 py-3 text-[0.71875rem] text-stone-500 whitespace-nowrap">
                      {new Date(u.createdAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                    </td>
                    <td className="px-3 py-3">{statusBadge(u.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-stone-100 bg-creme">
              <Pagination />
            </div>
          </div>

          {/* Panneau détail (champs non-médicaux uniquement, §4). */}
          <aside className="space-y-4 lg:sticky lg:top-4">
            {selected ? (
              <>
                <CardPagne stitch="indigo" className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={cn('w-12 h-12 card-pagne flex items-center justify-center font-display font-extrabold text-[0.9375rem] rotate-2 shrink-0', ROLE_BADGE[selected.role] ?? 'bg-stone-200 text-stone-600')}>
                      {initials(selected)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-display font-extrabold text-[0.9375rem] text-stone-900 truncate">{fullName(selected)}</p>
                      <p className="text-[0.65625rem] text-stone-400">{selected.role}</p>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-[0.71875rem]">
                    <div className="flex justify-between gap-2"><span className="text-stone-400">{t('admin.phone')}</span><span className="font-bold text-stone-900 truncate">{selected.phone}</span></div>
                    {selected.email && <div className="flex justify-between gap-2"><span className="text-stone-400">{t('admin.email')}</span><span className="font-bold text-stone-900 truncate">{selected.email}</span></div>}
                    {selected.lang && <div className="flex justify-between gap-2"><span className="text-stone-400">{t('admin.col_lang')}</span><span className="font-bold text-stone-900">🗣 {selected.lang}</span></div>}
                    <div className="flex justify-between gap-2"><span className="text-stone-400">{t('admin.col_joined')}</span><span className="font-bold text-stone-900">{new Date(selected.createdAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}</span></div>
                    <div className="flex justify-between gap-2 items-center"><span className="text-stone-400">{t('admin.col_status')}</span>{statusBadge(selected.status)}</div>
                  </div>
                </CardPagne>
                <CardPagne className="p-4">
                  <p className="font-display font-extrabold text-[0.8125rem] text-stone-900 mb-2.5">{t('admin.account_actions')}</p>
                  <Button
                    full
                    variant={selected.status === 'SUSPENDED' ? 'sante' : 'sos'}
                    className="text-[0.75rem] py-2.5"
                    onClick={() => toggle(selected)}
                  >
                    {selected.status === 'SUSPENDED' ? t('admin.activate') : t('admin.suspend')}
                  </Button>
                  <p className="text-[0.59375rem] text-stone-400 mt-2.5 leading-snug">
                    <span aria-hidden="true">⚠ </span>{t('admin.no_medical')}
                  </p>
                </CardPagne>
              </>
            ) : (
              <CardPagne className="p-5">
                <p className="text-[0.8125rem] text-stone-400">{t('admin.detail_hint')}</p>
              </CardPagne>
            )}
          </aside>
        </div>
      </main>

      <ConfirmDialog
        open={!!pending}
        danger={pending?.status !== 'SUSPENDED'}
        busy={busy}
        title={pending && pending.status === 'SUSPENDED' ? t('admin.activate') : t('admin.suspend')}
        message={
          pending
            ? t(pending.status === 'SUSPENDED' ? 'admin.activate_confirm' : 'admin.suspend_confirm', { who: fullName(pending) })
            : ''
        }
        confirmLabel={pending && pending.status === 'SUSPENDED' ? t('admin.activate') : t('admin.suspend')}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
