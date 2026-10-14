// ─────────────────────────────────────────────────────────────
// provision-ionos.sh — dry-run, gardes, B3, B4, rollback et application simulée, sur une
// ARBORESCENCE TEMPORAIRE (PROVISION_TEST_ROOT) avec des commandes simulées (PATH) :
// jamais /, /etc, /var réels, jamais un vrai psql, valkey-cli, nginx, certbot ou useradd.
// ─────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, chownSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT_REL = 'infra/deploy/scripts/provision-ionos.sh';
const PG_SECRET = 'SYNTHETIC_PG_SECRET_0123456789abcdef';
const VALKEY_SECRET = 'SYNTHETIC_VALKEY_SECRET_abcdef';
const ROOT_LIST = readFileSync(resolve(ROOT, 'infra/deploy/root-scripts.list'), 'utf8').split('\n')
  .map((l) => /^(0755|0644) (\S+)$/.exec(l)).filter(Boolean).map((m) => ({ mode: parseInt(m[1], 8), path: m[2] }));
const ME = userInfo().username;
const UID = process.getuid();
const REAL_STAT = spawnSync('bash', ['-c', 'command -v stat'], { encoding: 'utf8' }).stdout.trim();
// Compte applicatif simulé : jamais root (filestore-dir.mjs refuse un magasin de root) ; en root, `nobody`.
const APP_UID = UID === 0 ? 65534 : UID;
const STORE_IDS = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];

const ENVS = {
  preproduction: { site: 'digisante-preprod', lib: '/usr/local/lib/digisante-preprod', app: 'digisante-preprod', db: 'digisante_preprod', idx: 5, ports: [3100, 3101] },
  production: { site: 'digisante', lib: '/usr/local/lib/digisante', app: 'digisante', db: 'digisante', idx: 6, ports: [3200, 3201] },
};

