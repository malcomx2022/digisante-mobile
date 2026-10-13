#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Cohérence base ↔ magasin de fichiers APRÈS RESTAURATION (B5). Lecture seule.
// stdin : une ligne JSON { kind, id, encryptedUrl, checksum|null } par fichier
// référencé en base (Document du DMP, KycDocument). Argument : répertoire restauré.
//   ⓪ même définition qu'à la sauvegarde (pg_dump_encrypted.sh, B4) : seule une référence
//      de la forme STORAGE_REF désigne un fichier du magasin ; les autres (URL d'amorçage du
//      seed) ne sont pas archivées, comptées « hors magasin » sans échec ni accès disque ;
//   ① chaque fichier du magasin référencé EXISTE dans le magasin restauré ;
//   ② si HEALTH_ENCRYPTION_KEY est fournie (environnement, jamais en argument) :
//      déchiffre un ÉCHANTILLON (SAMPLE, défaut 20) et compare le SHA-256 du clair
//      à `checksum` (Document). Aucun contenu, nom de fichier ni identifiant affiché.
// ─────────────────────────────────────────────────────────────
import { createDecipheriv, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Identifiant du magasin (lib/filestore : randomUUID()) ; motif repris à l'identique par
// pg_dump_encrypted.sh (test de dérive scripts/restore/verify-files.test.mjs).
export const STORAGE_REF = /^[0-9a-f-]{36}$/;

export function decryptStored(payload, key) {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(payload.subarray(28)), d.final()]);
}

export function check(refs, dir, secret, sample = 20) {
  const res = { referenced: refs.length, outsideStore: 0, missing: 0, sampled: 0, checksumMismatch: 0, undecryptable: 0 };
  const key = secret ? createHash('sha256').update(secret).digest() : null;
  for (const r of refs) {
    if (typeof r.encryptedUrl !== 'string' || !STORAGE_REF.test(r.encryptedUrl)) { res.outsideStore++; continue; }
    const p = join(dir, `${r.encryptedUrl}.bin`);
    if (!existsSync(p)) { res.missing++; continue; }
    if (!key || !r.checksum || res.sampled >= sample) continue;
    res.sampled++;
    try {
      const clear = decryptStored(readFileSync(p), key);
      if (createHash('sha256').update(clear).digest('hex') !== r.checksum) res.checksumMismatch++;
    } catch { res.undecryptable++; }
  }
  return res;
}

function main() {
  const dir = resolve(process.argv[2] ?? '.');
  const input = readFileSync(0, 'utf8').trim();
  const refs = input ? input.split('\n').map((l) => JSON.parse(l)) : [];
  const r = check(refs, dir, process.env.HEALTH_ENCRYPTION_KEY, Number(process.env.SAMPLE ?? 20));
  console.log(`[files] référencés=${r.referenced} · hors magasin=${r.outsideStore} · manquants=${r.missing} · échantillon déchiffré=${r.sampled} · checksum ≠=${r.checksumMismatch} · indéchiffrables=${r.undecryptable}`);
  if (r.missing || r.checksumMismatch || r.undecryptable) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
