import { StatusBar } from '@digisante/web';

// Barre d'état en tête d'écran clair.
export const Clair = () => (
  <div className="w-80 p-5 bg-creme">
    <div className="bg-white card-pagne border border-stone-200">
      <StatusBar time="9:41" lang="FR" />
    </div>
  </div>
);

// Variante sur header sombre (scanner / vidéo).
export const Sombre = () => (
  <div className="w-80 p-5 bg-creme">
    <div className="bg-nuit card-pagne">
      <StatusBar dark time="9:41" lang="FON" />
    </div>
  </div>
);
