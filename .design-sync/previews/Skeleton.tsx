import { Skeleton } from '@digisante/web';

// Bloc squelette — placeholder de contenu (réseaux lents 2G/rural).
export const Lignes = () => (
  <div className="w-80 p-5 bg-creme space-y-2.5">
    <Skeleton className="h-4 w-2/3" />
    <Skeleton className="h-3 w-2/5" />
    <Skeleton className="h-3 w-1/3" />
  </div>
);
