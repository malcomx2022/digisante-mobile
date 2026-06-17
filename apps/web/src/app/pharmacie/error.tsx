'use client';

import { SpaceError } from '@/components/spaces/SpaceError';

// Error boundary de l'espace Pharmacie : capture et surface les erreurs runtime.
export default function PharmacieError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SpaceError error={error} reset={reset} accent="ocre" homeHref="/pharmacie" homeLabelKey="pharmacie.title" />;
}
