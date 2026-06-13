'use client';

import Link from 'next/link';

import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';

/** Lien icône « profil » pour les en-têtes sombres (à placer dans le slot droit). */
export function HeaderProfileLink({ href, dark = true }: { href: string; dark?: boolean }) {
  const { t } = useLocale();
  return (
    <Link
      href={href}
      aria-label={t('profile.title')}
      title={t('profile.title')}
      className={cn(
        'card-pagne px-2 py-1 border',
        dark ? 'bg-white/15 border-white/20 text-white' : 'bg-stone-900/5 border-stone-300 text-nuit',
      )}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0" />
      </svg>
    </Link>
  );
}
