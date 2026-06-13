'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';

type Variant = 'terre' | 'indigo' | 'sante' | 'ocre' | 'outline' | 'sos';

/**
 * Bouton de déconnexion universel. Appelle logout() (révocation serveur +
 * purge locale) puis redirige vers /login. Réutilisable dans chaque espace ;
 * le `variant` permet de respecter le thème de l'espace.
 */
export function LogoutButton({
  variant = 'outline',
  className,
  full = true,
}: {
  variant?: Variant;
  className?: string;
  full?: boolean;
}) {
  const { logout } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (busy) return;
    setBusy(true);
    try {
      await logout();
    } finally {
      router.replace('/login');
    }
  }

  return (
    <Button variant={variant} full={full} className={cn(className)} onClick={handle} disabled={busy}>
      {t('profile.logout')}
    </Button>
  );
}
