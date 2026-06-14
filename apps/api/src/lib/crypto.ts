// ─────────────────────────────────────────────────────────────
// Chiffrement des données de santé au repos — AES-256-GCM (CLAUDE.md §4).
// Format de sortie : "iv:tag:ciphertext" (base64). La clé dérive de
// HEALTH_ENCRYPTION_KEY (SHA-256 → 32 octets). En dev sans clé, le chiffrement
// est désactivé (les données sont alors stockées en clair — JAMAIS en production).
// ─────────────────────────────────────────────────────────────
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { env } from './env.js';

/** Dérive une clé AES-256 (32 octets) depuis un secret arbitraire. */
export function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** Chiffre une valeur JSON avec une clé donnée (fonction pure, testable). */
export function encryptWithKey(key: Buffer, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

/** Déchiffre une charge "iv:tag:ciphertext" avec une clé donnée. */
export function decryptWithKey(key: Buffer, payload: string): unknown {
  const [ivB, tagB, dataB] = payload.split(':');
  if (!ivB || !tagB || !dataB) throw new Error('Charge chiffrée invalide');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]);
  return JSON.parse(out.toString('utf8'));
}

const KEY = env.HEALTH_ENCRYPTION_KEY ? deriveKey(env.HEALTH_ENCRYPTION_KEY) : null;

/** Le chiffrement au repos est-il actif ? (faux en dev sans clé). */
export const isEncryptionEnabled = KEY !== null;

/**
 * Prépare le stockage d'un contenu médical : chiffré si une clé est configurée,
 * sinon en clair (dev). Renvoie le couple à écrire dans MedicalRecord.
 */
export function sealMedicalData(value: unknown): { data: unknown; encryptedData: string | null } {
  if (KEY) return { data: undefined, encryptedData: encryptWithKey(KEY, value) };
  return { data: value, encryptedData: null };
}

/** Lit un contenu médical : déchiffre si nécessaire. */
export function openMedicalData(record: { data: unknown; encryptedData: string | null }): unknown {
  if (record.encryptedData) {
    if (!KEY) throw new Error('HEALTH_ENCRYPTION_KEY requise pour déchiffrer ce dossier');
    return decryptWithKey(KEY, record.encryptedData);
  }
  return record.data ?? null;
}

/**
 * Prépare le stockage d'un texte sensible (ex. message de chat patient↔médecin) :
 * chiffré si une clé est configurée, sinon en clair (dev). Renvoie le couple
 * { plain, encrypted } à écrire (body / encryptedBody).
 */
export function sealSensitiveText(text: string): { plain: string | null; encrypted: string | null } {
  if (KEY) return { plain: null, encrypted: encryptWithKey(KEY, text) };
  return { plain: text, encrypted: null };
}

/** Lit un texte sensible : déchiffre si nécessaire, sinon renvoie le clair. */
export function openSensitiveText(record: { plain: string | null; encrypted: string | null }): string {
  if (record.encrypted) {
    if (!KEY) throw new Error('HEALTH_ENCRYPTION_KEY requise pour déchiffrer ce message');
    return decryptWithKey(KEY, record.encrypted) as string;
  }
  return record.plain ?? '';
}
