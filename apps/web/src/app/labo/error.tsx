'use client';

import { SpaceError } from '@/components/spaces/SpaceError';

// Error boundary de l'espace Laboratoire : capture et surface les erreurs runtime.
export default function LaboError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SpaceError error={error} reset={reset} accent="ocre" homeHref="/labo" homeLabelKey="labo.title" />;
}
