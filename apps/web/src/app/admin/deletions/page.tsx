'use client';

import { useState } from 'react';

import { Badge, Button, CardPagne, ConfirmDialog } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { formatDateTime } from '@/i18n/format';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, postNow } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface DeletionRow {
  id: string;
  status: 'PENDING' | 'COMPLETED' | 'REJECTED';
  requestedAt: string;
  processedAt: string | null;
  rejectReason: string | null;
  user: { id: string; role: string; phone: string | null; name: string | null };
}

const inputClass = 'w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-indigo-600';

// Droit à l'effacement (APDP) — file des demandes. Lecture users:read ;
// exécution / refus users:write (le serveur tranche). §4 : identité et statut
// uniquement, jamais de contenu médical.
export default function AdminDeletions() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [target, setTarget] = useState<{ id: string; action: 'execute' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const list = useApi<DeletionRow[]>(() => get<DeletionRow[]>('/admin/deletion-requests'), [tick]);

  async function run() {
    if (!target || busy) return;
    setBusy(true);
    setError(false);
    try {
      await postNow(`/admin/deletion-requests/${target.id}/${target.action}`, target.action === 'reject' ? { reason: reason.trim() } : undefined);
      setTarget(null);
      setReason('');
      setTick((n) => n + 1);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SpaceHeader title={t('deletions.title')} subtitle={t('deletions.subtitle')} headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full space-y-3">
        {list.loading && <SkeletonCards label={t('common.loading')} />}
        {list.error && <ErrorState label={t('auth.error')} />}
        {!list.loading && !list.error && (list.data?.length ?? 0) === 0 && <Empty label={t('deletions.empty')} />}
        {(list.data ?? []).map((r) => (
          <CardPagne key={r.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-display font-bold text-[0.875rem] text-stone-800 truncate">{r.user.name ?? '—'}</p>
              <Badge variant={r.status === 'PENDING' ? 'eleve' : 'normal'}>{t(`deletions.status.${r.status}`)}</Badge>
            </div>
            <p className="text-[0.75rem] text-stone-500">
              {t(`role.${r.user.role}`)} · {r.user.phone ?? '—'} · {formatDateTime(r.requestedAt, { dateStyle: 'short', timeStyle: 'short' })}
            </p>
            {r.status === 'PENDING' && (
              <div className="flex gap-2">
                <Button variant="terre" className="text-[0.75rem] px-3 py-1.5" onClick={() => setTarget({ id: r.id, action: 'execute' })}>{t('deletions.execute')}</Button>
                <Button variant="outline" className="text-[0.75rem] px-3 py-1.5" onClick={() => setTarget({ id: r.id, action: 'reject' })}>{t('deletions.reject')}</Button>
              </div>
            )}
          </CardPagne>
        ))}
        <ConfirmDialog
          open={target !== null}
          title={target?.action === 'execute' ? t('deletions.execute') : t('deletions.reject')}
          message={target?.action === 'execute' ? t('deletions.execute_confirm') : undefined}
          confirmLabel={target?.action === 'execute' ? t('deletions.execute') : t('deletions.reject')}
          busy={busy || (target?.action === 'reject' && reason.trim().length < 3)}
          onConfirm={() => void run()}
          onCancel={() => { setTarget(null); setError(false); }}
        >
          {target?.action === 'reject' && (
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t('deletions.reason')} aria-label={t('deletions.reason')} className={inputClass} />
          )}
          {error && <p className="mt-2 text-[0.75rem] text-sos-600 font-bold" role="alert">{t('auth.error')}</p>}
        </ConfirmDialog>
      </main>
    </>
  );
}
