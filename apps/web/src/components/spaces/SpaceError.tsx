'use client';

import Link from 'next/link';

import { Button } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';

type Accent = 'sante' | 'indigo' | 'ocre' | 'terre';

/**
 * UI de repli pour les error boundaries d'espace (Next.js `error.tsx`).
 * Surface l'erreur (message + digest en dev), propose un nouvel essai (`reset`)
 * et un retour à l'accueil de l'espace. Thème « Wax & Terre » par accent.
 */
export function SpaceError({
  error,
  reset,
  accent = 'terre',
  homeHref = '/',
  homeLabelKey = 'nav.home',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  accent?: Accent;
  homeHref?: string;
  homeLabelKey?: string;
}) {
  const { t } = useLocale();
  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <div className="flex-1 min-h-[60vh] flex items-center justify-center p-6">
      <div className="bg-white card-pagne stitch border border-stone-200 p-6 max-w-md w-full text-center">
        <p className="text-4xl mb-2" aria-hidden>
          ⚠️
        </p>
        <h1 className="font-display font-extrabold text-xl text-nuit">{t('auth.error')}</h1>
        {isDev && error?.message && (
          <pre className="mt-3 text-left text-[0.6875rem] text-sos-700 bg-creme-deep p-3 overflow-auto max-h-40 whitespace-pre-wrap">
            {error.message}
            {error.digest ? `\n(digest: ${error.digest})` : ''}
          </pre>
        )}
        <div className="mt-5 flex gap-2 justify-center">
          <Button variant={accent} onClick={reset}>
            {t('common.retry')}
          </Button>
          <Link
            href={homeHref}
            className="card-pagne px-4 py-2 text-[0.875rem] font-display font-bold bg-creme-deep text-stone-700"
          >
            {t(homeLabelKey)}
          </Link>
        </div>
      </div>
    </div>
  );
}
