// États de chargement / erreur / vide réutilisables.
export function Loading({ label }: { label: string }) {
  return <div className="p-8 text-center text-stone-400 font-body text-sm" role="status">{label}</div>;
}

export function ErrorState({ label, retryLabel, onRetry }: { label: string; retryLabel?: string; onRetry?: () => void }) {
  return (
    <div className="p-8 text-center">
      <p className="text-sos-600 font-bold text-sm">{label}</p>
      {onRetry && retryLabel && (
        <button type="button" onClick={onRetry} className="mt-2 text-sante-700 underline decoration-dotted underline-offset-4 text-[13px]">
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function Empty({ label }: { label: string }) {
  return <div className="p-8 text-center text-stone-400 font-body text-sm">{label}</div>;
}
