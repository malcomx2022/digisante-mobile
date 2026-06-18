import { ErrorState } from '@digisante/web';

export const Erreur = () => (
  <div className="w-80 p-5 bg-creme">
    <ErrorState label="Impossible de charger les rendez-vous." retryLabel="Réessayer" onRetry={() => {}} />
  </div>
);
