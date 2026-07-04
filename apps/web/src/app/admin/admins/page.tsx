'use client';

import { ADMIN_PRESET_NAMES, type AdminPreset } from '@digisante/shared';
import { useState } from 'react';

import { Badge, Button, CardPagne, ConfirmDialog } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { adminsApi, type AdminProfileItem } from '@/lib/api/admins';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 20;

function adminName(a: AdminProfileItem): string {
  return a.user.profile ? `${a.user.profile.firstName} ${a.user.profile.lastName}` : a.user.phone;
}

// D-25c — Gestion des administrateurs (RBAC : profilage par scopes). Scope admin:manage.
export default function AdminAdmins() {
  const { t } = useLocale();
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [phone, setPhone] = useState('+229');
  const [preset, setPreset] = useState<AdminPreset>('SUPPORT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<AdminProfileItem | null>(null); // suspend/activate

  const { data, loading, error: loadError } = useApi(() => adminsApi.list(page, PAGE_SIZE), [page, tick]);
  const admins = data?.data ?? [];
  const total = data?.total ?? 0;

  function refresh() {
    setTick((x) => x + 1);
  }

  async function addAdmin() {
    setBusy(true);
    setError(null);
    try {
      await adminsApi.create(phone.trim(), preset);
      setPhone('+229');
      refresh();
    } catch {
      setError(t('admin.add_admin_error'));
    } finally {
      setBusy(false);
    }
  }

  async function changePreset(a: AdminProfileItem, next: AdminPreset) {
    setError(null);
    try {
      await adminsApi.update(a.id, { preset: next });
      refresh();
    } catch {
      setError(t('auth.error'));
    }
  }

  async function confirmToggle() {
    if (!pending) return;
    const suspend = !pending.suspendedAt;
    setBusy(true);
    try {
      await (suspend ? adminsApi.suspend(pending.id) : adminsApi.activate(pending.id));
      setPending(null);
      refresh();
    } catch {
      setError(t('auth.error'));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const presetSelect = (a: AdminProfileItem) => (
    <select
      aria-label={t('admin.preset')}
      value={(a.preset as AdminPreset) ?? ''}
      onChange={(e) => changePreset(a, e.target.value as AdminPreset)}
      className="card-pagne bg-white border border-stone-300 text-[0.75rem] font-display font-bold px-2 py-1 focus:outline-none focus:border-indigo-600"
    >
      {!a.preset && <option value="">{t('admin.preset_custom')}</option>}
      {ADMIN_PRESET_NAMES.map((p) => (
        <option key={p} value={p}>{p}</option>
      ))}
    </select>
  );

  const statusBadge = (a: AdminProfileItem) =>
    a.suspendedAt ? <Badge variant="eleve">{t('admin.admin_suspended')}</Badge> : <Badge variant="normal">{t('admin.admin_active')}</Badge>;

  const toggleBtn = (a: AdminProfileItem) => (
    <Button variant={a.suspendedAt ? 'sante' : 'sos'} className="text-[0.6875rem] px-2.5 py-1" onClick={() => setPending(a)}>
      {a.suspendedAt ? t('admin.activate') : t('admin.suspend')}
    </Button>
  );

  return (
    <>
      <SpaceHeader title={t('admin.admins')} subtitle={t('admin.admins_sub')} headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-5xl lg:mx-auto lg:w-full space-y-4">
        {/* Ajouter un administrateur (par téléphone d'un compte existant) */}
        <CardPagne stitch="indigo" className="p-4">
          <p className="font-display font-extrabold text-[0.8125rem] text-stone-700 mb-2">{t('admin.add_admin')}</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder={t('admin.admin_phone')}
              aria-label={t('admin.admin_phone')}
              className="flex-1 bg-white card-pagne border border-stone-300 px-3 py-2 font-body text-base focus:outline-none focus:border-indigo-600"
            />
            <select
              aria-label={t('admin.preset')}
              value={preset}
              onChange={(e) => setPreset(e.target.value as AdminPreset)}
              className="card-pagne bg-white border border-stone-300 text-[0.875rem] font-display font-bold px-2 py-2 focus:outline-none focus:border-indigo-600"
            >
              {ADMIN_PRESET_NAMES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <Button variant="indigo" onClick={addAdmin} disabled={busy || phone.trim().length < 6}>
              {t('admin.add')}
            </Button>
          </div>
          <p className="text-[0.6875rem] text-stone-400 mt-1.5">{t('admin.add_admin_hint')}</p>
          {error && <p className="text-[0.75rem] text-sos-600 font-bold mt-1">{error}</p>}
        </CardPagne>

        {loading && <SkeletonCards label={t('common.loading')} />}
        {loadError && <ErrorState label={t('auth.error')} />}
        {!loading && !loadError && total === 0 && <Empty label={t('common.empty')} />}

        {/* Mobile : cartes */}
        <div className="lg:hidden space-y-3">
          {admins.map((a) => (
            <CardPagne key={a.id} stitch={a.suspendedAt ? 'sos' : false} className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display font-bold text-[0.875rem] truncate">{adminName(a)}</p>
                  <p className="text-[0.75rem] text-stone-400 truncate">{a.user.phone}</p>
                </div>
                {statusBadge(a)}
              </div>
              <div className="flex items-center justify-between gap-2">
                {presetSelect(a)}
                {toggleBtn(a)}
              </div>
              <p className="text-[0.625rem] text-stone-400">{a.scopes.length} {t('admin.scopes_count')}</p>
            </CardPagne>
          ))}
          {/* Pagination mobile — sinon les admins au-delà de la 1re page sont inatteignables. */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[0.6875rem] text-stone-400">
                {t('admin.results_range', { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, total), total })}
              </span>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="card-pagne bg-white border border-stone-200 text-stone-600 text-[0.75rem] font-display font-bold px-3 py-1.5 disabled:opacity-40">
                  <span aria-hidden="true">‹ </span>{t('admin.prev')}
                </button>
                <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page * PAGE_SIZE >= total} className="card-pagne bg-white border border-stone-200 text-stone-600 text-[0.75rem] font-display font-bold px-3 py-1.5 disabled:opacity-40">
                  {t('admin.next')}<span aria-hidden="true"> ›</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Desktop : table */}
        {admins.length > 0 && (
          <div className="hidden lg:block bg-white card-pagne border border-stone-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-creme">
                  <th className="text-left px-5 py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide">{t('admin.col_user')}</th>
                  <th className="text-left px-3 py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide">{t('admin.preset')}</th>
                  <th className="text-left px-3 py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide">{t('admin.col_scopes')}</th>
                  <th className="text-left px-3 py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide">{t('admin.col_status')}</th>
                  <th className="text-right px-5 py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide">{t('admin.col_action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {admins.map((a) => (
                  <tr key={a.id} className={cn('hover:bg-creme', a.suspendedAt && 'bg-sos-50/40')}>
                    <td className="px-5 py-3">
                      <p className="font-bold text-[0.8125rem] text-stone-900">{adminName(a)}</p>
                      <p className="text-[0.625rem] text-stone-400">{a.user.phone}</p>
                    </td>
                    <td className="px-3 py-3">{presetSelect(a)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {a.scopes.slice(0, 6).map((s) => (
                          <span key={s} className="px-1.5 py-0.5 card-pagne bg-indigo-50 text-indigo-600 text-[0.59375rem] font-mono">{s}</span>
                        ))}
                        {a.scopes.length > 6 && <span className="text-[0.625rem] text-stone-400">+{a.scopes.length - 6}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3">{statusBadge(a)}</td>
                    <td className="px-5 py-3 text-right">{toggleBtn(a)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total > PAGE_SIZE && (
              <div className="px-5 py-3 border-t border-stone-100 bg-creme flex items-center justify-between gap-2">
                <span className="text-[0.6875rem] text-stone-400">
                  {t('admin.results_range', { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, total), total })}
                </span>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="card-pagne bg-white border border-stone-200 text-stone-600 text-[0.75rem] font-display font-bold px-3 py-1.5 disabled:opacity-40">
                    <span aria-hidden="true">‹ </span>{t('admin.prev')}
                  </button>
                  <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page * PAGE_SIZE >= total} className="card-pagne bg-white border border-stone-200 text-stone-600 text-[0.75rem] font-display font-bold px-3 py-1.5 disabled:opacity-40">
                    {t('admin.next')}<span aria-hidden="true"> ›</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <ConfirmDialog
        open={!!pending}
        danger={!pending?.suspendedAt}
        busy={busy}
        title={pending?.suspendedAt ? t('admin.activate') : t('admin.suspend')}
        message={pending ? t(pending.suspendedAt ? 'admin.activate_admin_confirm' : 'admin.suspend_admin_confirm', { who: adminName(pending) }) : ''}
        confirmLabel={pending?.suspendedAt ? t('admin.activate') : t('admin.suspend')}
        onConfirm={confirmToggle}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
