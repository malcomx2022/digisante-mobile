// Dossier médical partagé (DMP). L'accès soignant à un dossier patient passe par
// un jeton de partage consenti présenté dans l'en-tête `x-share-token` (§4).
import { get } from './client';

export interface DmpRecord {
  id: string;
  type: string;
  title: string;
  data?: unknown;
  createdAt: string;
}

export const dmpApi = {
  /** Dossier de l'utilisateur courant (patient propriétaire). */
  myRecords: () => get<DmpRecord[]>('/dmp/records'),

  /**
   * Dossier d'un patient consulté par un soignant, via un partage consenti actif.
   * Le `shareToken` (issu du QR/lien de partage du patient) est envoyé en en-tête.
   */
  recordsForPatient: (patientId: string, shareToken: string) =>
    get<DmpRecord[]>(`/dmp/records?patientId=${encodeURIComponent(patientId)}`, {
      headers: { 'x-share-token': shareToken },
    }),
};
