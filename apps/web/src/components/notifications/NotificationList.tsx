'use client';

import { useEffect, useState } from 'react';

import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { notificationsApi, type AppNotification } from '@/lib/api/notifications';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/i18n/format';

// Centre de notifications de l'utilisateur courant, partagé par les espaces
// (patient, médecin…). `/notifications` est déjà borné au destinataire côté API.
// Thème par espace (§5, jamais mélangés) : seul l'accent change.
const ACCENT = {
  sante: { border: 'border-sante-200', dot: 'bg-sante-600' },
  indigo: { border: 'border-indigo-200', dot: 'bg-indigo-600' },
  ocre: { border: 'border-ocre-200', dot: 'bg-ocre-500' },
} as const;

export function NotificationList({ accent = 'sante' }: { accent?: keyof typeof ACCENT }) {
  const { t } = useLocale();
  const { data, loading, error } = useApi<AppNotification[]>(() => notificationsApi.list(), []);
  // Copie locale pour mise à jour optimiste du « lu » (pas de re-fetch complet).
  const [items, setItems] = useState<AppNotification[]>([]);
  useEffect(() => {
    setItems(data ?? []);
  }, [data]);
  const theme = ACCENT[accent];

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
      {loading && <SkeletonCards label={t('common.loading')} />}
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
                'pagne-focus w-full text-left card-pagne border px-4 py-3 flex gap-3 items-start',
                unread ? cn('bg-white', theme.border) : 'bg-creme-deep border-stone-200',
              )}
            >
              {unread && <span className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', theme.dot)} aria-hidden />}
              <div className="flex-1 min-w-0">
                <p className={cn('text-[0.875rem] truncate', unread ? 'font-display font-extrabold text-stone-800' : 'font-bold text-stone-600')}>
                  {n.title}
                </p>
                <p className="text-[0.8125rem] text-stone-500 whitespace-pre-line">{n.body}</p>
                <p className="text-[0.6875rem] text-stone-400 mt-0.5">
                  {formatDateTime(n.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
