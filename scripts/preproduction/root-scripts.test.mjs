// B3 — root n'exécute jamais un fichier modifiable par l'utilisateur applicatif.
// Tests statiques (partout) + installateur réel (en root uniquement : chown root:root).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Hôte IONOS partagé : une copie root, un fichier /etc/cron.d et un répertoire de journaux
// root PAR ENVIRONNEMENT (profil `digisante_profile`, DIGISANTE_ENV).
const CRONTABS = {
  'crontab.example': { env: 'production', lib: '/usr/local/lib/digisante', logs: '/var/log/digisante-cron' },
  'crontab.preproduction.example': { env: 'preproduction', lib: '/usr/local/lib/digisante-preprod', logs: '/var/log/digisante-preprod-cron' },
};
/** Texte d'un script sans son bloc de profil (valeurs PAR DÉFAUT, testées à part). */
export const withoutProfile = (text) => text.replace(/# >>> digisante_profile[\s\S]*?# <<< digisante_profile\n/, '');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const isRoot = process.getuid?.() === 0;

export function parseRootList(text) {
  const list = new Map();
  for (const line of text.split('\n')) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const match = /^(0755|0644) ((?:infra\/deploy|scripts)\/[A-Za-z0-9._/-]+)$/.exec(line);
    assert.ok(match, `ligne de liste invalide : ${line}`);
    assert.ok(!list.has(match[2]), `doublon : ${match[2]}`);
    list.set(match[2], match[1]);
  }
  return list;
}
const LIST = parseRootList(read('infra/deploy/root-scripts.list'));
const rootScripts = [...LIST].filter(([path, mode]) => mode === '0755' && path.endsWith('.sh')).map(([path]) => path);

/** Lignes de commande d'un fichier /etc/cron.d (6ᵉ champ = utilisateur, toujours root), variables développées. */
export function cronJobs(text) {
  const vars = {}; const jobs = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const assign = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (assign && !/^[*@0-9]/.test(line)) { vars[assign[1]] = assign[2]; continue; }
    const job = /^(@\w+|(?:\S+\s+){4}\S+)\s+(\S+)\s+(.+)$/.exec(line);
    assert.ok(job, `ligne cron illisible : ${line}`);
    assert.equal(job[2], 'root', `utilisateur cron.d inattendu : ${line}`);
    jobs.push(job[3].replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, v) => vars[v] ?? m));
  }
  return { vars, jobs };
}

