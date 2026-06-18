// États de chargement / erreur / vide réutilisables.
export function Loading({ label }: { label: string }) {
  return <div className="p-8 text-center text-stone-500 font-body text-sm" role="status" aria-live="polite">{label}</div>;
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