/** Commandes simulées : chaque appel est tracé ; le comportement suit des variables FAKE_*. */
const FAKES = {
  // Certains exécuteurs mappent root vers nobody pour / et /tmp. Normaliser ces
  // deux ancêtres extérieurs à la fixture, sans changer leurs modes ni les fichiers testés.
  stat: `p="\${@: -1}"
if [[ "$1" == -c && "$2" == '%u %a' && ( "$p" == / || "$p" == "$FAKE_ROOT_PARENT" ) ]]; then
  printf '0 %s\\n' "$("$REAL_STAT" -c %a -- "$p")"
else exec "$REAL_STAT" "$@"; fi`,
  id: `u="\${@: -1}"; line="$(printf '%s\\n' "\${FAKE_USERS:-}" | tr ';' '\\n' | grep "^$u:" || true)"
[[ -n "$line" ]] || exit 1
IFS=: read -r _ uid gid groups <<<"$line"
case "$1" in -u) echo "$uid";; -g) echo "$gid";; -nG) echo "$groups";; *) echo "uid=$uid";; esac`,
  getent: `case "$1" in
group) [[ "\${FAKE_NO_SSHUSERS:-0}" == 1 ]] && exit 2; echo "$2:x:950:";;
ahostsv4) [[ "\${FAKE_DNS_BAD:-0}" == 1 ]] && { echo "203.0.113.9 STREAM $2"; exit 0; }; echo "31.70.148.167 STREAM $2";;
esac`,
  ss: `printf '%s\\n' "\${FAKE_SS:-LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:((\\"node\\",pid=4100,fd=19))
LISTEN 0 4096 127.0.0.1:3001 0.0.0.0:* users:((\\"grafana\\",pid=4200,fd=8))}"`,
  ps: `pid="\${@: -1}"; printf '%s\\n' "\${FAKE_PS:-4100:immipro;4200:grafana}" | tr ';' '\\n' | sed -n "s/^$pid://p"`,
  sudo: `args=(); while [[ "$1" == -* && "$1" != -- ]]; do case "$1" in -u) echo "sudo-as $2" >> "$TRACE"; shift 2;; *) shift;; esac; done; [[ "$1" == -- ]] && shift; exec "$@"`,
  psql: `sql=""; db=""; prev=""; for a in "$@"; do [[ "$prev" == -c ]] && sql="$a"; [[ "$prev" == -d ]] && db="$a"; prev="$a"; done
if [[ -z "$sql" ]]; then sql="$(cat)"; echo "psql-stdin $(tr '\\n' ' ' <<<"$sql")" >> "$TRACE"; exit 0; fi
case "$sql" in
*server_version_num*) echo "\${FAKE_PG_VERSION:-180006}";;
*rolsuper*) printf '%s' "\${FAKE_PG_ROLE_ATTR:-}";;
*"SELECT 1 FROM pg_roles"*) [[ -n "\${FAKE_PG_ROLE_ATTR:-}" ]] && echo 1;;
*pg_get_userbyid*) printf '%s' "\${FAKE_PG_DB_OWNER:-}";;
*"SELECT 1 FROM pg_database"*) [[ -n "\${FAKE_PG_DB_OWNER:-}" ]] && echo 1;;
*pg_hba_file_rules*) echo "\${FAKE_PG_HBA:-1}";;
*has_database_privilege*) echo "\${FAKE_PG_PUBLIC:-f}";;
*to_regclass*)
  echo "psql-files-db $db" >> "$TRACE"
  [[ "$db" == "$FAKE_APP_DB" && "\${FAKE_PG_QUERY_FAILURE:-}" != tables ]] || exit 1
  echo "\${FAKE_PG_TABLES:-2}";;
*kyc_documents*)
  echo "psql-files-db $db" >> "$TRACE"
  [[ "$db" == "$FAKE_APP_DB" ]] || exit 1
  [[ "\${FAKE_PG_QUERY_FAILURE:-}" != refs ]] || exit 1
  printf '%s' "\${FAKE_PG_REF_IDS:-}";;
*) echo "psql-c $sql" >> "$TRACE";;
esac
exit 0`,
  'valkey-cli': `[[ "\${REDISCLI_AUTH:-}" == "\${FAKE_VALKEY_PASS:-}" && -n "\${REDISCLI_AUTH:-}" ]] || { echo "NOAUTH"; exit 0; }
n=0; args=(); while (($#)); do case "$1" in -h|-p|--user) shift 2;; --no-auth-warning) shift;; -n) n="$2"; shift 2;; *) args+=("$1"); shift;; esac; done
case "\${args[0]}" in
PING) echo PONG;;
DBSIZE) v="FAKE_VALKEY_SIZE_$n"; echo "\${!v:-0}";;
GET) v="FAKE_VALKEY_OWNER_$n"; if [[ -f "$TRACE.owner.$n" ]]; then cat "$TRACE.owner.$n"; else printf '%s' "\${!v:-}"; fi;;
SET) echo "valkey-write $n \${args[*]}" >> "$TRACE"; [[ -f "$TRACE.owner.$n" ]] || printf '%s' "\${args[2]}" > "$TRACE.owner.$n"; echo OK;;
*) echo "valkey-write $n \${args[*]}" >> "$TRACE"; echo OK;;
esac`,
  node: `if [[ "$1" == -v ]]; then echo "\${FAKE_NODE_VERSION:-v24.21.0}"; exit 0; fi; exec "$REAL_NODE" "$@"`,
  npm: `case "$1" in root) echo /usr/lib/node_modules;; *) echo "npm-write $*" >> "$TRACE";; esac`,
  nginx: `[[ "$1" == -t ]] && exit "\${FAKE_NGINX_T:-0}"; echo "nginx-write $*" >> "$TRACE"`,
  systemctl: `case "$1" in is-enabled) [[ "\${FAKE_PM2_ENABLED:-0}" == 1 ]];; *) echo "systemctl-write $*" >> "$TRACE";; esac`,
  crontab: `[[ "$1" == -l ]] && { printf '%s\\n' "\${FAKE_ROOT_CRONTAB:-}"; exit 0; }; echo "crontab-write $*" >> "$TRACE"`,
  corepack: `echo "corepack-write $*" >> "$TRACE"`,
};
for (const name of ['useradd', 'usermod', 'adduser', 'createdb', 'certbot', 'pm2', 'openssl']) FAKES[name] = `echo "${name}-write $*" >> "$TRACE"`;
// Application simulée : copie/dossiers réels DANS la racine de test, propriétaires ignorés.
const FAKE_INSTALL = `echo "install-write $*" >> "$TRACE"; dir=0; mode=""; files=()
while (($#)); do case "$1" in -d) dir=1; shift;; -o|-g) shift 2;; -m) mode="$2"; shift 2;; --) shift;; *) files+=("$1"); shift;; esac; done
if ((dir)); then mkdir -p "\${files[@]}"; [[ -n "$mode" ]] && chmod "$mode" "\${files[@]}"; else cp -- "\${files[0]}" "\${files[1]}"; [[ -n "$mode" ]] && chmod "$mode" "\${files[1]}"; fi; exit 0`;

function copyRootTree(lib) {
  for (const { mode, path } of ROOT_LIST) {
    mkdirSync(dirname(join(lib, path)), { recursive: true, mode: 0o755 });
    copyFileSync(resolve(ROOT, path), join(lib, path)); chmodSync(join(lib, path), mode);
  }
}

