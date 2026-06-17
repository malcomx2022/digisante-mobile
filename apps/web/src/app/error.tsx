'use client';

import { SpaceError } from '@/components/spaces/SpaceError';

// Filet de sécurité global : capture les erreurs des segments sans boundary dédié.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SpaceError error={error} reset={reset} accent="terre" homeHref="/" homeLabelKey="nav.home" />;
}
