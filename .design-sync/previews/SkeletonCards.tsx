import { SkeletonCards } from '@digisante/web';

// Grille de cartes en chargement — montre la forme du contenu.
export const Grille = () => (
  <div className="w-[440px] p-5 bg-creme">
    <SkeletonCards count={4} label="Chargement des rendez-vous…" />
  </div>
);