function fixture(env = 'preproduction', { osVersion = '26.04', fakeInstall = false } = {}) {
  const e = ENVS[env];
  const dir = mkdtempSync(join(tmpdir(), 'provision-ionos-test.')); chmodSync(dir, 0o755);
  const t = (p) => join(dir, p);
  copyRootTree(t(e.lib));
  for (const p of ['etc/nginx/sites-available', 'etc/nginx/sites-enabled', 'etc/nginx/conf.d', 'etc/nginx/snippets', 'var/www', 'etc/cron.d', 'etc/logrotate.d', 'usr/lib/node_modules']) mkdirSync(t(p), { recursive: true });
  writeFileSync(t('etc/os-release'), `NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="${osVersion}"\n`);
  // Vhost d'une autre application de l'hôte partagé : jamais modifié ni désactivé.
  writeFileSync(t('etc/nginx/sites-available/immipro'), 'server {\n    listen 80;\n    server_name immipro.app;\n    location / { proxy_pass http://127.0.0.1:3000; }\n}\n');
  writeFileSync(t('etc/nginx/sites-enabled/immipro'), readFileSync(t('etc/nginx/sites-available/immipro')));
  const bin = t('bin'); mkdirSync(bin);
  const fakes = { ...FAKES, ...(fakeInstall ? { install: FAKE_INSTALL } : {}) };
  for (const [name, body] of Object.entries(fakes)) { writeFileSync(join(bin, name), `#!/bin/bash\nset -uo pipefail\n${body}\n`); chmodSync(join(bin, name), 0o755); }
  const trace = t('trace.log'); writeFileSync(trace, '');
  const baseEnv = {
    PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME ?? '/root', TRACE: trace, REAL_NODE: process.execPath,
    REAL_STAT, FAKE_ROOT_PARENT: dirname(dir),
    PROVISION_TEST_ROOT: dir, DIGISANTE_ENV: env, VALKEY_PASSWORD: VALKEY_SECRET, FAKE_VALKEY_PASS: VALKEY_SECRET,
    PG_APP_PASSWORD: PG_SECRET, LETSENCRYPT_EMAIL: 'ops@example.invalid', FAKE_APP_DB: e.db,
  };
  const run = (args = [], extra = {}) => spawnSync('bash', [t(join(e.lib, SCRIPT_REL)), ...args], { env: { ...baseEnv, ...extra }, encoding: 'utf8', timeout: 30_000 });
  const tree = () => {
    const out = {};
    const walk = (p) => { for (const n of readdirSync(p, { withFileTypes: true })) { const f = join(p, n.name); if (f === trace) continue; if (n.isDirectory()) walk(f); else out[f.slice(dir.length)] = createHash('sha256').update(readFileSync(f)).digest('hex'); } };
    walk(dir); return out;
  };
  return { dir, t, e, run, tree, trace: () => readFileSync(trace, 'utf8'), clean: () => rmSync(dir, { recursive: true, force: true }) };
}

const MUTATING = /^(useradd|usermod|adduser|createdb|certbot|pm2|openssl|corepack|install|npm|nginx|systemctl|crontab)-write|^valkey-write|^psql-(c|stdin)/m;

test('dry-run préproduction : gardes vertes, plan complet, AUCUNE écriture ni commande modifiante, secrets jamais affichés', () => {
  const f = fixture();
  try {
    const before = f.tree();
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    for (const expected of [
      'PASS  OS Ubuntu 26.04', 'NOTE  port 3000 occupé par un autre service', 'NOTE  port 3001 occupé par un autre service',
      '[plan] création de digisante-preprod', 'useradd --create-home --shell /bin/bash --user-group --groups sshusers digisante-preprod',
      'adduser --system --group --no-create-home --home /nonexistent --shell /usr/sbin/nologin digisante-preprod-jobs',
      'répertoire /var/www/digisante-preprod (digisante-preprod:digisante-preprod 0750)', 'répertoire /var/lib/digisante-preprod-files (digisante-preprod:digisante-preprod 0700)',
      'répertoire /etc/digisante-preprod (root:root 0700)', 'CREATE ROLE … LOGIN NOSUPERUSER', "PASSWORD (\\getenv PG_APP_PASSWORD, fourni)",
      'createdb --owner=digisante_preprod --encoding=UTF8 --template=template0 -- digisante_preprod',
      'SET digisante:owner preproduction NX', 'npm install --global pm2@7.0.4', 'corepack install --global pnpm@9.12.0',
      'pm2 startup systemd -u digisante-preprod', 'clé de sauvegarde générée sur l\'hôte',
      'certbot certonly --webroot -w /var/www/digisante-acme --cert-name preprod.digisantemobile.app -d preprod.digisantemobile.app',
      '--dry-run', 'certbot renew --cert-name preprod.digisantemobile.app --dry-run',
      'vhost TLS digisante-preprod', '/etc/cron.d/digisante-preprod', '/etc/logrotate.d/digisante-preprod',
      'dry-run terminé : aucune écriture',
    ]) assert.ok(out.includes(expected), `plan sans « ${expected} »\n${out}`);
    assert.doesNotMatch(f.trace(), MUTATING, f.trace());
    assert.deepEqual(f.tree(), before, 'le dry-run a écrit dans l’arborescence');
    for (const secret of [PG_SECRET, VALKEY_SECRET]) { assert.ok(!out.includes(secret), 'secret affiché'); assert.ok(!f.trace().includes(secret), 'secret en argument'); }
    assert.doesNotMatch(out, /127\.0\.0\.1:300[01]/);
  } finally { f.clean(); }
});

