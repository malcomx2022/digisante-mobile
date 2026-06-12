'use client';

import { useEffect, useState } from 'react';

import { useLocale } from '@/i18n/LocaleProvider';
import { pendingCount } from '@/lib/offline/queue';
import { useOnline } from '@/lib/offline/online';

/** Indicateur d'état réseau (D-13) : bannière or à trame quand hors-ligne. */
export function OfflineBanner() {
  const online = useOnline();
  const { t } = useLocale();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let active = true;
    pendingCount()
      .then((n) => active && setPending(n))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [online]);

  if (online) return null;

  return (
    <div className="wax-ocre bg-ocre-400 trame-tissee text-stone-900 text-[12px] font-display font-bold px-4 py-2 text-center" role="status" aria-live="polite">
      {t('offline.banner')}
      {pending > 0 && <span className="ml-1 font-extrabold">· {t('offline.pending', { n: pending })}</span>}
    </div>
  );
}
