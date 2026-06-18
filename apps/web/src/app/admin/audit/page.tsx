'use client';

import { useState } from 'react';

import { CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

interface AuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  ip: string | null;
  hash: string;
  createdAt: string;
}
interface Paginated {
  data: AuditEntry[];
  total: number;
}

const PAGE_SIZE = 25;

function ActionTag({ action }: { action: string }) {
  // Coloration par famille d'évènement sensible (cf. §4).
  const danger = /DENIED|FAIL|LOCKOUT|SUSPEND|REVOKE|CRITICAL|SOS/.test(action);
  const payment = /PAYMENT|KYC|DATA_EXPORT/.test(action);
  return (
    <span
      className={cn(
        'font-mono text-[11px] font-bold card-pagne px-2 py-0.5 whitespace-nowrap',
        danger ? 'bg-sos-50 text-sos-700' : payment ? 'bg-ocre-50 text-ocre-600' : 'bg-indigo-50 text-indigo-700',
      )}
    >
      {action}
    </span>
  );
}

// D-25 (part 2) — Journal d'audit (registre append-only, hash SHA-256 chaîné).
// Desktop : table dense + pagination. Mobile : cartes.
export default function AdminAudit() {
  const { t } = useLocale();
  const [page, setPage] = useState(1);
  const { data, loading, error } = useApi<Paginated>(() => get(`/admin/audit?page=${page}&pageSize=${PAGE_SIZE}`), [page]);

  const entries = data?.data ?? [];
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  function Pagination() {
    if (total <= PAGE_SIZE) return null;
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-stone-400">{t('admin.results_range', { from, to, total })}</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="card-pagne bg-white border border-stone-200 text-stone-600 text-[12px] font-display font-bold px-3 py-1.5 disabled:opacity-40">
            <span aria-hidden="true">‹ </span>{t('admin.prev')}
          </button>
          <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page * PAGE_SIZE >= total} className="card-pagne bg-white border border-stone-200 text-stone-600 text-[12px] font-display font-bold px-3 py-1.5 disabled:opacity-40">
            {t('admin.next')}<span aria-hidden="true"> ›</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <SpaceHeader title={t('admin.audit')} subtitle="Append-only · Loi N°2017-20" headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-5xl lg:mx-auto lg:w-full space-y-3">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && total === 0 && <Empty label={t('common.empty')} />}

        {/* ── Mobile : cartes ── */}
        <div className="lg:hidden space-y-2">
          {entries.map((e) => (
            <CardPagne key={e.id} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <ActionTag action={e.action} />
                <span className="text-[11px] text-stone-400 whitespace-nowrap">{new Date(e.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <p className="text-[11px] text-stone-400 mt-1 font-mono truncate">{e.ip ?? '—'} · #{e.hash.slice(0, 12)}</p>
            </CardPagne>
          ))}
          <Pagination />
        </div>

        {/* ── Desktop : table dense ── */}
        <div className="hidden lg:block bg-white card-pagne border border-stone-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-creme">
                {['admin.col_action', 'admin.col_actor', 'admin.col_ip', 'admin.col_hash', 'admin.col_date'].map((k, i) => (
                  <th key={k} className={cn('text-left py-2.5 text-[10px] font-extrabold text-stone-400 uppercase tracking-wide', i === 0 ? 'px-5' : 'px-3')}>
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-creme">
                  <td className="px-5 py-2.5"><ActionTag action={e.action} /></td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-stone-500">{e.actorId ? e.actorId.slice(0, 8) : '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-stone-500">{e.ip ?? '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-stone-400">#{e.hash.slice(0, 12)}</td>
                  <td className="px-3 py-2.5 text-[11.5px] text-stone-500 whitespace-nowrap">{new Date(e.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 border-t border-stone-100 bg-creme">
            <Pagination />
          </div>
        </div>
      </main>
    </>
  );
}