test('B4 --verify : un fichier orphelin ne compense pas une référence absente, un lien ou un répertoire', () => {
  const f = fixture();
  try {
    const api = f.t('var/www/digisante-preprod/apps/api'); mkdirSync(api, { recursive: true });
    const store = f.t('var/lib/digisante-preprod-files'); mkdirSync(store, { recursive: true }); chmodSync(store, 0o700);
    if (UID === 0) chownSync(store, APP_UID, APP_UID);
    writeFileSync(join(api, '.env'), `KYC_STORAGE_DIR="${store}"\n`);
    const ref = STORE_IDS[0];
    const orphan = STORE_IDS[1];
    const extra = { FAKE_USERS: `digisante-preprod:${APP_UID}:${APP_UID}:digisante-preprod sshusers`, FAKE_PG_REF_IDS: ref };
    writeFileSync(join(store, `${orphan}.bin`), 'orphan');
    let r = f.run(['--verify'], extra);
    assert.match(r.stdout, /FAIL  B4 : 1 fichier\(s\) référencé\(s\) absent\(s\) ou non ordinaire\(s\) sur 1/);
    symlinkSync(join(store, `${orphan}.bin`), join(store, `${ref}.bin`));
    r = f.run(['--verify'], extra);
    assert.match(r.stdout, /FAIL  B4 : 1 fichier\(s\) référencé\(s\) absent\(s\) ou non ordinaire\(s\) sur 1/);
    rmSync(join(store, `${ref}.bin`)); mkdirSync(join(store, `${ref}.bin`));
    r = f.run(['--verify'], extra);
    assert.match(r.stdout, /FAIL  B4 : 1 fichier\(s\) référencé\(s\) absent\(s\) ou non ordinaire\(s\) sur 1/);
    rmSync(join(store, `${ref}.bin`), { recursive: true }); writeFileSync(join(store, `${ref}.bin`), 'present');
    r = f.run(['--verify'], extra);
    assert.match(r.stdout, /PASS  B4 : 1 référence\(s\) du magasin vérifiée\(s\), aucun fichier manquant/);
    assert.doesNotMatch(r.stdout + r.stderr, new RegExp(STORE_IDS.join('|')), 'identifiants de pièces affichés');
    assert.doesNotMatch(f.trace(), MUTATING);
  } finally { f.clean(); }
});

test('B4 --verify : seules les deux tables absentes reportent la comparaison ; erreur SQL ou schéma partiel ⇒ FAIL', () => {
  const f = fixture();
  try {
    const api = f.t('var/www/digisante-preprod/apps/api'); mkdirSync(api, { recursive: true });
    const store = f.t('var/lib/digisante-preprod-files'); mkdirSync(store, { recursive: true }); chmodSync(store, 0o700);
    if (UID === 0) chownSync(store, APP_UID, APP_UID);
    writeFileSync(join(api, '.env'), `KYC_STORAGE_DIR="${store}"\n`);
    const users = { FAKE_USERS: `digisante-preprod:${APP_UID}:${APP_UID}:digisante-preprod sshusers` };
    let r = f.run(['--verify'], { ...users, FAKE_PG_TABLES: '0' });
    assert.match(r.stdout, /NOTE  B4 : base digisante_preprod sans tables applicatives \(avant migration\) : comparaison des fichiers reportée/);
    for (const [extra, message] of [
      [{ FAKE_PG_TABLES: '1' }, /FAIL  B4 : tables applicatives incomplètes dans digisante_preprod/],
      [{ FAKE_PG_QUERY_FAILURE: 'tables' }, /FAIL  B4 : lecture des tables applicatives impossible dans digisante_preprod/],
      [{ FAKE_PG_QUERY_FAILURE: 'refs' }, /FAIL  B4 : lecture des références de fichiers impossible dans digisante_preprod/],
      [{ FAKE_PG_REF_IDS: '../../outside-store' }, /FAIL  B4 : résultat des références de fichiers invalide dans digisante_preprod/],
    ]) {
      r = f.run(['--verify'], { ...users, ...extra });
      assert.match(r.stdout, message, r.stdout + r.stderr);
      assert.doesNotMatch(r.stdout, /comparaison des fichiers reportée/);
    }
    r = f.run(['--verify'], users);
    assert.match(r.stdout, /PASS  B4 : 0 référence\(s\) du magasin vérifiée\(s\), aucun fichier manquant/);
    assert.doesNotMatch(f.trace(), MUTATING);
  } finally { f.clean(); }
});

test('dry-run production : domaines apex + www, ports 3200/3201, index Valkey 6, fichiers digisante', () => {
  const f = fixture('production');
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const expected of ['ports web/api=3200/3201', 'Valkey index 6', 'SET digisante:owner production NX', '--cert-name digisantemobile.app -d digisantemobile.app -d www.digisantemobile.app', '/etc/cron.d/digisante ', 'createdb --owner=digisante ']) {
      assert.ok(r.stdout.includes(expected), `${expected}\n${r.stdout}`);
    }
    assert.doesNotMatch(r.stdout, /preprod/);
  } finally { f.clean(); }
});

