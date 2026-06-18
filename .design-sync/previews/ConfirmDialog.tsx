import { ConfirmDialog } from '@digisante/web';

// Modale de confirmation « Wax & Terre » (remplace window.confirm).
// L'overlay est `fixed inset-0` ; le wrapper en `transform` crée un bloc de
// confinement pour qu'il se cadre proprement dans la carte (fond + modale).
export const Confirmation = () => (
  <div style={{ position: 'relative', width: 680, height: 400, overflow: 'hidden', transform: 'translateZ(0)' }}>
    <ConfirmDialog
      open
      title="Confirmer le rendez-vous"
      message="Téléconsultation avec Dr. Awa Koffi, demain à 10h00."
      confirmLabel="Confirmer"
      cancelLabel="Annuler"
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  </div>
);
