'use client';

import { useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { notificationsApi, type AppNotification } from '@/lib/api/notifications';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

// Centre de notifications du patient (rappels, RDV, résultats, paiements…).
export default function NotificationsPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useApi<AppNotification[]>(() => notificationsApi.list(), [tick]);

  async function read(n: AppNotification) {
    if (n.readAt || n.status === 'READ') return;
    try {
      await notificationsApi.markRead(n.id);
      setTick((x) => x + 1);
    } catch {
      /* best-effort */
    }
  }

  const items = data ?? [];

  return (
    <>
      <PatientHeader title={t('notifications.title')} />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && items.length === 0 && <Empty label={t('notifications.empty')} />}

        {items.map((n) => {
          const unread = !n.readAt && n.status !== 'READ';
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => read(n)}
              className={cn(
                'w-full text-left card-pagne border px-4 py-3 flex gap-3 items-start',
                unread ? 'bg-white border-sante-200' : 'bg-creme-deep border-stone-200',
              )}
            >
              {unread && <span className="mt-1.5 w-2 h-2 rounded-full bg-sante-600 shrink-0" aria-hidden />}
              <div className="flex-1 min-w-0">
                <p className={cn('text-[14px] truncate', unread ? 'font-display font-extrabold text-stone-800' : 'font-bold text-stone-600')}>
                  {n.title}
                </p>
                <p className="text-[13px] text-stone-500">{n.body}</p>
                <p className="text-[11px] text-stone-400 mt-0.5">
                  {new Date(n.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                </p>
              </div>
            </button>
          );
        })}
      </main>
    </>
  );
}