test('garde OS : Ubuntu ≠ 26.04 ⇒ refus avant tout plan ; provision.sh (22.04) refuse lui-même tout autre OS', () => {
  const f = fixture('preproduction', { osVersion: '22.04' });
  try {
    const r = f.run();
    assert.equal(r.status, 1); assert.match(r.stderr, /REFUS : OS ubuntu 22\.04 : ce script cible Ubuntu 26\.04/);
    assert.doesNotMatch(r.stdout, /\[plan\]/); assert.doesNotMatch(f.trace(), MUTATING);
  } finally { f.clean(); }
  const legacy = readFileSync(resolve(ROOT, 'infra/deploy/scripts/provision.sh'), 'utf8');
  const guard = legacy.indexOf("grep -qxE 'VERSION_ID=\"?22\\.04\"?' /etc/os-release");
  assert.ok(guard > 0 && guard < legacy.indexOf('timedatectl set-timezone'), 'provision.sh : garde 22.04 avant toute modification');
});

test('garde ports : port de l’environnement tenu par un autre compte ⇒ refus ; tenu par le compte applicatif ⇒ accepté ; 3000/3001 jamais touchés', () => {
  const squat = 'LISTEN 0 511 127.0.0.1:3101 0.0.0.0:* users:(("node",pid=777,fd=3))';
  let f = fixture();
  try {
    const r = f.run([], { FAKE_SS: squat, FAKE_PS: '777:immipro' });
    assert.equal(r.status, 1); assert.match(r.stderr, /port 3101 déjà écouté par « immipro »/); assert.doesNotMatch(f.trace(), MUTATING);
    const ok = f.run([], { FAKE_SS: squat, FAKE_PS: '777:digisante-preprod', FAKE_USERS: 'digisante-preprod:1001:1001:digisante-preprod sshusers' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  } finally { f.clean(); }
  // Vhost (copie root) visant un port réservé : refus.
  f = fixture();
  try {
    const vhost = f.t(join(f.e.lib, 'infra/deploy/nginx/digisante-preprod.conf'));
    chmodSync(vhost, 0o644); writeFileSync(vhost, readFileSync(vhost, 'utf8').replace('server 127.0.0.1:3101;', 'server 127.0.0.1:3001;'));
    const r = f.run();
    assert.equal(r.status, 1); assert.match(r.stderr, /vise un port réservé \(3000\/3001\)/);
  } finally { f.clean(); }
});

test('gardes de conflit : base d’un autre propriétaire, rôle privilégié, index Valkey occupé ou croisé, authentification ⇒ refus sans écriture', () => {
  const cases = [
    [{ FAKE_PG_DB_OWNER: 'immipro' }, /base digisante_preprod existe déjà avec un autre propriétaire \(immipro\)/],
    [{ FAKE_PG_ROLE_ATTR: 't' }, /rôle digisante_preprod existant avec des privilèges/],
    [{ FAKE_PG_VERSION: '160004' }, /PostgreSQL 160004 : 18\.x natif attendu/],
    [{ FAKE_VALKEY_SIZE_5: '12' }, /index 5 non vide \(12 clés\) sans marqueur preproduction/],
    [{ FAKE_VALKEY_SIZE_5: '3', FAKE_VALKEY_OWNER_5: 'production' }, /index 5 non vide/],
    [{ FAKE_VALKEY_OWNER_6: 'preproduction' }, /marqueur preproduction présent dans l'index 6/],
    [{ FAKE_VALKEY_PASS: 'other' }, /Valkey 127\.0\.0\.1:6379 injoignable ou authentification refusée/],
    [{ VALKEY_PASSWORD: '' }, /VALKEY_PASSWORD \(coffre\) requis/],
    [{ FAKE_USERS: 'digisante-preprod:1001:1001:digisante-preprod sshusers docker' }, /membre d'un groupe privilégié/],
    [{ FAKE_NO_SSHUSERS: '1' }, /groupe sshusers absent/],
    [{ FAKE_NODE_VERSION: 'v22.11.0' }, /Node 22 ≠ 24/],
  ];
  for (const [extra, expected] of cases) {
    const f = fixture();
    try {
      const r = f.run([], extra);
      assert.equal(r.status, 1, JSON.stringify(extra) + r.stdout); assert.match(r.stderr, expected, JSON.stringify(extra));
      assert.doesNotMatch(f.trace(), MUTATING); assert.doesNotMatch(r.stdout + r.stderr, new RegExp(VALKEY_SECRET));
    } finally { f.clean(); }
  }
  // Rejeu : index déjà réservé à CET environnement ⇒ accepté (idempotent).
  const f = fixture();
  try { assert.equal(f.run([], { FAKE_VALKEY_SIZE_5: '40', FAKE_VALKEY_OWNER_5: 'preproduction', FAKE_PG_ROLE_ATTR: 'f', FAKE_PG_DB_OWNER: 'digisante_preprod' }).status, 0); } finally { f.clean(); }
});

test('pg_hba sans connexion locale par mot de passe, DNS hors hôte ⇒ FAIL signalé, jamais corrigé par le script', () => {
  const f = fixture();
  try {
    const r = f.run([], { FAKE_PG_HBA: '0', FAKE_DNS_BAD: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL  pg_hba : aucune règle host 127\.0\.0\.1\/::1 scram-sha-256 pour digisante_preprod@digisante_preprod \(à ajouter À LA MAIN/);
    assert.match(r.stdout, /FAIL  DNS preprod\.digisantemobile\.app ne résout pas vers 31\.70\.148\.167/);
    assert.match(r.stderr, /2 garde\(s\) en échec/); assert.doesNotMatch(f.trace(), MUTATING);
  } finally { f.clean(); }
});

test('garde Nginx : domaine déjà servi par un autre vhost ou zone digisante redéfinie ⇒ refus ; vhost de l’autre environnement accepté', () => {
  let f = fixture();
  try {
    writeFileSync(f.t('etc/nginx/sites-enabled/old-digisante'), 'server {\n    server_name preprod.digisantemobile.app;\n}\n');
    const r = f.run();
    assert.equal(r.status, 1); assert.match(r.stderr, /domaine preprod\.digisantemobile\.app déjà déclaré par \/etc\/nginx\/sites-enabled\/old-digisante/);
  } finally { f.clean(); }
  f = fixture();
  try {
    writeFileSync(f.t('etc/nginx/conf.d/other.conf'), 'limit_req_zone $binary_remote_addr zone=digisante_rl_api:10m rate=1r/s;\n');
    const r = f.run();
    assert.equal(r.status, 1); assert.match(r.stderr, /zone ou format digisante_\* déjà défini dans \/etc\/nginx\/conf\.d\/other\.conf/);
  } finally { f.clean(); }
  // La production déjà installée (limit_req zone=digisante_rl_* , autre domaine) ne bloque pas la préproduction.
  f = fixture();
  try {
    writeFileSync(f.t('etc/nginx/sites-enabled/digisante'), readFileSync(resolve(ROOT, 'infra/deploy/nginx/digisante.conf')));
    writeFileSync(f.t('etc/nginx/conf.d/digisante-rate-limit.conf'), readFileSync(resolve(ROOT, 'infra/deploy/nginx/rate-limit.conf')));
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { f.clean(); }
});

test('B3 : crontab modèle lançant APP_DIR ou crontab root existante vers APP_DIR ⇒ refus ; crons installés depuis la copie root seulement', () => {
  let f = fixture();
  try {
    const cron = f.t(join(f.e.lib, 'infra/deploy/crontab.preproduction.example'));
    chmodSync(cron, 0o644); writeFileSync(cron, `${readFileSync(cron, 'utf8')}*/5 * * * * root /var/www/digisante-preprod/infra/deploy/scripts/healthwatch.sh\n`);
    const r = f.run();
    assert.equal(r.status, 1); assert.match(r.stderr, /B3 : le modèle de crontab exécute un chemin sous \/var\/www\/digisante-preprod/);
  } finally { f.clean(); }
  f = fixture();
  try {
    const r = f.run([], { FAKE_ROOT_CRONTAB: '0 2 * * * /var/www/digisante-preprod/infra/deploy/scripts/pg_dump_encrypted.sh' });
    assert.equal(r.status, 1); assert.match(r.stderr, /B3 : la crontab root lance un chemin sous \/var\/www\/digisante-preprod/);
  } finally { f.clean(); }
  f = fixture();
  try {
    const r = f.run(['--only', 'cron']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`install -o root -g root -m 0644 -- ${f.dir.replace(/[.]/g, '\\.')}/usr/local/lib/digisante-preprod/infra/deploy/crontab\\.preproduction\\.example ${f.dir.replace(/[.]/g, '\\.')}/etc/cron\\.d/digisante-preprod`));
    // Le .env désigné comme DONNÉE dans le cron n'est pas un exécutable (même règle que verify_deploy).
    const cron = f.t(join(f.e.lib, 'infra/deploy/crontab.preproduction.example'));
    chmodSync(cron, 0o644); writeFileSync(cron, `API_ENV_FILE=/var/www/digisante-preprod/apps/api/.env\n${readFileSync(cron, 'utf8')}`);
    assert.equal(f.run(['--only', 'cron']).status, 0);
  } finally { f.clean(); }
});

test('B4 --verify : KYC_STORAGE_DIR absolu exigé, magasin du compte applicatif, fichiers présents comparés aux références', () => {
  const f = fixture();
  try {
    const api = f.t('var/www/digisante-preprod/apps/api'); mkdirSync(api, { recursive: true });
    const store = f.t('var/lib/digisante-preprod-files'); mkdirSync(store, { recursive: true }); chmodSync(store, 0o700);
    if (UID === 0) chownSync(store, APP_UID, APP_UID);
    const envFile = join(api, '.env');
    const users = { FAKE_USERS: `digisante-preprod:${APP_UID}:${APP_UID}:digisante-preprod sshusers;digisante-preprod-jobs:${APP_UID - 1}:${APP_UID - 1}:digisante-preprod-jobs` };
    writeFileSync(envFile, 'KYC_STORAGE_DIR="storage/kyc"\nRECONCILE_TOKEN="x"\n');
    let r = f.run(['--verify'], users);
    assert.match(r.stdout, /FAIL  B4 : KYC_STORAGE_DIR doit être un chemin ABSOLU/);
    writeFileSync(envFile, `KYC_STORAGE_DIR="${store}"\n`);
    r = f.run(['--verify'], { ...users, FAKE_PG_REF_IDS: STORE_IDS.join('\n') });
    assert.match(r.stdout, /PASS  B4 : magasin KYC .*digisante-preprod-files \(absolu, digisante-preprod/);
    assert.match(r.stdout, /FAIL  B4 : 3 fichier\(s\) référencé\(s\) absent\(s\) ou non ordinaire\(s\) sur 3/);
    for (const id of STORE_IDS) writeFileSync(join(store, `${id}.bin`), 'x');
    r = f.run(['--verify'], { ...users, FAKE_PG_REF_IDS: STORE_IDS.join('\n') });
    assert.match(r.stdout, /PASS  B4 : 3 référence\(s\) du magasin vérifiée\(s\), aucun fichier manquant/);
    // Magasin ouvert en écriture au groupe/autres : refusé par le même module que la sauvegarde.
    chmodSync(store, 0o770);
    r = f.run(['--verify'], { ...users, FAKE_PG_REF_IDS: STORE_IDS.join('\n') });
    assert.match(r.stdout, /FAIL  B4 : magasin KYC refusé/);
    assert.notEqual(r.status, 0);
  } finally { f.clean(); }
});

test('B4 --verify interroge les fichiers dans la base applicative de chaque environnement, jamais postgres', () => {
  for (const env of ['preproduction', 'production']) {
    const f = fixture(env);
    try {
      const api = f.t(`var/www/${f.e.app}/apps/api`); mkdirSync(api, { recursive: true });
      const store = f.t(`var/lib/${f.e.app}-files`); mkdirSync(store, { recursive: true }); chmodSync(store, 0o700);
      if (UID === 0) chownSync(store, APP_UID, APP_UID);
      writeFileSync(join(api, '.env'), `KYC_STORAGE_DIR="${store}"\n`);
      const r = f.run(['--verify'], {
        FAKE_USERS: `${f.e.app}:${APP_UID}:${APP_UID}:${f.e.app} sshusers`, FAKE_PG_REF_IDS: STORE_IDS[0],
      });
      assert.match(f.trace(), new RegExp(`^psql-files-db ${f.e.db}$`, 'm'), f.trace());
      assert.doesNotMatch(f.trace(), /^psql-files-db postgres$/m);
      assert.match(r.stdout, /FAIL  B4 : 1 fichier\(s\) référencé\(s\) absent\(s\) ou non ordinaire\(s\) sur 1/);
      assert.doesNotMatch(r.stdout, /comparaison des fichiers reportée/);
      assert.doesNotMatch(f.trace(), MUTATING);
    } finally { f.clean(); }
  }
});

test('--apply : secrets requis contrôlés AVANT toute écriture ; mot de passe PG par \\getenv (stdin), Valkey par l’environnement', () => {
  let f = fixture('preproduction', { fakeInstall: true });
  try {
    const r = f.run(['--apply'], { PG_APP_PASSWORD: 'short' });
    assert.equal(r.status, 1); assert.match(r.stderr, /PG_APP_PASSWORD \(coffre, ≥ 24 caractères\) requis pour créer digisante_preprod — rien n'a été écrit/);
    assert.doesNotMatch(f.trace(), MUTATING);
    const r2 = f.run(['--apply'], { LETSENCRYPT_EMAIL: '' });
    assert.equal(r2.status, 1); assert.match(r2.stderr, /LETSENCRYPT_EMAIL requis/); assert.doesNotMatch(f.trace(), MUTATING);
  } finally { f.clean(); }
  f = fixture('preproduction', { fakeInstall: true });
  try {
    const r = f.run(['--apply', '--only', 'users,dirs,pg,valkey']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const trace = f.trace();
    assert.match(trace, /^useradd-write --create-home --shell \/bin\/bash --user-group --groups sshusers digisante-preprod$/m);
    assert.match(trace, /^psql-stdin \\getenv db_role DB_ROLE \\getenv db_pw PG_APP_PASSWORD SELECT format\('CREATE ROLE %I LOGIN NOSUPERUSER/m);
    assert.match(trace, /^createdb-write --owner=digisante_preprod/m);
    assert.match(trace, /^psql-c REVOKE ALL ON DATABASE "digisante_preprod" FROM PUBLIC; GRANT CONNECT, TEMPORARY ON DATABASE "digisante_preprod" TO "digisante_preprod";$/m);
    assert.match(trace, /^valkey-write 5 SET digisante:owner preproduction NX$/m);
    assert.ok(!trace.includes(PG_SECRET) && !trace.includes(VALKEY_SECRET), 'secret en argument d’une commande');
    assert.ok(!(r.stdout + r.stderr).includes(PG_SECRET));
    assert.equal(statSync(f.t('var/lib/digisante-preprod-files')).mode & 0o777, 0o700);
    assert.doesNotMatch(trace, /FLUSH|DEL |dropdb|DROP /i);
  } finally { f.clean(); }
});

test('--apply Nginx : vhost refusé par nginx -t ⇒ version précédente restaurée, vhost ImmiPro intact', () => {
  const f = fixture('preproduction', { fakeInstall: true });
  try {
    mkdirSync(f.t('etc/letsencrypt/live/preprod.digisantemobile.app'), { recursive: true });
    writeFileSync(f.t('etc/letsencrypt/live/preprod.digisantemobile.app/fullchain.pem'), 'CERT');
    writeFileSync(f.t('etc/nginx/sites-available/digisante-preprod'), '# version précédente\n');
    const immipro = readFileSync(f.t('etc/nginx/sites-available/immipro'));
    const r = f.run(['--apply', '--only', 'nginx'], { FAKE_NGINX_T: '1' });
    assert.equal(r.status, 1); assert.match(r.stderr, /nginx -t refuse le vhost digisante-preprod : version précédente restaurée/);
    assert.equal(readFileSync(f.t('etc/nginx/sites-available/digisante-preprod'), 'utf8'), '# version précédente\n');
    assert.deepEqual(readFileSync(f.t('etc/nginx/sites-available/immipro')), immipro);
    assert.match(f.trace(), /^certbot-write renew --cert-name preprod\.digisantemobile\.app --dry-run$/m);
    assert.doesNotMatch(f.trace(), /certbot-write certonly/, 'certificat présent : aucune émission');
  } finally { f.clean(); }
});

test('--rollback : retire vhost/cron/rotation/service PM2 seulement ; fichiers Nginx communs gardés si l’autre environnement est actif', () => {
  const f = fixture();
  try {
    for (const p of ['etc/nginx/sites-available/digisante-preprod', 'etc/nginx/sites-enabled/digisante-preprod', 'etc/cron.d/digisante-preprod', 'etc/logrotate.d/digisante-preprod', 'etc/nginx/conf.d/digisante-rate-limit.conf', 'etc/nginx/sites-enabled/digisante']) writeFileSync(f.t(p), '#\n');
    const before = f.tree();
    const r = f.run(['--rollback'], { FAKE_PM2_ENABLED: '1' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const expected of ['désactivation du vhost digisante-preprod', 'retrait de /etc/cron.d/digisante-preprod', 'retrait de /etc/logrotate.d/digisante-preprod', 'pm2 unstartup systemd -u digisante-preprod', 'fichiers Nginx communs conservés : digisante reste actif', 'conservés (décision humaine, sauvegarde préalable)']) {
      assert.ok(r.stdout.includes(expected), `${expected}\n${r.stdout}`);
    }
    assert.doesNotMatch(r.stdout, /\[plan\][^\n]*(userdel|dropdb|DROP|FLUSH|certbot delete|valkey)/i);
    assert.deepEqual(f.tree(), before, 'le rollback à blanc a écrit');
  } finally { f.clean(); }
});

test('statique : jamais de réinstallation, FLUSH, DROP, pg_hba, UFW, fuseau ni certbot --nginx ; dry-run par défaut', () => {
  const s = readFileSync(resolve(ROOT, SCRIPT_REL), 'utf8');
  const code = s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.match(code, /^MODE=dry-run; ACTION=provision/m);
  assert.doesNotMatch(code, /FLUSHDB|FLUSHALL|dropdb|DROP (DATABASE|ROLE)|userdel|apt-get|apt install|ufw |timedatectl|certbot[^\n]*--nginx|pg_hba\.conf|ALTER ROLE/);
  assert.doesNotMatch(code, /127\.0\.0\.1:300[01]|:3000\b|:3001\b/);
  assert.ok(ROOT_LIST.some((e) => e.path === SCRIPT_REL && e.mode === 0o755), 'script absent de root-scripts.list (B3)');
});

test('shellcheck : scripts d’exploitation sans avertissement', { skip: spawnSync('shellcheck', ['--version']).status !== 0 && 'shellcheck absent' }, () => {
  const dir = resolve(ROOT, 'infra/deploy/scripts');
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.sh'))) {
    const r = spawnSync('shellcheck', ['-S', 'warning', join(dir, name)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${name}\n${r.stdout}`);
  }
  const r = spawnSync('shellcheck', ['-S', 'style', resolve(ROOT, SCRIPT_REL)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  void existsSync; void ME;
});
