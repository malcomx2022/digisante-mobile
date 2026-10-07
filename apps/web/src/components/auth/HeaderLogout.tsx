'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';

/**
 * Bouton icône de déconnexion pour les en-têtes sombres (à placer dans le slot
 * `right` de la StatusBar, à côté du LangSwitcher). Pictogramme « sortie ».
 */
export function HeaderLogout({ dark = true }: { dark?: boolean }) {
  const { logout } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (busy) return;
    setBusy(true);
    try {
      await logout();
    } catch {
      // L'échec d'effacement reste visible via AuthProvider ; session verrouillée.
    } finally {
      router.replace('/login');
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      aria-label={t('profile.logout')}
      title={t('profile.logout')}
      className={cn(
        'card-pagne px-2 py-1 border disabled:opacity-50',
        dark ? 'bg-white/15 border-white/20 text-white' : 'bg-stone-900/5 border-stone-300 text-nuit',
      )}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
      </svg>
    </button>
  );
}
