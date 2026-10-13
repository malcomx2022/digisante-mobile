// B4 — le magasin sauvegardé est celui que l'API utilise réellement.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, lchownSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apiStorageDir, readApiEnvValue, resolveFilestoreDir as resolveFor, FilestoreError } from './filestore-dir.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Utilisateur applicatif propriétaire du magasin : jamais root (en root : `nobody`).
const IS_ROOT = process.getuid?.() === 0;
const APP = IS_ROOT ? { uid: 65534, gid: 65534 } : { uid: process.getuid(), gid: process.getgid(), user: userInfo().username };
const resolveFilestoreDir = (options) => resolveFor({ ownerUid: APP.uid, ...options });
/** Répertoire conforme : 0700, propriété de l'utilisateur applicatif. */
function appStore(path) {
  mkdirSync(path, { recursive: true });
  chmodSync(path, 0o700);
  if (IS_ROOT) lchownSync(path, APP.uid, APP.gid);
  return path;
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'digisante-b4-'));
  const apiDir = join(dir, 'app/apps/api');
  appStore(join(apiDir, 'storage/kyc'));
  const envFile = join(apiDir, '.env');
  return { dir, apiDir, envFile, write: (text) => writeFileSync(envFile, text), clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test('B4 : même règle que resolveStorageDir de l’API (vide/blanc ⇒ storage/kyc, relatif au cwd de l’API)', () => {
  const api = '/srv/app/apps/api';
  for (const value of [undefined, '', '   ']) assert.equal(apiStorageDir(value, api), '/srv/app/apps/api/storage/kyc');
  assert.equal(apiStorageDir('  data/files  ', api), '/srv/app/apps/api/data/files');
  assert.equal(apiStorageDir('../../store', api), '/srv/app/store');
  assert.equal(apiStorageDir('/var/lib/digisante-files/', api), '/var/lib/digisante-files');
  // Non-dérive : si l'API ou PM2 changent leur règle, ce miroir doit être revu.
  assert.match(readFileSync(resolve(root, 'apps/api/src/lib/filestore.ts'), 'utf8'), /return resolve\(configured\?\.trim\(\) \|\| 'storage\/kyc'\);/);
  const pm2 = readFileSync(resolve(root, 'ecosystem.config.cjs'), 'utf8');
  assert.match(pm2, /cwd: '\.\/apps\/api'/);
  assert.match(pm2, /node_args: '--env-file=\.env'/);
});

test('B4 : .env lu comme données (guillemets, export, commentaires), valeur explicite prioritaire', () => {
  const f = fixture();
  try {
    const store = appStore(join(f.dir, 'relocated'));
    f.write(`# commentaire\nNODE_ENV=production\nJWT_SECRET='SYNTHETIC SECRET'\nexport KYC_STORAGE_DIR="${store}"\n`);
    assert.equal(readApiEnvValue(f.envFile), store);
    assert.deepEqual(resolveFilestoreDir({ envFile: f.envFile, apiDir: f.apiDir }), { dir: store, source: '.env de l’API', notes: [] });
    // KYC_STORAGE_DIR vide dans l'environnement = non défini (même règle que l'API).
    assert.equal(resolveFilestoreDir({ explicit: '  ', envFile: f.envFile, apiDir: f.apiDir }).dir, store);
    const explicit = resolveFilestoreDir({ explicit: join(f.apiDir, 'storage/kyc'), envFile: f.envFile, apiDir: f.apiDir });
    assert.equal(explicit.dir, join(f.apiDir, 'storage/kyc'));
    assert.equal(explicit.notes.length, 1, 'écart explicite/.env signalé');
    // Valeur explicite : .env absent toléré.
    rmSync(f.envFile);
    assert.equal(resolveFilestoreDir({ explicit: store, envFile: f.envFile, apiDir: f.apiDir }).dir, store);
    // Sans valeur explicite : .env indispensable (sinon répertoire inconnu ⇒ échec).
    assert.throws(() => resolveFilestoreDir({ envFile: f.envFile, apiDir: f.apiDir }), FilestoreError);
    f.write('NODE_ENV=production\n');
    assert.equal(resolveFilestoreDir({ envFile: f.envFile, apiDir: f.apiDir }).source, 'défaut de l’API (storage/kyc)');
  } finally { f.clean(); }
});

test('B4 : magasin absent, fichier, lien symbolique, chemin de contrôle et .env non ordinaire refusés', () => {
  const f = fixture();
  try {
    f.write('KYC_STORAGE_DIR=missing\n');
    assert.throws(() => resolveFilestoreDir({ envFile: f.envFile, apiDir: f.apiDir }), /introuvable/);
    writeFileSync(join(f.apiDir, 'plain'), 'x');
    f.write('KYC_STORAGE_DIR=plain\n');
    assert.throws(() => resolveFilestoreDir({ envFile: f.envFile, apiDir: f.apiDir }), /répertoire requis/);
    symlinkSync(join(f.apiDir, 'storage/kyc'), join(f.apiDir, 'link'));
    f.write('KYC_STORAGE_DIR=link\n');
    assert.throws(() => resolveFilestoreDir({ envFile: f.envFile, apiDir: f.apiDir }), /lien symbolique/);
    f.write('KYC_STORAGE_DIR="a\\nb"\n');
    assert.throws(() => resolveFilestoreDir({ envFile: f.envFile, apiDir: f.apiDir }), /caractère de contrôle/);
    const real = join(f.dir, 'real.env');
    writeFileSync(real, 'KYC_STORAGE_DIR=\n');
    rmSync(f.envFile); symlinkSync(real, f.envFile);
    assert.throws(() => resolveFilestoreDir({ envFile: f.envFile, apiDir: f.apiDir }), /fichier ordinaire/);
    assert.throws(() => resolveFilestoreDir({ envFile: 'relative/.env', apiDir: f.apiDir }), /absolu/);
    assert.throws(() => resolveFilestoreDir({ envFile: real, apiDir: 'relative' }), /absolu/);
  } finally { f.clean(); }
});

// Le .env appartient à l'utilisateur applicatif : sa valeur est hostile pour root (B3).
test('B3/B4 : magasin de root ou d’un autre compte, ouvert en écriture, ou nommé comme une option refusé', () => {
  const f = fixture();
  try {
    const refused = (value, pattern) => {
      f.write(`KYC_STORAGE_DIR="${value}"\n`);
      assert.throws(() => resolveFilestoreDir({ envFile: f.envFile, apiDir: f.apiDir }), pattern, value);
      assert.throws(() => resolveFilestoreDir({ explicit: value, envFile: f.envFile, apiDir: f.apiDir }), pattern, value);
    };
    // Répertoires de root désignés par le .env (secrets, racine) : jamais archivés par root.
    for (const value of ['/etc', '/root', '/']) refused(value, /appartenir à l’utilisateur applicatif|Nom du magasin refusé|introuvable/);
    refused('/etc', /appartenir à l’utilisateur applicatif/);
    if (IS_ROOT) {
      const rootOwned = join(f.dir, 'root-owned');
      mkdirSync(rootOwned, { mode: 0o700 });
      refused(rootOwned, /appartenir/);
      const other = appStore(join(f.dir, 'other-account'));
      lchownSync(other, 65533, 65533);
      refused(other, /appartenir/);
    }
    // Écriture groupe/autres : un tiers pourrait y glisser des fichiers.
    for (const mode of [0o770, 0o707, 0o777]) {
      const shared = appStore(join(f.dir, `shared-${mode.toString(8)}`));
      chmodSync(shared, mode);
      refused(shared, /groupe ou les autres/);
    }
    // Noms lus comme une option par tar (« - » initial) ou échappés dans son index.
    for (const name of ['--checkpoint-action=exec=touch PWNED', '-T', '--files-from=x', 'a b', 'dossier-é']) {
      refused(appStore(join(f.dir, name)), /Nom du magasin refusé/);
    }
    // Uid applicatif absent ou root : refus avant toute lecture.
    for (const ownerUid of [undefined, 0, -1, 1.5, '1000']) {
      assert.throws(() => resolveFor({ ownerUid, envFile: f.envFile, apiDir: f.apiDir }), /uid non root requis/, String(ownerUid));
    }
    // Conforme : nom simple, 0700, propriété de l'utilisateur applicatif.
    const ok = appStore(join(f.dir, 'kyc.store_2026@v1+a-b'));
    f.write(`KYC_STORAGE_DIR="${ok}"\n`);
    assert.equal(resolveFilestoreDir({ envFile: f.envFile, apiDir: f.apiDir }).dir, ok);
  } finally { f.clean(); }
});

test('B4 : CLI — chemin seul sur stdout, aucune valeur du .env affichée, échec non nul', () => {
  const f = fixture();
  try {
    const cli = resolve(root, 'scripts/preproduction/filestore-dir.mjs');
    f.write('JWT_SECRET=SYNTHETIC_SECRET_VALUE\nKYC_STORAGE_DIR=\n');
    const cliEnv = { PATH: process.env.PATH, API_ENV_FILE: f.envFile, FILESTORE_OWNER_UID: String(APP.uid) };
    let r = spawnSync(process.execPath, [cli], { encoding: 'utf8', env: cliEnv });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${join(f.apiDir, 'storage/kyc')}\n`);
    assert.doesNotMatch(r.stdout + r.stderr, /SYNTHETIC_SECRET_VALUE/);
    f.write('JWT_SECRET=SYNTHETIC_SECRET_VALUE\nKYC_STORAGE_DIR=SYNTHETIC_SECRET_VALUE\n');
    r = spawnSync(process.execPath, [cli], { encoding: 'utf8', env: cliEnv });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.doesNotMatch(r.stderr, /SYNTHETIC_SECRET_VALUE/);
    // Sans uid applicatif valide (absent, root, non décimal) : aucun chemin rendu.
    f.write('KYC_STORAGE_DIR=\n');
    for (const uid of [undefined, '0', '-1', `${APP.uid} `, 'nobody']) {
      const env = { PATH: process.env.PATH, API_ENV_FILE: f.envFile, ...(uid === undefined ? {} : { FILESTORE_OWNER_UID: uid }) };
      r = spawnSync(process.execPath, [cli], { encoding: 'utf8', env });
      assert.equal(r.status, 1, String(uid));
      assert.equal(r.stdout, '', String(uid));
      assert.match(r.stderr, /uid non root requis/, String(uid));
    }
  } finally { f.clean(); }
});
