// ─────────────────────────────────────────────────────────────
// Stockage de fichiers CHIFFRÉS sur le disque du VPS (décision P1 : pas de
// stockage objet externe, cohérent §3). Format sur disque : iv(12) | tag(16) |
// ciphertext — AES-256-GCM, clé dérivée de HEALTH_ENCRYPTION_KEY (repli
// JWT_SECRET en dev ; en production HEALTH_ENCRYPTION_KEY est obligatoire,
// cf. env.ts). Usage : pièces KYC (documents d'identité, §4 — jamais servies
// en clair ni via URL publique ; lecture par endpoint authentifié uniquement).
// ⚠️ Les fichiers ne sont PAS dans pg_dump : ajouter KYC_STORAGE_DIR au cron
// de sauvegarde du VPS.
// ─────────────────────────────────────────────────────────────
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { env } from './env.js';
import { deriveKey } from './crypto.js';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function storageDir(): string {
  return resolve(env.KYC_STORAGE_DIR ?? 'storage/kyc');
}

function fileKey(): Buffer {
  return deriveKey(env.HEALTH_ENCRYPTION_KEY ?? env.JWT_SECRET);
}

/** Identifiant de stockage opaque (jamais dérivé du contenu ni de l'utilisateur). */
function isValidStorageId(id: string): boolean {
  return /^[a-f0-9-]{36}$/.test(id);
}

/** Chiffre et écrit un fichier ; renvoie l'identifiant de stockage. */
export async function storeEncryptedFile(content: Buffer): Promise<string> {
  const id = randomUUID();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', fileKey(), iv);
  const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);

  await mkdir(storageDir(), { recursive: true });
  await writeFile(join(storageDir(), `${id}.bin`), payload);
  return id;
}

/** Relit et déchiffre un fichier stocké. Jette si l'id est invalide ou altéré. */
export async function readEncryptedFile(id: string): Promise<Buffer> {
  if (!isValidStorageId(id)) throw new Error('Identifiant de stockage invalide');
  const payload = await readFile(join(storageDir(), `${id}.bin`));
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', fileKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
