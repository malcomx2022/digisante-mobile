'use client';

import { useEffect, useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { notificationsApi, type AppNotification } from '@/lib/api/notifications';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

// Centre de notifications du patient (rappels, RDV, résultats, paiements…).
export default function NotificationsPage() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<AppNotification[]>(() => notificationsApi.list(), []);
  // Copie locale pour mise à jour optimiste du « lu » (pas de re-fetch complet).
  const [items, setItems] = useState<AppNotification[]>([]);
  useEffect(() => {
    setItems(data ?? []);
  }, [data]);

  async function read(n: AppNotification) {
    if (n.readAt || n.status === 'READ') return;
    // Marquage optimiste local.
    const readAt = new Date().toISOString();
    setItems((cur) => cur.map((it) => (it.id === n.id ? { ...it, readAt, status: 'READ' } : it)));
    try {
      await notificationsApi.markRead(n.id);
    } catch {
      // Échec : on restaure l'état non-lu de cette notification.
      setItems((cur) => cur.map((it) => (it.id === n.id ? { ...it, readAt: n.readAt, status: n.status } : it)));
    }
  }

  return (
    <>
      <PatientHeader title={t('notifications.title')} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && items.length === 0 && <Empty label={t('notifications.empty')} />}

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
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
        </div>
      </main>
    </>
  );
}
