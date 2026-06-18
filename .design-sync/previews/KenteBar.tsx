import { KenteBar } from '@digisante/web';

// Frise kenté — ferme le bas d'un header sombre.
export const Header = () => (
  <div className="w-80 p-5 bg-creme">
    <div className="bg-nuit card-pagne relative overflow-hidden h-20">
      <div className="p-3 text-white font-display font-extrabold">Espace Patient</div>
      <KenteBar className="absolute bottom-0 inset-x-0" />
    </div>
  </div>
);
