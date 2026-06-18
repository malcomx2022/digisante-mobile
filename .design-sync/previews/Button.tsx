import { Button } from '@digisante/web';

// Sweep des 6 variantes thématiques (1 par espace + outline + SOS).
export const Variantes = () => (
  <div className="flex flex-wrap gap-3 p-5 bg-creme">
    <Button variant="terre">Prendre RDV</Button>
    <Button variant="indigo">Espace PRO</Button>
    <Button variant="sante">Consulter</Button>
    <Button variant="ocre">Recharger le wallet</Button>
    <Button variant="outline">Annuler</Button>
    <Button variant="sos">Urgence SOS</Button>
  </div>
);

// Pleine largeur — CTA principal d'un écran.
export const PleineLargeur = () => (
  <div className="w-80 p-5 bg-creme">
    <Button variant="sante" full>Démarrer la téléconsultation</Button>
  </div>
);

// État désactivé vs actif.
export const Desactive = () => (
  <div className="flex gap-3 p-5 bg-creme">
    <Button variant="terre" disabled>Indisponible</Button>
    <Button variant="indigo">Confirmer</Button>
  </div>
);
