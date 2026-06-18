import { Badge } from '@digisante/web';

// Les 5 variantes de statut / niveau.
export const Variantes = () => (
  <div className="flex flex-wrap items-center gap-2 p-5 bg-creme">
    <Badge variant="normal">Actif</Badge>
    <Badge variant="eleve">En attente</Badge>
    <Badge variant="priorite">Prioritaire</Badge>
    <Badge variant="pro">PRO</Badge>
    <Badge variant="indigo">Vérifié</Badge>
  </div>
);

// En usage : badges accolés à un libellé.
export const EnContexte = () => (
  <div className="flex items-center gap-2 p-5 bg-creme">
    <span className="font-display font-extrabold text-nuit">Dr. Awa Koffi</span>
    <Badge variant="pro">PRO</Badge>
    <Badge variant="indigo">Vérifié</Badge>
  </div>
);
