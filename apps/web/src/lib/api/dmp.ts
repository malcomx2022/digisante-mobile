// Dossier médical partagé (DMP). L'accès soignant à un dossier patient passe par
// un partage consenti PAR SOIGNANT (§4) : réclamé via le jeton `x-share-token`,
// puis géré (liste/révocation) côté patient.
import { get, getBlob, delNow, postNow } from './client';

export interface DmpRecord {
  id: string;
  type: string;
  title: string;
  /** Identité et rôle authentifiés à la création ; null pour l'héritage inconnu. */
  authorId: string | null;
  authorRole: string | null;
  data?: unknown;
  /** Nombre de pièces jointes (fourni par la liste, évite un appel par entrée). */
  documentCount?: number;
  createdAt: string;
}

/** Pièce jointe d'une entrée (compte-rendu scanné, radio, ordonnance papier). */
export interface DmpDocument {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface DmpRecordDetail extends DmpRecord {
  documents: DmpDocument[];
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
  recordCount: number;
  /** Échéances indépendantes ; expiresAt du parent est un résumé d'affichage. */
  records: { recordId: string; expiresAt: string | null; active: boolean }[];
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
    postNow<DmpRecord>('/dmp/records', { type: 'VITAL_SIGNS', title: 'Auto-mesure', data: reading }).then(online),

  /** Soignants disposant (ou ayant disposé) d'un consentement sur mon dossier. */
  listConsents: () => get<DmpConsent[]>('/dmp/consents'),

  /** Révoque l'accès d'un soignant précis (révocation persistante). */
  revokeConsent: (granteeId: string) =>
    delNow<{ revoked: boolean }>(`/dmp/consents/${granteeId}`).then(online),

  /** Ré-autorise un soignant précédemment révoqué (action délibérée du patient). */
  regrantConsent: (granteeId: string, ttlHours = 72) =>
    postNow<{ granteeId: string; expiresAt: string; recordCount: number; requiresNewShare: boolean }>(`/dmp/consents/${granteeId}/regrant`, { ttlHours }).then(online),

  // ── Pièces jointes ──────────────────────────────────────────────────────────
  /** Détail d'une entrée, pièces jointes comprises. */
  getRecord: (recordId: string) => get<DmpRecordDetail>(`/dmp/records/${recordId}`),

  /** Joint un fichier à une entrée (chiffré au repos côté serveur). */
  addDocument: (recordId: string, filename: string, mimeType: string, dataBase64: string) =>
    postNow<DmpDocument>(`/dmp/records/${recordId}/documents`, { filename, mimeType, dataBase64 }).then(online),

  removeDocument: (documentId: string) => delNow<{ removed: boolean }>(`/dmp/documents/${documentId}`).then(online),

  /**
   * Télécharge une pièce. Passe par un blob authentifié : le fichier n'est
   * JAMAIS servi par une URL publique (§4), l'endpoint exige le jeton d'accès.
   */
  documentBlob: (documentId: string) => getBlob(`/dmp/documents/${documentId}/file`),
};
