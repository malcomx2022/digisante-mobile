// ─────────────────────────────────────────────────────────────
// Validation des téléversements (pièces KYC, pièces jointes du DMP).
// Le MIME déclaré par le client n'est JAMAIS cru sur parole : on vérifie les
// octets d'en-tête (magic bytes). Sans ce contrôle, un contenu actif (HTML,
// SVG scripté) pourrait être stocké sous un MIME d'image puis servi.
//
// Extrait de `kyc.service.ts` (août 2026) pour être partagé avec le DMP —
// une seule implémentation, un seul endroit à durcir.
// ─────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';

import { badRequest } from './errors.js';

/** Formats acceptés au téléversement (images + PDF). */
export const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

/**
 * Vérifie que les octets d'en-tête du fichier correspondent au type MIME déclaré.
 * Tout MIME hors liste renvoie `false` (liste blanche stricte).
 */
export function contentMatchesMime(b: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':
      return (
        b.length >= 8 &&
        b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
        b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
      );
    case 'image/webp':
      return b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    case 'application/pdf':
      return b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-';
    default:
      return false;
  }
}

/**
 * Décode un téléversement base64 et applique les contrôles de recevabilité :
 * lisible, non vide, sous la limite de taille, et contenu conforme au MIME déclaré.
 * Lève une erreur 400 explicite sinon.
 */
export function decodeUpload(dataBase64: string, mimeType: string, maxBytes: number): Buffer {
  let content: Buffer;
  try {
    content = Buffer.from(dataBase64, 'base64');
  } catch {
    throw badRequest('Contenu de fichier illisible (base64 attendu)');
  }
  if (content.length === 0) throw badRequest('Fichier vide');
  if (content.length > maxBytes) {
    throw badRequest(`Fichier trop volumineux (${Math.round(maxBytes / 1024 / 1024)} Mo maximum)`);
  }
  if (!contentMatchesMime(content, mimeType)) {
    throw badRequest('Le contenu du fichier ne correspond pas au type déclaré.');
  }
  return content;
}

/** Empreinte SHA-256 du contenu EN CLAIR (contrôle d'intégrité après déchiffrement). */
export function checksumOf(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
