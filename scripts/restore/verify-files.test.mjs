// B4 — une seule définition d'un fichier du magasin pour la sauvegarde et l'exercice de restauration.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check } from './verify-files.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SCRIPT = join(root, 'scripts/restore/verify-files.mjs');
const STORED = '0b9f4c2e-8a51-4d7b-9a43-2f6e1c5d7a10';
const SEED = { kind: 'KYC', encryptedUrl: 'https://example.invalid/seed/national-id.jpg', checksum: null };

function store(files) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-files-'));
  for (const name of files) writeFileSync(join(dir, `${name}.bin`), 'x');
  return dir;
}
const run = (dir, refs) => spawnSync(process.execPath, [SCRIPT, dir], {
  input: refs.map((r) => JSON.stringify(r)).join('\n'), encoding: 'utf8', env: { PATH: process.env.PATH },
});

test('B4 : référence d’amorçage (URL seed) hors magasin comptée à part, sans échec (comme pg_dump)', () => {
  const dir = store([STORED]);
  try {
    const refs = [{ kind: 'DMP', encryptedUrl: STORED, checksum: null }, SEED];
    assert.deepEqual(check(refs, dir), { referenced: 2, outsideStore: 1, missing: 0, sampled: 0, checksumMismatch: 0, undecryptable: 0 });
    const res = run(dir, refs);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /hors magasin=1 · manquants=0/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('B4 : fichier du magasin absent ⇒ échec, même avec des références hors magasin', () => {
  const dir = store([]);
  try {
    const res = run(dir, [{ kind: 'DMP', encryptedUrl: STORED, checksum: null }, SEED]);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /manquants=1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('B4 : une référence hors forme (chemin relatif) ne désigne jamais un fichier hors du répertoire restauré', () => {
  const parent = mkdtempSync(join(tmpdir(), 'verify-files-parent-'));
  try {
    const dir = join(parent, 'store'); writeFileSync(join(parent, 'outside.bin'), 'x');
    assert.equal(check([{ kind: 'DMP', encryptedUrl: '../outside', checksum: null }], dir).outsideStore, 1);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('B4 : même motif de référence du magasin que la sauvegarde (aucune dérive)', async () => {
  const { STORAGE_REF } = await import('./verify-files.mjs');
  const dump = readFileSync(join(root, 'infra/deploy/scripts/pg_dump_encrypted.sh'), 'utf8');
  const patterns = [...dump.matchAll(/ref ~ '([^']+)'/g)].map((m) => m[1]);
  assert.ok(patterns.length >= 2, 'motif introuvable dans pg_dump_encrypted.sh');
  for (const p of patterns) assert.equal(p, STORAGE_REF.source);
  // Forme réelle des identifiants du magasin (lib/filestore : randomUUID()).
  assert.ok(STORAGE_REF.test(STORED));
  assert.ok(!STORAGE_REF.test(SEED.encryptedUrl));
});
