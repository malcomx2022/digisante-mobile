'use client';

import Link from 'next/link';

import { NotificationList } from '@/components/notifications/NotificationList';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { useLocale } from '@/i18n/LocaleProvider';

// Centre de notifications des espaces à en-tête générique (pharmacie, labo,
// diaspora, ASC). Sans cet écran, une notification in-app adressée à ces rôles
// (délivrance, transfert reçu, résultat, campagne…) n'était visible nulle part.
export function SpaceNotifications({
  headerClass,
  accent,
  profileHref,
}: {
  headerClass: string;
  accent: 'ocre' | 'sante';
  profileHref?: string;
}) {
  const { t } = useLocale();
  return (
    <>
      <SpaceHeader title={t('notifications.title')} headerClass={headerClass} profileHref={profileHref} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6 lg:max-w-5xl lg:mx-auto">
        <NotificationList accent={accent} />
      </main>
    </>
  );
}

/** Lien d'accès au centre de notifications depuis l'accueil d'un espace. */
export function NotificationsLink({ href, className = '' }: { href: string; className?: string }) {
  const { t } = useLocale();
  return (
    <Link href={href} className={`pagne-focus flex items-center gap-2 bg-white card-pagne border border-stone-200 px-4 py-3 font-display font-bold text-[0.8125rem] text-stone-700 ${className}`}>
      <span aria-hidden>🔔</span> {t('notifications.title')}
    </Link>
  );
}