test('B3 : crontabs root — aucun chemin sous /var/www, scripts = copies root installées et listées, journaux root', () => {
  const crontabs = readdirSync(resolve(root, 'infra/deploy')).filter((n) => /^crontab.*\.example$/.test(n));
  assert.deepEqual(crontabs.sort(), Object.keys(CRONTABS).sort());
  for (const name of crontabs) {
    const { env, lib: ROOT_LIB, logs } = CRONTABS[name];
    const { vars, jobs } = cronJobs(read(`infra/deploy/${name}`));
    assert.equal(vars.DIGISANTE_ENV, env, `${name} : DIGISANTE_ENV`);
    for (const value of Object.values(vars)) assert.doesNotMatch(value, /\/var\/www|digisante-mobile/, `${name} : variable sous APP_DIR`);
    const executed = new Set();
    for (const cmd of jobs) {
      assert.doesNotMatch(cmd, /\/var\/www|digisante-mobile|\/home\//, `${name} : ${cmd}`);
      const exe = cmd.split(/\s+/)[0];
      if (exe.startsWith('/')) {
        assert.ok(exe.startsWith(`${ROOT_LIB}/`), `${name} : exécutable hors copie root : ${exe}`);
        const rel = exe.slice(ROOT_LIB.length + 1);
        assert.equal(LIST.get(rel), '0755', `${name} : ${rel} absent de root-scripts.list`);
        executed.add(rel);
      } else assert.equal(exe, 'certbot', `${name} : commande inattendue ${exe}`);
      for (const token of cmd.split(/\s+/)) {
        if (/\.(sh|mjs|js)$/.test(token)) assert.ok(token.startsWith(`${ROOT_LIB}/`) && LIST.has(token.slice(ROOT_LIB.length + 1)), `${name} : script non listé ${token}`);
      }
      // Journaux root : répertoire root:root, jamais celui de l'utilisateur applicatif.
      for (const [, target] of cmd.matchAll(/>>?\s*(\S+)/g)) {
        if (target.startsWith('&')) continue;
        assert.ok(target.startsWith(`${logs}/`) && /^[a-z_]+\.log$/.test(target.slice(logs.length + 1)), `${name} : journal root ${target}`);
      }
    }
    for (const script of ['internal_job.sh', 'pg_dump_encrypted.sh', 'fedapay_reconcile.sh', 'healthwatch.sh']) assert.ok(executed.has(`infra/deploy/scripts/${script}`), `${name} : ${script} non planifié`);
  }
});

test('B3 : root-scripts.list couvre scripts root, configurations copiées par root et modules importés', () => {
  for (const [path, mode] of LIST) {
    assert.ok(existsSync(resolve(root, path)), `${path} absent du dépôt`);
    assert.equal(mode, path.endsWith('.sh') ? '0755' : '0644', path);
  }
  // Tout script d'exploitation est exécuté par root, sauf deploy.sh (utilisateur applicatif)
  // et verify_restore.sh (machine tierce isolée) : un nouveau script doit être classé.
  for (const name of readdirSync(resolve(root, 'infra/deploy/scripts'))) {
    if (['deploy.sh', 'verify_restore.sh'].includes(name)) assert.ok(!LIST.has(`infra/deploy/scripts/${name}`), name);
    else assert.equal(LIST.get(`infra/deploy/scripts/${name}`), '0755', `${name} : script root non listé`);
  }
  for (const dir of ['infra/deploy/nginx', 'infra/deploy/logrotate']) {
    for (const name of readdirSync(resolve(root, dir))) assert.equal(LIST.get(`${dir}/${name}`), '0644', `${dir}/${name} copié par root mais non listé`);
  }
  // Fermeture des imports : uniquement modules Node intégrés ou modules relatifs listés.
  for (const path of [...LIST.keys()].filter((p) => /\.(mjs|js)$/.test(p))) {
    for (const [, spec] of read(path).matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)) {
      if (spec.startsWith('node:') || builtinModules.includes(spec)) continue;
      assert.ok(spec.startsWith('.'), `${path} : import non relatif ${spec}`);
      const target = resolve(dirname(resolve(root, path)), spec).slice(root.length);
      assert.ok(LIST.has(target), `${path} importe ${target}, absent de la liste`);
    }
  }
  // Chemins du dépôt cités par les scripts root (hors commentaires et textes heredoc).
  for (const path of rootScripts) {
    let heredoc = null; const code = [];
    for (const line of read(path).split('\n')) {
      if (heredoc) { if (line.trim() === heredoc) heredoc = null; continue; }
      if (/^\s*#/.test(line)) continue;
      const open = /<<-?\s*['"]?([A-Za-z_]+)['"]?/.exec(line);
      if (open) heredoc = open[1];
      code.push(line);
    }
    for (const [ref] of code.join('\n').matchAll(/(?:infra\/deploy|scripts)\/[A-Za-z0-9._/-]+\.(?:sh|mjs|js|list)|infra\/deploy\/logrotate\/[A-Za-z0-9._-]+/g)) {
      assert.ok(LIST.has(ref), `${path} référence ${ref}, absent de root-scripts.list`);
    }
  }
});

test('B3 : requêtes des tâches sous le compte sans droits — bloc jobs_user identique, aucun curl direct', () => {
  const block = (text) => text.slice(text.indexOf('# >>> jobs_user'), text.indexOf('# <<< jobs_user'));
  const reference = block(read('infra/deploy/scripts/internal_job.sh'));
  assert.ok(reference.includes('as_jobs_user() {') && reference.includes('--no-new-privs'));
  for (const path of ['infra/deploy/scripts/internal_job.sh', 'infra/deploy/scripts/fedapay_reconcile.sh']) {
    const text = read(path);
    assert.equal(block(text), reference, `${path} : bloc jobs_user absent ou divergent`);
    assert.match(text, /^jobs_identity \|\| exit 1$/m, `${path} : compte des tâches non contrôlé`);
    const code = text.replace(/^\s*#.*$/gm, '');
    assert.match(code, /\| as_jobs_user curl -q /, `${path} : requête hors du compte sans droits`);
    assert.doesNotMatch(code.replace(/as_jobs_user curl/g, ''), /(^|[|;&]\s*)curl\b/m, `${path} : curl lancé en root`);
  }
});

test('résiduel 1 : bloc port_owner identique ; jeton et readiness seulement derrière le contrôle du propriétaire du port', () => {
  const block = (text) => text.slice(text.indexOf('# >>> port_owner'), text.indexOf('# <<< port_owner'));
  const reference = block(read('infra/deploy/scripts/deploy.sh'));
  assert.ok(reference.includes('port_owned_by() {') && reference.includes('ss -Htlne'));
  for (const name of ['deploy.sh', 'healthwatch.sh', 'verify_deploy.sh', 'internal_job.sh', 'fedapay_reconcile.sh']) {
    assert.equal(block(read(`infra/deploy/scripts/${name}`)), reference, `${name} : bloc port_owner absent ou divergent`);
  }
  for (const name of ['internal_job.sh', 'fedapay_reconcile.sh']) {
    const code = read(`infra/deploy/scripts/${name}`).replace(/^\s*#.*$/gm, '');
    const guard = code.indexOf('if ! port_owned_by "$API_PORT" "$APP_USER"; then');
    assert.ok(guard > 0 && guard < code.indexOf('| as_jobs_user curl -q '), `${name} : jeton envoyé sans contrôle du port`);
  }
  const deploy = read('infra/deploy/scripts/deploy.sh');
  const loop = deploy.slice(deploy.indexOf('for i in $(seq 1 10); do'));
  assert.ok(loop.indexOf('port_owned_by "$API_PORT" "$APP_USER"') < loop.indexOf('curl -fsS'), 'deploy.sh : readiness crue avant le contrôle du port');
  const health = read('infra/deploy/scripts/healthwatch.sh');
  assert.ok(health.indexOf('port_owned_by "$p" "$APP_USER"') < health.indexOf('"${API_BASE}/api/v1/ready"'), 'healthwatch.sh : readiness interrogée avant le contrôle du port');
});

test('résiduel 1 : port_owned_by sur un écouteur RÉEL (ss du système)', async () => {
  const { createServer } = await import('node:net');
  const { userInfo } = await import('node:os');
  const deploy = read('infra/deploy/scripts/deploy.sh');
  const fn = deploy.slice(deploy.indexOf('# >>> port_owner'), deploy.indexOf('# <<< port_owner'));
  if (spawnSync('bash', ['-c', 'command -v ss'], { encoding: 'utf8' }).status !== 0) return; // ss absent : contrôle statique seul
  const server = createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const check = (p, user) => spawnSync('bash', ['-c', `${fn}\nport_owned_by "$1" "$2"`, '_', String(p), user], { encoding: 'utf8' }).status;
  try {
    const me = userInfo().username;
    if (process.getuid?.() === 0) {
      assert.notEqual(check(port, 'root'), 0, 'écouteur root accepté'); // ss n'affiche pas l'uid 0
    } else {
      assert.equal(check(port, me), 0, 'écouteur du compte courant refusé');
    }
    assert.notEqual(check(port, 'nobody'), 0, 'écouteur d’un autre compte accepté');
    assert.notEqual(check(port, 'compte-inexistant-digisante'), 0);
    assert.notEqual(check('abc', me), 0);
  } finally { await new Promise((r) => server.close(r)); }
  assert.notEqual(check(port, userInfo().username), 0, 'port libre accepté');
});

test('B3 : chaque script root vérifie sa propre origine avec un trusted_path identique', () => {
  const block = (text) => text.slice(text.indexOf('# >>> trusted_path'), text.indexOf('# <<< trusted_path'));
  const reference = block(read('infra/deploy/scripts/install_root_scripts.sh'));
  assert.ok(reference.includes('trusted_path() {'));
  for (const path of rootScripts) {
    const text = read(path);
    assert.equal(block(text), reference, `${path} : bloc trusted_path absent ou divergent`);
    assert.match(text, /^trusted_path "\$\{BASH_SOURCE\[0\]\}" \|\|/m, `${path} : garde d'origine absente`);
  }
  const health = withoutProfile(read('infra/deploy/scripts/healthwatch.sh'));
  assert.doesNotMatch(health, /\/var\/www/);
  assert.doesNotMatch(health, /\/var\/log\/digisante\/(?!api-)/, 'journaux root lus dans le répertoire applicatif');
  assert.match(health, /trusted_path "\$BACKUP_CHECK"/);
  assert.match(health, /trusted_path "\$CONF"/);
  // provision : sous APP_DIR, seules opérations root admises = création du répertoire et
  // chown -R (sans suivre les liens) ; le reste sous l'identité applicative.
  for (const line of read('infra/deploy/scripts/provision.sh').split('\n')) {
    if (/^\s*#/.test(line) || !/"\$APP_DIR\//.test(line)) continue;
    assert.match(line, /^sudo -u "\$APP_USER" /, `provision.sh opère en root sous APP_DIR : ${line}`);
  }
  // logrotate : root jamais actif dans un répertoire possédé par l'utilisateur applicatif.
  const rotate = read('infra/deploy/logrotate/digisante');
  const appStanza = /\/var\/log\/digisante\/\*\.log \{([^}]*)\}/.exec(rotate)?.[1] ?? '';
  assert.match(appStanza, /^\s*su digisante digisante$/m);
  assert.doesNotMatch(rotate, /su root root/);
  assert.match(rotate, /\/var\/log\/digisante-cron\/\*\.log \{/);
});

test('B3 : installateur — garanties statiques (racine, SHA exact, ancêtre de main, miroir root, jamais APP_DIR)', () => {
  const text = read('infra/deploy/scripts/install_root_scripts.sh');
  assert.match(text, /^set -euo pipefail$/m);
  assert.match(text, /\(\( EUID == 0 \)\) \|\|/);
  assert.match(text, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(text, /merge-base --is-ancestor "\$SHA"/);
  assert.match(text, /--git-dir="\$OPS_MIRROR"/);
  assert.match(text, /https:\/\/github\.com\/malcomx2022\/digisante-mobile\.git/);
  const code = withoutProfile(text).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /\/var\/www|digisante-mobile\/\.git/, 'aucune source dans APP_DIR');
  assert.match(text, /^digisante_profile \|\| exit 1$/m, 'profil d’environnement obligatoire');
  assert.match(text, /echo "environment=\$\{DIGISANTE_ENV\}"/, 'environnement inscrit au manifeste');
  assert.doesNotMatch(code, /^\s*(?:source|\.)\s+\S/m, 'configuration lue comme données, jamais sourcée');
});

test('B3 : installateur refusé hors root', () => {
  const installer = resolve(root, 'infra/deploy/scripts/install_root_scripts.sh');
  const args = isRoot ? ['setpriv', ['--reuid=65534', '--regid=65534', '--clear-groups', 'bash', installer, 'a'.repeat(40)]] : ['bash', [installer, 'a'.repeat(40)]];
  const r = spawnSync(args[0], args[1], { encoding: 'utf8', env: { ...process.env, ROOT_LIB: join(tmpdir(), 'never-created-root-lib') } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /à lancer en root/);
  assert.ok(!existsSync(join(tmpdir(), 'never-created-root-lib')));
});

function gitIn(cwd, args) {
  const r = spawnSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function installerFixture() {
  const tmp = mkdtempSync(join(tmpdir(), 'digisante-b3-'));
  const src = join(tmp, 'src');
  mkdirSync(src, { mode: 0o755 });
  gitIn(src, ['init', '-q']);
  for (const [path] of LIST) { mkdirSync(dirname(join(src, path)), { recursive: true, mode: 0o755 }); copyFileSync(resolve(root, path), join(src, path)); }
  gitIn(src, ['add', '-A']); gitIn(src, ['commit', '-q', '-m', 'root scripts v1']);
  const sha1 = gitIn(src, ['rev-parse', 'HEAD']);
  mkdirSync(join(tmp, 'etc'), { mode: 0o700 });
  const conf = join(tmp, 'etc/ops.env');
  writeFileSync(conf, `# synthétique\nOPS_REPO_URL="file://${src}"\nOPS_BRANCH=main\n`); chmodSync(conf, 0o600);
  const env = { ...process.env, DIGISANTE_ENV: 'preproduction', ROOT_LIB: join(tmp, 'lib'), OPS_MIRROR: join(tmp, 'state/ops.git'), OPS_CONF: conf, OPS_LOG_DIR: join(tmp, 'log') };
  const installer = resolve(root, 'infra/deploy/scripts/install_root_scripts.sh');
  const run = (args, extra = {}, path = installer) => spawnSync('bash', [path, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
  return { tmp, src, sha1, conf, env, run, clean: () => rmSync(tmp, { recursive: true, force: true }) };
}
const manifestFiles = (lib) => Object.fromEntries(readFileSync(join(lib, 'root-scripts.manifest'), 'utf8').split('\n').map((l) => /^file=(\S+) mode=(0755|0644) sha256=([0-9a-f]{64})$/.exec(l)).filter(Boolean).map((m) => [m[1], { mode: m[2], sha256: m[3] }]));

test('B3 : installateur — copie root:root du COMMIT (jamais de l’arbre de travail), manifeste et mise à jour', { skip: !isRoot && 'installation réelle : exige root (chown root:root)' }, () => {
  const f = installerFixture();
  try {
    // Modification NON commitée de la source : ne doit jamais être installée.
    writeFileSync(join(f.src, 'infra/deploy/scripts/healthwatch.sh'), '#!/bin/bash\necho TAMPERED\n');
    let r = f.run([f.sha1]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, new RegExp(`OK : ${LIST.size} fichier\\(s\\) du commit ${f.sha1}`));
    const lib = f.env.ROOT_LIB;
    assert.match(readFileSync(join(lib, 'root-scripts.manifest'), 'utf8'), new RegExp(`^sha=${f.sha1}$`, 'm'));
    assert.match(readFileSync(join(lib, 'root-scripts.manifest'), 'utf8'), /^environment=preproduction$/m);
    const files = manifestFiles(lib);
    assert.deepEqual(Object.keys(files).sort(), [...LIST.keys()].sort());
    for (const [path, mode] of LIST) {
      const installed = join(lib, path); const st = statSync(installed);
      assert.equal(st.uid, 0, path); assert.equal((st.mode & 0o7777).toString(8), mode.slice(1), path);
      const committed = spawnSync('git', ['show', `${f.sha1}:${path}`], { cwd: f.src }).stdout;
      assert.ok(readFileSync(installed).equals(committed), `${path} ≠ blob du commit`);
      assert.equal(files[path].sha256, createHash('sha256').update(committed).digest('hex'));
      for (let d = dirname(installed); d !== dirname(lib); d = dirname(d)) assert.equal((statSync(d).mode & 0o777).toString(8), '755', d);
    }
    assert.doesNotMatch(readFileSync(join(lib, 'infra/deploy/scripts/healthwatch.sh'), 'utf8'), /TAMPERED/);
    assert.equal((statSync(f.env.OPS_MIRROR).mode & 0o777).toString(8), '700');
    assert.match(readFileSync(join(f.env.OPS_LOG_DIR, 'install_root_scripts.log'), 'utf8'), /OK : /);
    // Les scripts installés acceptent de tourner depuis la copie root (garde d'origine).
    const job = spawnSync('bash', [join(lib, 'infra/deploy/scripts/internal_job.sh'), '/api/v1/x'], { encoding: 'utf8', env: { ...process.env, DIGISANTE_ENV: 'preproduction', ROOT_LIB: lib, RECONCILE_TOKEN_FILE: join(f.tmp, 'absent') } });
    assert.match(job.stdout, /ÉCHEC : jeton de service absent/);

    // v2 : un fichier retiré de la liste est supprimé ; contenu mis à jour par commit.
    gitIn(f.src, ['checkout', '-q', '--', '.']);
    const listPath = join(f.src, 'infra/deploy/root-scripts.list');
    writeFileSync(listPath, readFileSync(listPath, 'utf8').replace(/^0644 infra\/deploy\/nginx\/hsts-after-tls\.conf\n/m, ''));
    writeFileSync(join(f.src, 'infra/deploy/scripts/healthwatch.sh'), readFileSync(join(f.src, 'infra/deploy/scripts/healthwatch.sh'), 'utf8') + '# v2\n');
    gitIn(f.src, ['commit', '-q', '-am', 'root scripts v2']);
    const sha2 = gitIn(f.src, ['rev-parse', 'HEAD']);
    r = f.run([], { ROOT_SCRIPTS_REF: sha2 });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(!existsSync(join(lib, 'infra/deploy/nginx/hsts-after-tls.conf')));
    assert.match(readFileSync(join(lib, 'infra/deploy/scripts/healthwatch.sh'), 'utf8'), /# v2\n$/);
    assert.match(readFileSync(join(lib, 'root-scripts.manifest'), 'utf8'), new RegExp(`^sha=${sha2}$`, 'm'));
    assert.ok(!readdirSync(lib).some((n) => n.startsWith('.staging.')), 'zone de préparation nettoyée');

    // L'installateur INSTALLÉ (copie root) fonctionne et peut se réinstaller.
    r = f.run([f.sha1], {}, join(lib, 'infra/deploy/scripts/install_root_scripts.sh'));
    assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally { f.clean(); }
});

test('B3 : installateur — SHA non qualifié, commit hors main, configuration non fiable refusés sans installation', { skip: !isRoot && 'exige root' }, () => {
  const f = installerFixture();
  try {
    gitIn(f.src, ['checkout', '-q', '-b', 'side']);
    writeFileSync(join(f.src, 'infra/deploy/scripts/internal_job.sh'), '#!/bin/bash\necho side\n');
    gitIn(f.src, ['commit', '-q', '-am', 'hors main']);
    const side = gitIn(f.src, ['rev-parse', 'HEAD']);
    gitIn(f.src, ['checkout', '-q', 'main']);
    const cases = [
      [['main'], {}, /SHA complet/],
      [[f.sha1.slice(0, 12)], {}, /SHA complet/],
      [[], {}, /SHA complet/],
      [[f.sha1, 'extra'], {}, /un seul argument/],
      [[side], {}, /absent du miroir/],
      [['f'.repeat(40)], {}, /absent du miroir/],
    ];
    for (const [args, extra, message] of cases) {
      const r = f.run(args, extra);
      assert.notEqual(r.status, 0, args.join(' '));
      assert.match(r.stderr, message, args.join(' '));
      assert.ok(!existsSync(join(f.env.ROOT_LIB, 'root-scripts.manifest')), 'aucune installation');
    }
    const confCases = [
      ['OPS_REPO_URL=https://user:SYNTHETIC_PASSWORD@github.com/malcomx2022/digisante-mobile.git\n', 0o600, /URL du dépôt source refusée/],
      ['OPS_REPO_URL=ext::sh -c id\n', 0o600, /URL du dépôt source refusée/],
      ['FOO=SYNTHETIC_PASSWORD\n', 0o600, /ligne non reconnue/],
      [`OPS_REPO_URL=file://${f.src}\n`, 0o644, /0600 ou 0400/],
      ['OPS_BRANCH=../main\n', 0o600, /branche invalide/],
    ];
    for (const [content, mode, message] of confCases) {
      writeFileSync(f.conf, content); chmodSync(f.conf, mode);
      const r = f.run([f.sha1]);
      assert.notEqual(r.status, 0, content);
      assert.match(r.stderr, message, content);
      assert.doesNotMatch(r.stdout + r.stderr, /SYNTHETIC_PASSWORD/, 'contenu de configuration jamais affiché');
    }
    // file:// vers un dépôt modifiable par un autre compte (ex. APP_DIR/.git) : refusé.
    writeFileSync(f.conf, `OPS_REPO_URL=file://${f.src}\n`); chmodSync(f.conf, 0o600); chmodSync(f.src, 0o775);
    let r = f.run([f.sha1]);
    assert.notEqual(r.status, 0); assert.match(r.stderr, /URL du dépôt source refusée/);
    chmodSync(f.src, 0o755);
    // Installateur lancé depuis un emplacement modifiable par autrui : refusé avant tout effet.
    const writable = join(f.tmp, 'writable'); mkdirSync(writable, { mode: 0o755 }); chmodSync(writable, 0o777);
    copyFileSync(resolve(root, 'infra/deploy/scripts/install_root_scripts.sh'), join(writable, 'install_root_scripts.sh'));
    r = f.run([f.sha1], {}, join(writable, 'install_root_scripts.sh'));
    assert.notEqual(r.status, 0); assert.match(r.stderr, /modifiable par un autre compte/);
    assert.ok(!existsSync(join(f.env.ROOT_LIB, 'root-scripts.manifest')));
    // Commit déjà présent dans le miroir mais retiré de main (historique réécrit) : refusé.
    r = f.run([f.sha1]);
    assert.equal(r.status, 0, r.stderr);
    gitIn(f.src, ['commit', '-q', '--amend', '-m', 'historique réécrit']);
    r = f.run([f.sha1]);
    assert.notEqual(r.status, 0); assert.match(r.stderr, /absent de origin\/main/);
    assert.match(readFileSync(join(f.env.ROOT_LIB, 'root-scripts.manifest'), 'utf8'), new RegExp(`^sha=${f.sha1}$`, 'm'), 'installation précédente intacte');
  } finally { f.clean(); }
});
