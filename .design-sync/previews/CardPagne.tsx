import { CardPagne } from '@digisante/web';

// Conteneur par défaut — coin coupé « pagne ».
export const Defaut = () => (
  <div className="p-5 bg-creme w-80">
    <CardPagne className="p-4">
      <h3 className="font-display font-extrabold text-base text-nuit m-0">Dossier médical</h3>
      <p className="text-sm text-stone-500 mt-1.5 mb-0">Hypertension artérielle — suivi mensuel</p>
    </CardPagne>
  </div>
);

// Coutures « fait main » — 1 par groupe visuel (terre / indigo PRO / SOS).
export const Coutures = () => (
  <div className="grid gap-3.5 p-5 bg-creme w-80">
    <CardPagne stitch="terre" className="p-4">
      <strong className="font-display">Carte patient</strong>
    </CardPagne>
    <CardPagne stitch="indigo" className="p-4">
      <strong className="font-display">Carte médecin (PRO)</strong>
    </CardPagne>
    <CardPagne stitch="sos" className="p-4">
      <strong className="font-display text-sos-600">Alerte critique</strong>
    </CardPagne>
  </div>
);
