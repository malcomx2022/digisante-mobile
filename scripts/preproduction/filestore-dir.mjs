#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// B4 — Magasin de fichiers chiffrés (pièces KYC + pièces jointes DMP = données de santé)
// résolu pour la sauvegarde EXACTEMENT comme l'API le résout :
//   • apps/api/src/lib/filestore.ts : resolve(KYC_STORAGE_DIR?.trim() || 'storage/kyc'),
//     relatif au répertoire courant du processus API ;
//   • ecosystem.config.cjs : cwd PM2 = apps/api ; apps/api/.env chargé par l'API elle-même
//     (apps/api/src/lib/env-file.ts, même analyseur et même priorité que `--env-file`).
// Priorité : KYC_STORAGE_DIR NON VIDE dans l'environnement de l'appelant (crontab root),
// sinon la valeur du .env de l'API, lue comme DONNÉES par `util.parseEnv` — le même
// analyseur que `--env-file` ; jamais `source`, jamais exécutée. Exige ensuite un
// répertoire existant, absolu, qui n'est pas un lien symbolique.
// Avant ce correctif, la sauvegarde lisait KYC_STORAGE_DIR dans l'environnement cron
// seulement : un magasin déplacé dans le .env laissait archiver le répertoire par
// défaut, VIDE, et `files_count=0` passait le contrôle.
// ⚠️ Le .env appartient à l'utilisateur applicatif : la valeur est HOSTILE pour root
// (B3). Le magasin retenu doit donc appartenir à CET utilisateur (uid attendu, jamais
// root), sans écriture groupe/autres, et porter un nom qui ne peut pas être lu comme
// une option (`-…`) par l'outil d'archivage. Une faute de frappe ou une valeur hostile
// (/etc/digisante, /root, /) échoue AVANT tout dump au lieu d'être archivée par root.
// CLI : KYC_STORAGE_DIR? API_ENV_FILE=<abs> [API_DIR=<abs>] FILESTORE_OWNER_UID=<uid>
//   node filestore-dir.mjs
//   → chemin sur stdout ; source/remarques sur stderr ; AUCUNE valeur du .env affichée.
// ─────────────────────────────────────────────────────────────
import { lstatSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const DEFAULT_STORAGE = 'storage/kyc';
/** Nom (dernier composant) accepté : jamais de « - » initial, aucun caractère que tar échappe. */
export const SAFE_STORE_NAME = /^[A-Za-z0-9._][A-Za-z0-9._@+-]*$/;

export class FilestoreError extends Error {}

/** Même règle que `resolveStorageDir` de l'API, avec son répertoire courant explicite. */
export function apiStorageDir(configured, apiDir) {
  return resolve(apiDir, configured?.trim() || DEFAULT_STORAGE);
}

/** Valeur brute de KYC_STORAGE_DIR dans le .env de l'API (undefined si absente). */
export function readApiEnvValue(envFile) {
  if (!envFile || !isAbsolute(envFile)) throw new FilestoreError('Fichier .env de l’API (API_ENV_FILE) : chemin absolu requis');
  let stat;
  try { stat = lstatSync(envFile); } catch { throw new FilestoreError('Fichier .env de l’API introuvable'); }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new FilestoreError('Fichier .env de l’API : fichier ordinaire requis');
  let parsed;
  try { parsed = parseEnv(readFileSync(envFile, 'utf8')); } catch { throw new FilestoreError('Fichier .env de l’API illisible'); }
  return Object.hasOwn(parsed, 'KYC_STORAGE_DIR') ? parsed.KYC_STORAGE_DIR : undefined;
}

export function resolveFilestoreDir({ explicit, envFile, apiDir, ownerUid } = {}) {
  if (!Number.isSafeInteger(ownerUid) || ownerUid <= 0) {
    throw new FilestoreError('Utilisateur applicatif (FILESTORE_OWNER_UID) : uid non root requis');
  }
  if (!apiDir || !isAbsolute(apiDir)) throw new FilestoreError('Répertoire de l’API (API_DIR) : chemin absolu requis');
  let fromEnvFile;
  let envFileError;
  try { fromEnvFile = readApiEnvValue(envFile); } catch (error) { envFileError = error; }
  const notes = [];
  let source;
  let configured;
  if (explicit?.trim()) {
    source = 'environnement (KYC_STORAGE_DIR explicite)';
    configured = explicit;
    if (!envFileError && apiStorageDir(fromEnvFile, apiDir) !== apiStorageDir(explicit, apiDir)) {
      notes.push('KYC_STORAGE_DIR explicite différent de celui du .env de l’API : valeur explicite retenue');
    }
  } else {
    if (envFileError) throw envFileError;
    configured = fromEnvFile;
    source = fromEnvFile?.trim() ? '.env de l’API' : 'défaut de l’API (storage/kyc)';
  }
  const dir = apiStorageDir(configured, apiDir);
  if (/[\u0000-\u001f\u007f]/.test(dir)) throw new FilestoreError('Chemin du magasin invalide (caractère de contrôle)');
  if (!SAFE_STORE_NAME.test(basename(dir))) {
    throw new FilestoreError('Nom du magasin refusé : lettres, chiffres et « . _ @ + - » seulement, jamais de « - » initial');
  }
  let stat;
  try { stat = lstatSync(dir); } catch { throw new FilestoreError('Magasin de fichiers introuvable'); }
  if (stat.isSymbolicLink()) throw new FilestoreError('Magasin de fichiers : lien symbolique refusé');
  if (!stat.isDirectory()) throw new FilestoreError('Magasin de fichiers : répertoire requis');
  if (stat.uid !== ownerUid) {
    throw new FilestoreError('Magasin de fichiers : doit appartenir à l’utilisateur applicatif (jamais root ni un autre compte)');
  }
  if (stat.mode & 0o022) throw new FilestoreError('Magasin de fichiers : modifiable par le groupe ou les autres comptes (0700 attendu)');
  return { dir, source, notes };
}

/** uid décimal strict (variable d'environnement) ; undefined sinon. */
export function parseOwnerUid(value) {
  return /^[0-9]{1,10}$/.test(value ?? '') ? Number(value) : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const envFile = process.env.API_ENV_FILE;
    const result = resolveFilestoreDir({
      explicit: process.env.KYC_STORAGE_DIR,
      envFile,
      apiDir: process.env.API_DIR || (envFile ? dirname(envFile) : undefined),
      ownerUid: parseOwnerUid(process.env.FILESTORE_OWNER_UID),
    });
    for (const note of result.notes) console.error(`[filestore] ${note}`);
    console.error(`[filestore] source : ${result.source}`);
    console.log(result.dir);
  } catch (error) {
    console.error(`[filestore] ${error instanceof FilestoreError ? error.message : 'résolution du magasin impossible'}`);
    process.exitCode = 1;
  }
}
