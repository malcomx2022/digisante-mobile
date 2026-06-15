// Dossier médical partagé (DMP). L'accès soignant à un dossier patient passe par
// un partage consenti PAR SOIGNANT (§4) : réclamé via le jeton `x-share-token`,
// puis géré (liste/révocation) côté patient.
import { del, get, post } from './client';

export interface DmpRecord {
  id: string;
  type: string;
  title: string;
  data?: unknown;
  createdAt: string;
}

/** Auto-mesure (constantes) saisie par le patient. */
export interface VitalReading {
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  glucose?: number;
  weight?: number;
  measuredAt?: string;
}

/** Consentement accordé à un soignant précis (vue patient). */
export interface DmpConsent {
  granteeId: string;
  name: string;
  role: string;
  speciality: string | null;
  expiresAt: string;
  grantedAt: string;
  active: boolean;
  revokedAt: string | null;
}

/** Lève si la mutation a été mise en file hors-ligne (action exigeant le réseau). */
function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
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

  /** Mes auto-mesures (constantes) — entrées DMP de type VITAL_SIGNS, plus récentes d'abord. */
  vitals: () => get<DmpRecord[]>('/dmp/records').then((rs) => rs.filter((r) => r.type === 'VITAL_SIGNS')),

  /** Enregistre une auto-mesure dans le DMP (chiffrée au repos côté serveur). */
  addVital: (reading: VitalReading) =>
    post<DmpRecord>('/dmp/records', { type: 'VITAL_SIGNS', title: 'Auto-mesure', data: reading }).then(online),

  /** Soignants disposant (ou ayant disposé) d'un consentement sur mon dossier. */
  listConsents: () => get<DmpConsent[]>('/dmp/consents'),

  /** Révoque l'accès d'un soignant précis (révocation persistante). */
  revokeConsent: (granteeId: string) =>
    del<{ revoked: boolean }>(`/dmp/consents/${granteeId}`).then(online),

  /** Ré-autorise un soignant précédemment révoqué (action délibérée du patient). */
  regrantConsent: (granteeId: string, ttlHours = 72) =>
    post<{ granteeId: string; expiresAt: string }>(`/dmp/consents/${granteeId}/regrant`, { ttlHours }).then(online),
};
