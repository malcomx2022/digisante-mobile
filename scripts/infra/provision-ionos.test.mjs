// ─────────────────────────────────────────────────────────────
// provision-ionos.sh — dry-run, gardes, B3, B4, rollback et application simulée, sur une
// ARBORESCENCE TEMPORAIRE (PROVISION_TEST_ROOT) avec des commandes simulées (PATH) :
// jamais /, /etc, /var réels, jamais un vrai psql, valkey-cli, nginx, certbot ou useradd.
// ─────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, chownSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
/** .env de l'API : fichier du compte applicatif simulé, 0600 (env_value refuse un autre propriétaire). */
function writeEnv(file, text) { writeFileSync(file, text); chmodSync(file, 0o600); if (UID === 0) chownSync(file, APP_UID, APP_UID); }
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
ahostsv6) echo "::ffff:31.70.148.167 STREAM $2"; [[ -n "\${FAKE_DNS_AAAA:-}" ]] && echo "$FAKE_DNS_AAAA STREAM $2"; exit 0;;
esac`,
  ss: `printf '%s\\n' "\${FAKE_SS:-LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:((\\"node\\",pid=4100,fd=19))
LISTEN 0 4096 127.0.0.1:3001 0.0.0.0:* users:((\\"grafana\\",pid=4200,fd=8))}"`,
  ps: `pid="\${@: -1}"; printf '%s\\n' "\${FAKE_PS:-4100:immipro;4200:grafana}" | tr ';' '\\n' | sed -n "s/^$pid://p"`,
  // sudo -l -U <compte> : autorisation sudoers simulée (FAKE_SUDO_ALLOWED, liste de comptes).
  sudo: `if [[ " $* " == *" -l "* ]]; then u="\${@: -1}"; if [[ ",\${FAKE_SUDO_ALLOWED:-}," == *",$u,"* ]]; then echo "User $u may run the following commands on host:"; else echo "User $u is not allowed to run sudo on host."; fi; exit 0; fi
args=(); while [[ "$1" == -* && "$1" != -- ]]; do case "$1" in -u) echo "sudo-as $2" >> "$TRACE"; shift 2;; *) shift;; esac; done; [[ "$1" == -- ]] && shift; exec "$@"`,
  // Sonde pg_hba (-w, conninfo 127.0.0.1) : FAKE_PG_HBA = password (défaut) | trust | none.
  psql: `if [[ " $* " == *" -w "* ]]; then
  echo "psql-probe $* pw=\${PG_APP_PASSWORD:+set}\${PGPASSWORD:+set} passfile=\${PGPASSFILE:-}" >> "$TRACE"
  case "\${FAKE_PG_HBA:-password}" in
  trust) echo 1; exit 0;;
  password) echo 'psql: error: connection to server at "127.0.0.1", port 5432 failed: fe_sendauth: no password supplied' >&2; exit 2;;
  *) echo 'psql: error: FATAL:  no pg_hba.conf entry for host "127.0.0.1"' >&2; exit 2;;
  esac
fi
sql=""; db=""; prev=""; for a in "$@"; do [[ "$prev" == -c ]] && sql="$a"; [[ "$prev" == -d ]] && db="$a"; prev="$a"; done
if [[ -z "$sql" ]]; then sql="$(cat)"; echo "psql-stdin $(tr '\\n' ' ' <<<"$sql")" >> "$TRACE"; echo "psql-env pw=\${PG_APP_PASSWORD:+set} verifier=\${PG_APP_VERIFIER:0:18}" >> "$TRACE"; exit 0; fi
case "$sql" in
*server_version_num*) echo "\${FAKE_PG_VERSION:-180006}";;
*pg_auth_members*) echo "\${FAKE_PG_MEMBERS:-0}";;
*rolsuper*) printf '%s' "\${FAKE_PG_ROLE_ATTR:-}";;
*"SELECT 1 FROM pg_roles"*) [[ -n "\${FAKE_PG_ROLE_ATTR:-}" ]] && echo 1;;
*pg_get_userbyid*) printf '%s' "\${FAKE_PG_DB_OWNER:-}";;
*"SELECT 1 FROM pg_database"*) [[ -n "\${FAKE_PG_DB_OWNER:-}" ]] && echo 1;;
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
CONFIG) [[ "\${FAKE_VALKEY_CONFIG_DENIED:-0}" == 1 ]] && { echo "NOPERM this user has no permissions to run the 'config|get' command"; exit 1; }
  case "\${args[2]}" in
  maxmemory) echo maxmemory; echo "\${FAKE_VALKEY_MAXMEM:-0}";;
  maxmemory-policy) echo maxmemory-policy; echo "\${FAKE_VALKEY_POLICY:-noeviction}";;
  appendonly) echo appendonly; echo "\${FAKE_VALKEY_AOF:-no}";;
  save) echo save; printf '%s\\n' "\${FAKE_VALKEY_SAVE-3600 1 300 100 60 10000}";;
  esac;;
DBSIZE) v="FAKE_VALKEY_SIZE_$n"; echo "\${!v:-0}";;
GET) v="FAKE_VALKEY_OWNER_$n"; if [[ -f "$TRACE.owner.$n" ]]; then cat "$TRACE.owner.$n"; else printf '%s' "\${!v:-}"; fi;;
SET) echo "valkey-write $n \${args[*]}" >> "$TRACE"; [[ -f "$TRACE.owner.$n" ]] || printf '%s' "\${args[2]}" > "$TRACE.owner.$n"; echo OK;;
*) echo "valkey-write $n \${args[*]}" >> "$TRACE"; echo OK;;
esac`,
  node: `if [[ "$1" == -v ]]; then echo "\${FAKE_NODE_VERSION:-v24.21.0}"; exit 0; fi; exec "$REAL_NODE" "$@"`,
  npm: `case "$1" in root) echo /usr/lib/node_modules;; *) echo "npm-write $*" >> "$TRACE"; echo "npm-env secrets=\${PG_APP_PASSWORD:+pg}\${VALKEY_PASSWORD:+valkey}" >> "$TRACE";; esac`,
  // nginx -t : échec global (FAKE_NGINX_T) ou seulement quand un fichier contient un motif (configuration refusée).
  nginx: `if [[ "$1" == -t ]]; then
  if [[ -n "\${FAKE_NGINX_REJECT:-}" ]] && grep -qsF -- "$FAKE_NGINX_REJECT_PATTERN" "$FAKE_NGINX_REJECT"; then exit 1; fi
  exit "\${FAKE_NGINX_T:-0}"
fi; echo "nginx-write $*" >> "$TRACE"`,
  systemctl: `case "$1" in is-enabled) [[ "\${FAKE_PM2_ENABLED:-0}" == 1 ]];; *) echo "systemctl-write $*" >> "$TRACE";; esac`,
  crontab: `[[ "$1" == -l ]] && { printf '%s\\n' "\${FAKE_ROOT_CRONTAB:-}"; exit 0; }; echo "crontab-write $*" >> "$TRACE"`,
  corepack: `if [[ "$1 $2" == "pnpm --version" ]]; then echo "\${FAKE_PNPM_VERSION:-9.12.0}"; exit 0; fi; echo "corepack-write $*" >> "$TRACE"`,
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
  // Vhost d'une autre application de l'hôte partagé : jamais modifié ni désactivé. Disposition
  // Ubuntu : sites-enabled = LIENS vers sites-available ; site `default` = serveur de repli :80.
  writeFileSync(t('etc/nginx/sites-available/immipro'), 'server {\n    listen 80;\n    server_name immipro.app;\n    location / { proxy_pass http://127.0.0.1:3000; }\n}\n');
  symlinkSync(t('etc/nginx/sites-available/immipro'), t('etc/nginx/sites-enabled/immipro'));
  writeFileSync(t('etc/nginx/sites-available/default'), 'server {\n    listen 80 default_server;\n    listen [::]:80 default_server;\n    server_name _;\n    root /var/www/html;\n}\n');
  symlinkSync(t('etc/nginx/sites-available/default'), t('etc/nginx/sites-enabled/default'));
  // Fichiers temporaires du script DANS l'arborescence observée (aucun reste toléré).
  mkdirSync(t('tmp'), { mode: 0o700 });
  const bin = t('bin'); mkdirSync(bin);
  const fakes = { ...FAKES, ...(fakeInstall ? { install: FAKE_INSTALL } : {}) };
  for (const [name, body] of Object.entries(fakes)) { writeFileSync(join(bin, name), `#!/bin/bash\nset -uo pipefail\n${body}\n`); chmodSync(join(bin, name), 0o755); }
  const trace = t('trace.log'); writeFileSync(trace, '');
  const baseEnv = {
    PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME ?? '/root', TRACE: trace, REAL_NODE: process.execPath,
    REAL_STAT, FAKE_ROOT_PARENT: dirname(dir),
    PROVISION_TEST_ROOT: dir, DIGISANTE_ENV: env, VALKEY_PASSWORD: VALKEY_SECRET, FAKE_VALKEY_PASS: VALKEY_SECRET,
    PG_APP_PASSWORD: PG_SECRET, LETSENCRYPT_EMAIL: 'ops@example.invalid', FAKE_APP_DB: e.db, TMPDIR: t('tmp'),
  };
  const run = (args = [], extra = {}) => spawnSync('bash', [t(join(e.lib, SCRIPT_REL)), ...args], { env: { ...baseEnv, ...extra }, encoding: 'utf8', timeout: 30_000 });
  // Instantané complet : répertoires, liens et fichiers, avec mode et propriétaire (écriture,
  // chmod ou chown d'un dry-run détectés), hors journal des commandes simulées.
  const tree = () => {
    const out = {};
    const walk = (p) => {
      for (const n of readdirSync(p)) {
        const f = join(p, n); if (f === trace || f.startsWith(`${trace}.`)) continue;
        const st = lstatSync(f); const meta = `${(st.mode & 0o7777).toString(8)} ${st.uid}:${st.gid}`;
        if (st.isSymbolicLink()) out[f.slice(dir.length)] = `l ${meta} -> ${readlinkSync(f)}`;
        else if (st.isDirectory()) { out[f.slice(dir.length)] = `d ${meta}`; walk(f); }
        else out[f.slice(dir.length)] = `f ${meta} ${createHash('sha256').update(readFileSync(f)).digest('hex')}`;
      }
    };
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
      'répertoire /etc/digisante-preprod (root:root 0700)', 'CREATE ROLE … LOGIN NOSUPERUSER', 'PASSWORD (vérificateur SCRAM-SHA-256 calculé localement depuis PG_APP_PASSWORD, fourni)',
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
    writeEnv(join(api, '.env'), `KYC_STORAGE_DIR="${store}"\n`);
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
    writeEnv(join(api, '.env'), `KYC_STORAGE_DIR="${store}"\n`);
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
    const r = f.run([], { FAKE_PG_HBA: 'none', FAKE_DNS_BAD: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL  pg_hba : aucune règle host 127\.0\.0\.1\/32 scram-sha-256 applicable à digisante_preprod@digisante_preprod .*À LA MAIN/);
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
    assert.equal(r.status, 1); assert.match(r.stderr, /B3 : une planification root \(crontab root, .*\) lance un chemin sous \/var\/www\/digisante-preprod/);
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
    writeEnv(envFile, 'KYC_STORAGE_DIR="storage/kyc"\nRECONCILE_TOKEN="x"\n');
    let r = f.run(['--verify'], users);
    assert.match(r.stdout, /FAIL  B4 : KYC_STORAGE_DIR doit être un chemin ABSOLU/);
    writeEnv(envFile, `KYC_STORAGE_DIR="${store}"\n`);
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
      writeEnv(join(api, '.env'), `KYC_STORAGE_DIR="${store}"\n`);
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
    assert.equal(r.status, 1); assert.match(r.stderr, /PG_APP_PASSWORD \(coffre, ≥ 24 caractères ASCII imprimables, sans espace\) requis pour créer digisante_preprod — rien n'a été écrit/);
    assert.doesNotMatch(f.trace(), MUTATING);
    // Espace ou caractère non ASCII : refusé avant toute écriture (vérificateur SCRAM sans normalisation).
    for (const pw of ['SYNTHETIC PG SECRET 0123456789abcdef', 'SYNTHETIC_PG_SECRET_0123456789_é']) {
      const bad = f.run(['--apply'], { PG_APP_PASSWORD: pw });
      assert.equal(bad.status, 1, pw); assert.doesNotMatch(f.trace(), MUTATING);
    }
    const r2 = f.run(['--apply'], { LETSENCRYPT_EMAIL: '' });
    assert.equal(r2.status, 1); assert.match(r2.stderr, /LETSENCRYPT_EMAIL requis/); assert.doesNotMatch(f.trace(), MUTATING);
  } finally { f.clean(); }
  f = fixture('preproduction', { fakeInstall: true });
  try {
    const r = f.run(['--apply', '--only', 'users,dirs,pg,valkey']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const trace = f.trace();
    assert.match(trace, /^useradd-write --create-home --shell \/bin\/bash --user-group --groups sshusers digisante-preprod$/m);
    // Seul le vérificateur SCRAM part au serveur ; jamais le mot de passe (SQL, argument ou environnement de psql).
    assert.match(trace, /^psql-stdin \\getenv db_role DB_ROLE \\getenv db_pw PG_APP_VERIFIER SELECT format\('CREATE ROLE %I LOGIN NOSUPERUSER/m);
    assert.match(trace, /^psql-env pw= verifier=SCRAM-SHA-256\$4096$/m);
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
    // nginx -t accepte l'amorçage ACME mais refuse le vhost TLS complet (listen 443).
    const r = f.run(['--apply', '--only', 'nginx'], { FAKE_NGINX_REJECT: f.t('etc/nginx/sites-available/digisante-preprod'), FAKE_NGINX_REJECT_PATTERN: 'listen 443' });
    assert.equal(r.status, 1); assert.match(r.stderr, /nginx -t refuse le vhost TLS digisante-preprod : fichiers Nginx DigiSanté restaurés à l'état d'avant \(nginx -t vert\)/);
    assert.equal(readFileSync(f.t('etc/nginx/sites-available/digisante-preprod'), 'utf8'), '# version précédente\n');
    // Tout ce que ce passage avait ajouté est retiré : lien, fichiers communs, HSTS.
    for (const p of ['etc/nginx/sites-enabled/digisante-preprod', 'etc/nginx/conf.d/digisante-rate-limit.conf', 'etc/nginx/snippets/digisante-headers.conf', 'etc/nginx/snippets/digisante-hsts.conf']) assert.ok(!existsSync(f.t(p)), p);
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

test('garde Nginx : vhost LIÉ (disposition Ubuntu sites-enabled → sites-available) déclarant le domaine ⇒ refus', () => {
  const f = fixture();
  try {
    writeFileSync(f.t('etc/nginx/sites-available/ancien'), 'server {\n    listen 80;\n    server_name preprod.digisantemobile.app;\n}\n');
    symlinkSync(f.t('etc/nginx/sites-available/ancien'), f.t('etc/nginx/sites-enabled/ancien'));
    const r = f.run();
    assert.equal(r.status, 1); assert.match(r.stderr, /domaine preprod\.digisantemobile\.app déjà déclaré par \/etc\/nginx\/sites-enabled\/ancien/);
    assert.doesNotMatch(f.trace(), MUTATING);
  } finally { f.clean(); }
});

test('Nginx : fichiers communs différents alors que l’autre environnement est actif ⇒ FAIL, jamais écrasés', () => {
  const f = fixture();
  try {
    writeFileSync(f.t('etc/nginx/sites-enabled/digisante'), readFileSync(resolve(ROOT, 'infra/deploy/nginx/digisante.conf')));
    writeFileSync(f.t('etc/nginx/conf.d/digisante-rate-limit.conf'), '# version de la copie root production (autre SHA)\n');
    const before = f.tree();
    const r = f.run();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL  \/etc\/nginx\/conf\.d\/digisante-rate-limit\.conf diffère de la copie root preproduction alors que digisante est actif/);
    assert.deepEqual(f.tree(), before); assert.doesNotMatch(f.trace(), MUTATING);
  } finally { f.clean(); }
});

test('--apply Nginx : amorçage ACME ou fichiers communs refusés par nginx -t ⇒ tout retiré, aucun certificat demandé', () => {
  const f = fixture('preproduction', { fakeInstall: true });
  try {
    const immipro = readFileSync(f.t('etc/nginx/sites-available/immipro'));
    const r = f.run(['--apply', '--only', 'nginx'], { FAKE_NGINX_REJECT: f.t('etc/nginx/conf.d/digisante-rate-limit.conf'), FAKE_NGINX_REJECT_PATTERN: 'limit_req_zone' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /nginx -t refuse les fichiers communs ou l'amorçage ACME de digisante-preprod : fichiers Nginx DigiSanté restaurés à l'état d'avant/);
    for (const p of ['etc/nginx/sites-available/digisante-preprod', 'etc/nginx/sites-enabled/digisante-preprod', 'etc/nginx/conf.d/digisante-rate-limit.conf', 'etc/nginx/snippets/digisante-headers.conf', 'etc/nginx/snippets/digisante-hsts.conf']) assert.ok(!existsSync(f.t(p)), p);
    assert.deepEqual(readFileSync(f.t('etc/nginx/sites-available/immipro')), immipro);
    assert.doesNotMatch(f.trace(), /certbot-write/);
  } finally { f.clean(); }
  // Configuration de l'hôte déjà invalide : refus AVANT toute écriture.
  const g = fixture('preproduction', { fakeInstall: true });
  try {
    const r = g.run(['--apply', '--only', 'nginx'], { FAKE_NGINX_T: '1' });
    assert.equal(r.status, 1); assert.match(r.stderr, /nginx -t échoue AVANT toute modification/);
    assert.doesNotMatch(g.trace(), MUTATING);
  } finally { g.clean(); }
});

test('--apply Nginx après --rollback (certificat conservé) : amorçage ACME AVANT le renouvellement à blanc, puis HSTS et vhost TLS', () => {
  const f = fixture('preproduction', { fakeInstall: true });
  try {
    mkdirSync(f.t('etc/letsencrypt/live/preprod.digisantemobile.app'), { recursive: true });
    writeFileSync(f.t('etc/letsencrypt/live/preprod.digisantemobile.app/fullchain.pem'), 'CERT');
    const r = f.run(['--apply', '--only', 'nginx']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const lines = f.trace().split('\n');
    const at = (re) => lines.findIndex((l) => re.test(l));
    const boot = at(/^install-write .*sites-available\/digisante-preprod$/);
    const renew = at(/^certbot-write renew --cert-name preprod\.digisantemobile\.app --dry-run$/);
    const hsts = at(/^install-write .*snippets\/digisante-hsts\.conf$/);
    assert.ok(boot >= 0 && renew > boot, 'amorçage ACME avant le renouvellement');
    assert.ok(hsts > renew, 'HSTS seulement après le renouvellement validé');
    assert.doesNotMatch(f.trace(), /certbot-write certonly/, 'certificat présent : aucune émission');
    assert.equal(readFileSync(f.t('etc/nginx/sites-available/digisante-preprod'), 'utf8'), readFileSync(resolve(ROOT, 'infra/deploy/nginx/digisante-preprod.conf'), 'utf8'));
  } finally { f.clean(); }
});

test('chemins hérités (DB_NAME, APP_DIR, APP_USER…) ignorés : seuls les chemins canoniques du profil sont visés', () => {
  const f = fixture();
  try {
    const r = f.run([], { DB_NAME: 'immipro', APP_DIR: '/var/www/immipro', APP_USER: 'immipro', ETC_DIR: '/etc/immipro', CRON_FILE: '/etc/cron.d/immipro', BACKUP_DIR: '/var/backups/immipro' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /immipro/);
    assert.match(r.stdout, /createdb --owner=digisante_preprod/); assert.match(r.stdout, /répertoire \/var\/www\/digisante-preprod /);
  } finally { f.clean(); }
});

test('bash -x refusé : xtrace afficherait les secrets', () => {
  const f = fixture();
  try {
    const r = spawnSync('bash', ['-x', f.t(join(f.e.lib, SCRIPT_REL))], { env: { ...process.env, PATH: `${f.t('bin')}:${process.env.PATH}`, PROVISION_TEST_ROOT: f.dir, DIGISANTE_ENV: 'preproduction', PG_APP_PASSWORD: PG_SECRET, VALKEY_PASSWORD: VALKEY_SECRET, TRACE: f.t('trace.log') }, encoding: 'utf8' });
    assert.equal(r.status, 2); assert.match(r.stderr, /REFUS : xtrace \(bash -x\) afficherait les secrets/);
    for (const secret of [PG_SECRET, VALKEY_SECRET]) assert.ok(!(r.stdout + r.stderr).includes(secret), 'secret affiché');
  } finally { f.clean(); }
});

test('--apply runtime : npm et pm2 ne reçoivent jamais les secrets de la session root', () => {
  const f = fixture('preproduction', { fakeInstall: true });
  try {
    const r = f.run(['--apply', '--only', 'runtime']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(f.trace(), /^npm-write install --global pm2@7\.0\.4$/m);
    assert.match(f.trace(), /^npm-env secrets=$/m);
  } finally { f.clean(); }
});

test('gardes : groupe adm/disk/shadow, rôle PG membre d’autres rôles, AAAA hors hôte ⇒ refus ou FAIL', () => {
  for (const [extra, expected, stream] of [
    [{ FAKE_USERS: 'digisante-preprod:1001:1001:digisante-preprod sshusers adm' }, /membre d'un groupe privilégié/, 'stderr'],
    [{ FAKE_USERS: 'digisante-preprod-jobs:1002:1002:digisante-preprod-jobs shadow' }, /membre d'un groupe privilégié/, 'stderr'],
    [{ FAKE_PG_ROLE_ATTR: 'f', FAKE_PG_MEMBERS: '1' }, /rôle digisante_preprod membre d'autres rôles/, 'stderr'],
    [{ FAKE_DNS_AAAA: '2001:db8::1' }, /FAIL  DNS preprod\.digisantemobile\.app : AAAA 2001:db8::1/, 'stdout'],
  ]) {
    const f = fixture();
    try {
      const r = f.run([], extra);
      assert.equal(r.status, 1, JSON.stringify(extra)); assert.match(r[stream], expected, JSON.stringify(extra));
      assert.doesNotMatch(f.trace(), MUTATING);
    } finally { f.clean(); }
  }
  // AAAA visant cet hôte (HOST_PUBLIC_IP6 déclaré) : accepté.
  const f = fixture();
  try { assert.equal(f.run([], { FAKE_DNS_AAAA: '2001:db8::1', HOST_PUBLIC_IP6: '2001:db8::1' }).status, 0); } finally { f.clean(); }
});

test('B3 : variantes de chemin vers APP_DIR (//, /./, ..) dans le modèle ou la crontab root ⇒ refus', () => {
  for (const line of ['*/5 * * * * root /var/www//digisante-preprod/x.sh', '*/5 * * * * root /var/www/./digisante-preprod/x.sh', '*/5 * * * * root /usr/local/lib/digisante-preprod/../../../../var/www/digisante-preprod/x.sh', '*/5 * * * * root cd /var/www/digisante-preprod && ./x.sh', '*/5 * * * * root "/var/www/digisante-preprod/x.sh"']) {
    const f = fixture();
    try {
      const cron = f.t(join(f.e.lib, 'infra/deploy/crontab.preproduction.example'));
      chmodSync(cron, 0o644); writeFileSync(cron, `${readFileSync(cron, 'utf8')}${line}\n`);
      const r = f.run();
      assert.equal(r.status, 1, line); assert.match(r.stderr, /B3 : le modèle de crontab exécute un chemin sous \/var\/www\/digisante-preprod/, line);
      const r2 = f.run(['--only', 'users'], { FAKE_ROOT_CRONTAB: line });
      assert.equal(r2.status, 1, line);
    } finally { f.clean(); }
  }
  // Chemin voisin (autre application) ou « .. » qui n'y mène pas : jamais confondu avec APP_DIR.
  const f = fixture();
  try {
    for (const line of ['0 1 * * * root /var/www/digisante-preprod-archive/x.sh', '0 1 * * * root /usr/local/lib/digisante-preprod/../../../var/www/digisante-preprod/x.sh']) assert.equal(f.run([], { FAKE_ROOT_CRONTAB: line }).status, 0, line);
  } finally { f.clean(); }
});

test('secrets : .env lu à travers un lien (apps/api → autre checkout) ou modifiable par d’autres ⇒ jeton jamais recopié', () => {
  const f = fixture();
  try {
    const users = { FAKE_USERS: `digisante-preprod:${APP_UID}:${APP_UID}:digisante-preprod sshusers;digisante-preprod-jobs:${APP_UID - 1}:${APP_UID - 1}:digisante-preprod-jobs` };
    const prod = f.t('var/www/digisante/apps/api'); mkdirSync(prod, { recursive: true });
    writeEnv(join(prod, '.env'), `RECONCILE_TOKEN="${'p'.repeat(40)}"\n`);
    mkdirSync(f.t('var/www/digisante-preprod/apps'), { recursive: true });
    symlinkSync(prod, f.t('var/www/digisante-preprod/apps/api'));
    let r = f.run(['--only', 'secrets'], users);
    assert.match(r.stdout, /FAIL  \/var\/www\/digisante-preprod\/apps\/api\/\.env refusé : lien symbolique dans le chemin/);
    assert.doesNotMatch(r.stdout, /reconcile\.token ←/);
    rmSync(f.t('var/www/digisante-preprod/apps/api'));
    const api = f.t('var/www/digisante-preprod/apps/api'); mkdirSync(api, { recursive: true });
    writeEnv(join(api, '.env'), `RECONCILE_TOKEN="${'q'.repeat(40)}"\n`);
    chmodSync(join(api, '.env'), 0o666);
    r = f.run(['--only', 'secrets'], users);
    assert.match(r.stdout, /FAIL  \/var\/www\/digisante-preprod\/apps\/api\/\.env refusé/);
    chmodSync(join(api, '.env'), 0o600);
    r = f.run(['--only', 'secrets'], users);
    assert.match(r.stdout, /\[plan\] reconcile\.token ← RECONCILE_TOKEN du \.env/);
    assert.doesNotMatch(r.stdout + r.stderr, /qqqq|pppp/, 'jeton affiché');
  } finally { f.clean(); }
});

test('B3 : planifications root hors crontab root (/etc/crontab, /etc/cron.d, cron.daily) visant APP_DIR ⇒ refus ; ligne d’un autre compte ignorée', () => {
  const legacy = '0 2 * * * root /var/www/digisante-preprod/infra/deploy/scripts/pg_dump_encrypted.sh\n';
  for (const [path, body] of [['etc/cron.d/digisante-legacy', legacy], ['etc/crontab', `SHELL=/bin/sh\n${legacy}`], ['etc/cron.daily/old-backup', '#!/bin/sh\n/var/www/digisante-preprod/infra/deploy/scripts/healthwatch.sh\n']]) {
    const f = fixture();
    try {
      mkdirSync(dirname(f.t(path)), { recursive: true }); writeFileSync(f.t(path), body);
      const r = f.run(['--only', 'cron']);
      assert.equal(r.status, 1, path); assert.match(r.stderr, /B3 : une planification root .* lance un chemin sous \/var\/www\/digisante-preprod/, path);
      assert.doesNotMatch(f.trace(), MUTATING);
    } finally { f.clean(); }
  }
  const f = fixture();
  try {
    writeFileSync(f.t('etc/cron.d/user-job'), 'API_ENV_FILE=/var/www/digisante-preprod/apps/api/.env\n*/5 * * * * digisante-preprod /var/www/digisante-preprod/bin/x.sh\n');
    assert.equal(f.run(['--only', 'cron']).status, 0, 'ligne exécutée par le compte applicatif, pas par root');
  } finally { f.clean(); }
});

test('Nginx serveur de repli : sans default_server explicite, DigiSanté chargé avant un voisin ⇒ FAIL ; default_server ou voisin chargé avant ⇒ PASS', () => {
  const tls = (name) => `server {\n    listen 443 ssl;\n    server_name ${name};\n}\n`;
  for (const env of ['preproduction', 'production']) {
    let f = fixture(env);
    try {
      writeFileSync(f.t('etc/nginx/sites-available/immipro'), tls('immipro.app'));
      const r = f.run(['--only', 'nginx']);
      assert.equal(r.status, 1, env);
      assert.match(r.stdout, new RegExp(`FAIL  Nginx :443 : aucun default_server explicite et ${f.e.site} serait chargé avant /etc/nginx/sites-enabled/immipro`), r.stdout);
      assert.doesNotMatch(f.trace(), MUTATING);
      writeFileSync(f.t('etc/nginx/sites-available/immipro'), tls('immipro.app').replace('listen 443 ssl;', 'listen 443 ssl default_server;'));
      assert.match(f.run(['--only', 'nginx']).stdout, /PASS  Nginx :443 : default_server explicite \(\/etc\/nginx\/sites-enabled\/immipro\)/);
    } finally { f.clean(); }
    f = fixture(env);
    try {
      writeFileSync(f.t('etc/nginx/sites-available/beninlink'), tls('beninlink.app'));
      symlinkSync(f.t('etc/nginx/sites-available/beninlink'), f.t('etc/nginx/sites-enabled/beninlink'));
      writeFileSync(f.t('etc/nginx/sites-available/immipro'), tls('immipro.app'));
      const r = f.run(['--only', 'nginx']);
      assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /PASS  Nginx :443 : serveur de repli inchangé \(beninlink\)/);
    } finally { f.clean(); }
  }
  // Port 80 : sans le site `default` d'Ubuntu, le voisin cesserait d'être le serveur de repli.
  const f = fixture();
  try {
    rmSync(f.t('etc/nginx/sites-enabled/default'));
    const r = f.run(['--only', 'nginx']);
    assert.equal(r.status, 1); assert.match(r.stdout, /FAIL  Nginx :80 : aucun default_server explicite et digisante-preprod serait chargé avant \/etc\/nginx\/sites-enabled\/immipro/);
  } finally { f.clean(); }
});

test('pg_hba : première règle trust (accès sans mot de passe) ⇒ FAIL ; sonde sans secret ni .pgpass', () => {
  const f = fixture();
  try {
    const r = f.run(['--only', 'pg'], { FAKE_PG_HBA: 'trust' });
    assert.equal(r.status, 1); assert.match(r.stdout, /FAIL  pg_hba : 127\.0\.0\.1 → digisante_preprod@digisante_preprod ACCEPTÉ SANS mot de passe/);
    const ok = f.run(['--only', 'pg']);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.match(ok.stdout, /PASS  pg_hba : 127\.0\.0\.1 → digisante_preprod@digisante_preprod exige un mot de passe/);
    assert.match(f.trace(), /^psql-probe .*host=127\.0\.0\.1 port=5432 dbname=digisante_preprod user=digisante_preprod.* pw= passfile=\/dev\/null$/m);
  } finally { f.clean(); }
});

test('Valkey partagé : éviction possible (maxmemory + politique ≠ noeviction) ⇒ FAIL ; CONFIG refusé ou sans persistance ⇒ NOTE', () => {
  const f = fixture();
  try {
    let r = f.run(['--only', 'valkey'], { FAKE_VALKEY_MAXMEM: '1073741824', FAKE_VALKEY_POLICY: 'allkeys-lru' });
    assert.equal(r.status, 1); assert.match(r.stdout, /FAIL  Valkey : maxmemory=1073741824 avec allkeys-lru/);
    r = f.run(['--only', 'valkey'], { FAKE_VALKEY_MAXMEM: '1073741824', FAKE_VALKEY_POLICY: 'noeviction' });
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /PASS  Valkey : aucune éviction/);
    r = f.run(['--only', 'valkey'], { FAKE_VALKEY_CONFIG_DENIED: '1' });
    assert.equal(r.status, 0); assert.match(r.stdout, /NOTE  Valkey : CONFIG GET refusé \(ACL\)/);
    r = f.run(['--only', 'valkey'], { FAKE_VALKEY_SAVE: '', FAKE_VALKEY_AOF: 'no' });
    assert.equal(r.status, 0); assert.match(r.stdout, /NOTE  Valkey sans persistance/);
    assert.doesNotMatch(f.trace(), MUTATING); assert.doesNotMatch(r.stdout + r.stderr, new RegExp(VALKEY_SECRET));
  } finally { f.clean(); }
});

test('sudoers : compte existant autorisé ou règle %sshusers ⇒ refus avant toute écriture', () => {
  let f = fixture();
  try {
    const r = f.run([], { FAKE_USERS: 'digisante-preprod:1001:1001:digisante-preprod sshusers', FAKE_SUDO_ALLOWED: 'digisante-preprod' });
    assert.equal(r.status, 1); assert.match(r.stderr, /compte digisante-preprod autorisé par sudoers/); assert.doesNotMatch(f.trace(), MUTATING);
  } finally { f.clean(); }
  f = fixture();
  try {
    mkdirSync(f.t('etc/sudoers.d'), { recursive: true }); writeFileSync(f.t('etc/sudoers.d/ops'), '%sshusers ALL=(ALL) NOPASSWD: /usr/bin/docker\n');
    const r = f.run();
    assert.equal(r.status, 1); assert.match(r.stderr, /règle sudoers pour %sshusers : digisante-preprod en hériterait/); assert.doesNotMatch(f.trace(), MUTATING);
  } finally { f.clean(); }
});

test('clé de déploiement : ajoutée avec restrict ; déjà présente sans restrict ⇒ FAIL ; --verify refuse une clé non restreinte', () => {
  const key = `ssh-ed25519 ${'A'.repeat(68)} deploy@ci`;
  const f = fixture();
  try {
    let r = f.run(['--only', 'users'], { DEPLOY_SSH_PUBKEY: key });
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /\[plan\] clé publique de déploiement \(restrict\) ajoutée/); assert.ok(r.stdout.includes(`restrict\\ ssh-ed25519\\ ${'A'.repeat(68)}`), r.stdout);
    const keys = f.t('home/digisante-preprod/.ssh/authorized_keys'); mkdirSync(dirname(keys), { recursive: true }); writeFileSync(keys, `${key.replace(' deploy@ci', ' old')}\n`);
    r = f.run(['--only', 'users'], { DEPLOY_SSH_PUBKEY: key });
    assert.equal(r.status, 1); assert.match(r.stdout, /FAIL  clé de déploiement déjà présente SANS restrict/);
    r = f.run(['--verify'], { FAKE_USERS: 'digisante-preprod:1001:1001:digisante-preprod sshusers' });
    assert.match(r.stdout, /FAIL  \/home\/digisante-preprod\/\.ssh\/authorized_keys : clé sans restrict/);
    writeFileSync(keys, `# CI\nrestrict ${key}\n`);
    r = f.run(['--verify'], { FAKE_USERS: 'digisante-preprod:1001:1001:digisante-preprod sshusers' });
    assert.match(r.stdout, /PASS  clés SSH de digisante-preprod toutes restreintes/);
  } finally { f.clean(); }
});

test('--verify : module filestore modifiable par autrui jamais exécuté par root ; pnpm (corepack) vérifié ; maintenance signalée', () => {
  const f = fixture();
  try {
    const users = { FAKE_USERS: `digisante-preprod:${APP_UID}:${APP_UID}:digisante-preprod sshusers` };
    const api = f.t('var/www/digisante-preprod/apps/api'); mkdirSync(api, { recursive: true });
    const store = f.t('var/lib/digisante-preprod-files'); mkdirSync(store, { recursive: true }); chmodSync(store, 0o700);
    if (UID === 0) chownSync(store, APP_UID, APP_UID);
    writeEnv(join(api, '.env'), `KYC_STORAGE_DIR="${store}"\n`);
    const mod = f.t(join(f.e.lib, 'scripts/preproduction/filestore-dir.mjs'));
    const marker = f.t('payload-ran');
    writeFileSync(mod, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.getuid()));\n`); chmodSync(mod, 0o666);
    let r = f.run(['--verify'], users);
    assert.match(r.stdout, /FAIL  B4 : .*filestore-dir\.mjs absent ou modifiable par un autre compte : jamais exécuté par root/);
    assert.ok(!existsSync(marker), 'module non fiable exécuté');
    writeFileSync(f.t('var/www/digisante-preprod/package.json'), '{"packageManager":"pnpm@9.12.0"}\n');
    r = f.run(['--verify'], users);
    assert.match(r.stdout, /PASS  pnpm 9\.12\.0 \(corepack, cache de digisante-preprod\)/); assert.match(r.stdout, /NOTE  maintenance inactive/);
    writeFileSync(f.t('etc/nginx/snippets/digisante-preprod-maintenance.conf'), 'return 503;\n');
    r = f.run(['--verify'], { ...users, FAKE_PNPM_VERSION: '10.0.0' });
    assert.match(r.stdout, /FAIL  corepack pnpm → 10\.0\.0 \(≠ 9\.12\.0\)/); assert.match(r.stdout, /NOTE  maintenance ACTIVE/);
    r = f.run(['--rollback']);
    assert.match(r.stdout, /\[plan\] retrait de \/etc\/nginx\/snippets\/digisante-preprod-maintenance\.conf/);
    assert.doesNotMatch(f.trace(), MUTATING);
  } finally { f.clean(); }
});

test('racine de test : commande modifiante réelle (hors racine) ⇒ refus avant toute garde', () => {
  const f = fixture();
  const outside = mkdtempSync(join(tmpdir(), 'real-bin.'));
  try {
    rmSync(f.t('bin/certbot'));
    writeFileSync(join(outside, 'certbot'), '#!/bin/sh\necho REAL >> "$TRACE"\n'); chmodSync(join(outside, 'certbot'), 0o755);
    const r = f.run([], { PATH: `${f.t('bin')}:${outside}:${process.env.PATH}` });
    assert.equal(r.status, 2); assert.match(r.stderr, /PROVISION_TEST_ROOT : certbot doit être simulé dans la racine de test/);
    assert.doesNotMatch(r.stdout, /PASS|\[plan\]/); assert.doesNotMatch(f.trace(), /REAL/);
  } finally { f.clean(); rmSync(outside, { recursive: true, force: true }); }
});

test('--rollback --apply : artefacts de l’environnement retirés ; fichiers communs gardés si et seulement si l’autre environnement est actif', () => {
  for (const env of ['preproduction', 'production']) {
    for (const otherActive of [true, false]) {
      const f = fixture(env, { fakeInstall: true });
      try {
        const other = env === 'production' ? 'digisante-preprod' : 'digisante';
        const own = [`etc/nginx/sites-available/${f.e.site}`, `etc/nginx/sites-enabled/${f.e.site}`, `etc/cron.d/${f.e.site}`, `etc/logrotate.d/${f.e.site}`];
        const shared = ['etc/nginx/conf.d/digisante-rate-limit.conf', 'etc/nginx/snippets/digisante-headers.conf', 'etc/nginx/snippets/digisante-hsts.conf'];
        for (const p of [...own, ...shared]) writeFileSync(f.t(p), '#\n');
        if (otherActive) { writeFileSync(f.t(`etc/nginx/sites-available/${other}`), '# autre\n'); writeFileSync(f.t(`etc/nginx/sites-enabled/${other}`), '# autre\n'); }
        mkdirSync(f.t(`etc/${f.e.site}`), { recursive: true }); writeFileSync(f.t(`etc/${f.e.site}/backup.key`), 'k');
        const immipro = readFileSync(f.t('etc/nginx/sites-available/immipro'));
        const r = f.run(['--rollback', '--apply'], { FAKE_PM2_ENABLED: '1' });
        assert.equal(r.status, 0, r.stdout + r.stderr);
        for (const p of own) assert.ok(!existsSync(f.t(p)), `${env} : ${p} conservé`);
        for (const p of shared) assert.equal(existsSync(f.t(p)), otherActive, `${env} autre=${otherActive} : ${p}`);
        if (otherActive) assert.equal(readFileSync(f.t(`etc/nginx/sites-enabled/${other}`), 'utf8'), '# autre\n');
        assert.deepEqual(readFileSync(f.t('etc/nginx/sites-available/immipro')), immipro);
        assert.ok(existsSync(f.t(`etc/${f.e.site}/backup.key`)), 'configuration root conservée');
        const t = f.trace();
        assert.match(t, /^systemctl-write reload nginx$/m); assert.match(t, new RegExp(`^pm2-write unstartup systemd -u ${f.e.app} `, 'm'));
        assert.doesNotMatch(t, /^(psql-(c|stdin)|valkey-write|useradd-write|createdb-write|certbot-write)/m);
        assert.equal(f.run(['--rollback', '--apply'], { FAKE_PM2_ENABLED: '1' }).status, 0, 'rejeu idempotent');
      } finally { f.clean(); }
    }
  }
});

test('gardes : OS voisin, chaque port de chaque environnement squatté, compte d’uid 0 ⇒ refus sans écriture', () => {
  for (const [id, version] of [['ubuntu', '26.10'], ['ubuntu', '24.04'], ['debian', '26.04']]) {
    const f = fixture();
    try {
      writeFileSync(f.t('etc/os-release'), `ID=${id}\nVERSION_ID="${version}"\n`);
      const r = f.run();
      assert.equal(r.status, 1); assert.match(r.stderr, new RegExp(`REFUS : OS ${id} ${version.replace('.', '\\.')}`)); assert.doesNotMatch(r.stdout, /\[plan\]/);
    } finally { f.clean(); }
  }
  for (const env of ['preproduction', 'production']) {
    for (const port of ENVS[env].ports) {
      const f = fixture(env);
      try {
        const r = f.run([], { FAKE_SS: `LISTEN 0 511 127.0.0.1:${port} 0.0.0.0:* users:(("node",pid=777,fd=3))`, FAKE_PS: '777:beninlink' });
        assert.equal(r.status, 1); assert.match(r.stderr, new RegExp(`port ${port} déjà écouté par « beninlink »`)); assert.doesNotMatch(f.trace(), MUTATING);
      } finally { f.clean(); }
    }
  }
  for (const users of ['digisante-preprod:0:1001:digisante-preprod sshusers', 'digisante-preprod-jobs:0:0:digisante-preprod-jobs']) {
    const f = fixture();
    try { const r = f.run([], { FAKE_USERS: users }); assert.equal(r.status, 1); assert.match(r.stderr, /d'uid 0/); } finally { f.clean(); }
  }
});

test('secrets : reconcile.token planifié en dry-run (aucune écriture), posé 0400 en --apply, jamais affiché ; rejeu PASS', () => {
  const f = fixture('preproduction', { fakeInstall: true });
  try {
    const token = 'T'.repeat(48);
    const users = { FAKE_USERS: `digisante-preprod:${APP_UID}:${APP_UID}:digisante-preprod sshusers` };
    const api = f.t('var/www/digisante-preprod/apps/api'); mkdirSync(api, { recursive: true });
    writeEnv(join(api, '.env'), `RECONCILE_TOKEN="${token}"\n`);
    mkdirSync(f.t('etc/digisante-preprod'), { mode: 0o700 });
    const before = f.tree();
    let r = f.run(['--only', 'secrets'], users);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /\[plan\] reconcile\.token ← RECONCILE_TOKEN du \.env/);
    assert.deepEqual(f.tree(), before, 'dry-run : écriture');
    r = f.run(['--apply', '--only', 'secrets'], users);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const file = f.t('etc/digisante-preprod/reconcile.token');
    assert.equal(readFileSync(file, 'utf8'), token); assert.equal(statSync(file).mode & 0o777, 0o400);
    assert.match(f.run(['--only', 'secrets'], users).stdout, /PASS  reconcile\.token = RECONCILE_TOKEN du \.env/);
    for (const out of [r.stdout + r.stderr, f.trace()]) assert.ok(!out.includes(token), 'jeton affiché');
    assert.deepEqual(readdirSync(f.t('tmp')), [], 'fichier temporaire laissé');
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
