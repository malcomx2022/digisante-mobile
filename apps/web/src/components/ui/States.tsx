import { cn } from '@/lib/cn';

// États de chargement / erreur / vide réutilisables.
export function Loading({ label }: { label: string }) {
  return <div className="p-8 text-center text-stone-500 font-body text-sm" role="status" aria-live="polite">{label}</div>;
}

/** Bloc « squelette » animé (placeholder de contenu). `animate-pulse` est
 *  neutralisé sous `prefers-reduced-motion` (cf. patterns.css). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-stone-200/70 card-pagne', className)} aria-hidden="true" />;
}

/** Grille de cartes en chargement — réseaux lents (2G/rural) : on montre la
 *  forme du contenu plutôt qu'un simple texte. `label` reste lu par les lecteurs
 *  d'écran (visuellement masqué). */
export function SkeletonCards({ count = 4, label, columns = true, className }: { count?: number; label?: string; columns?: boolean; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={cn('grid gap-3 grid-cols-1', columns && 'sm:grid-cols-2', className)}>
      {label && <span className="sr-only">{label}</span>}
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white card-pagne border border-stone-200 p-4 space-y-2.5" aria-hidden="true">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ label, retryLabel, onRetry }: { label: string; retryLabel?: string; onRetry?: () => void }) {
  return (
    <div className="p-8 text-center" role="alert">
      <p className="text-sos-600 font-bold text-sm">{label}</p>
      {onRetry && retryLabel && (
        <button type="button" onClick={onRetry} className="mt-2 text-sante-700 underline decoration-dotted underline-offset-4 text-[0.8125rem]">
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function Empty({ label }: { label: string }) {
  return <div className="p-8 text-center text-stone-500 font-body text-sm">{label}</div>;
}
