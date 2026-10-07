'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button, CardPagne, ConfirmDialog } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { formatDateTime } from '@/i18n/format';
import { spaceFor } from '@/auth/spaces';
import { flushQueue } from '@/lib/api/client';
import { allFailed, allQueued, failedCount, pendingCount, removeFailed, type FailedMutation, type QueuedMutation } from '@/lib/offline/queue';
import { useOnline } from '@/lib/offline/online';
import { useVault } from '@/lib/offline/useVault';

const category = (m: QueuedMutation) => m.onlineOnly ? 'vault.online_ticket' : m.path.startsWith('/chat/') ? 'chat.title' : m.path.startsWith('/vaccinations') ? 'vaccinations.title' : m.path.startsWith('/maternity') ? 'maternity.title' : m.path.startsWith('/notifications') ? 'notifications.title' : 'vault.legacy_action';
const reviewPath = (m: QueuedMutation, space: string) => m.onlineOnly ? space : m.path.startsWith('/chat/') ? `${space}/chat` : m.path.startsWith('/vaccinations') ? '/patient/vaccinations' : m.path.startsWith('/maternity') ? '/patient/maternity' : m.path.startsWith('/notifications') ? `${space}/notifications` : space;
export function SyncActions() {
  const { user } = useAuth(); const { t } = useLocale(); const online = useOnline(); const { open, tick } = useVault();
  const [queue, setQueue] = useState<QueuedMutation[]>([]); const [failed, setFailed] = useState<FailedMutation[]>([]);
  const [counts, setCounts] = useState({ pending: 0, failed: 0 }); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const [discard, setDiscard] = useState<FailedMutation | null>(null);
  useEffect(() => {
    let active = true; setQueue([]); setFailed([]); setCounts({ pending: 0, failed: 0 });
    Promise.all([pendingCount(), failedCount(), allQueued(), allFailed()]).then(([pending, failedCount, q, f]) => {
      if (active) { setCounts({ pending, failed: failedCount }); setQueue(q); setFailed(f); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [user?.id, open, tick]);
  async function resume() { setBusy(true); setError(false); try { await flushQueue(); } catch { setError(true); } finally { setBusy(false); } }
  return <CardPagne className="p-4 space-y-3">
    <h2 className="font-display font-extrabold">{t('offline.queue')}</h2>
    <p>{t('offline.pending', { n: counts.pending })} · {t('vault.failed', { n: counts.failed })}</p>
    <Button variant="outline" disabled={!online || busy} onClick={resume}>{t('vault.resume')}</Button>
    {queue.map((m) => <p key={m.id} className="text-[0.8125rem]">{t(category(m))} · {t(m.onlineOnly ? 'vault.online_ticket' : 'vault.pending')} · {formatDateTime(m.ts)}</p>)}
    {failed.map((m) => <div key={m.id} className="border-b border-dashed border-stone-200 py-2 space-y-1">
      <p className="font-bold text-[0.8125rem]">{t(category(m))} · {t('vault.review')}</p>
      <p className="text-[0.75rem]">{formatDateTime(m.ts)}</p>
      <p className="text-[0.75rem] text-stone-600">{t(m.onlineOnly ? 'vault.ticket_warning' : 'vault.review_warning')}</p>
      {!m.onlineOnly && open && typeof (m.body as { body?: unknown } | undefined)?.body === 'string' && <p className="whitespace-pre-wrap text-[0.8125rem]">{(m.body as { body: string }).body}</p>}
      {!m.onlineOnly && open && typeof (m.body as { name?: unknown } | undefined)?.name === 'string' && <p className="text-[0.8125rem]">{t('vaccinations.name')}: {(m.body as { name: string }).name}</p>}
      {!m.onlineOnly && open && typeof (m.body as { lmpDate?: unknown } | undefined)?.lmpDate === 'string' && <p className="text-[0.8125rem]">{t('maternity.lmp')}: {(m.body as { lmpDate: string }).lmpDate}</p>}
      {online && user && <a className="block min-h-11 underline decoration-dotted text-[0.8125rem]" href={reviewPath(m, spaceFor(user.role))}>{t('vault.check_online')}</a>}
      <Button variant="outline" disabled={busy} onClick={() => setDiscard(m)}>{t('vault.reviewed')}</Button>
    </div>)}
    {!open && counts.pending > 0 && <p>{t('vault.unlock_pending')}</p>}
    {error && <p role="alert" className="text-sos-600">{t('vault.error')}</p>}
    <ConfirmDialog confirmLabel={t('vault.reviewed')} open={discard !== null} danger busy={busy} title={t('vault.reviewed')} message={t('vault.review_warning')} onConfirm={async () => {
      if (!discard) return; setBusy(true);
      try { await removeFailed(discard.id); setDiscard(null); } catch { setError(true); } finally { setBusy(false); }
    }} onCancel={() => setDiscard(null)} />
  </CardPagne>;
}
