'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { spaceFor } from '@/auth/spaces';
import { useLocale } from '@/i18n/LocaleProvider';
import { useVault } from '@/lib/offline/useVault';
import { failedCount, pendingCount } from '@/lib/offline/queue';
import { useOnline } from '@/lib/offline/online';

/** Indicateur d'état réseau (D-13) : bannière or à trame quand hors-ligne. */
export function OfflineBanner() {
  const online = useOnline();
  const { t } = useLocale();
  const { tick } = useVault();
  const { user, cleanupFailed } = useAuth();
  const [failed, setFailed] = useState(0);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let active = true;
    failedCount().then((n) => active && setFailed(n)).catch(() => {});
    pendingCount()
      .then((n) => active && setPending(n))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [online, tick, user?.id]);

  if (cleanupFailed) return <p role="alert" className="bg-sos-50 px-4 py-3 text-sos-700">{t('vault.cleanup_failed')}</p>;
  if (online && !pending && !failed) return null;
  const target = user?.role === 'PATIENT' ? '/patient/offline' : user ? `${spaceFor(user.role)}/profile` : '/onboarding';

  return (
    <div className="wax-ocre bg-ocre-400 trame-tissee text-stone-900 text-[0.75rem] font-display font-bold px-4 py-2 text-center" role="status" aria-live="polite">
      <a href={target} className="underline decoration-dotted">{t(online ? 'vault.review_notice' : 'offline.banner')}</a>
      {pending > 0 && <span className="ml-1 font-extrabold">· {t('offline.pending', { n: pending })}</span>}
    </div>
  );
}
