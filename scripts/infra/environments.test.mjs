// ─────────────────────────────────────────────────────────────
// Hôte IONOS partagé (dérogation porteur 13/10/2026) : préproduction et production
// cohabitent avec ImmiPro (3000) et Grafana (3001). Une SEULE définition par environnement
// doit gouverner noms PM2, ports, chemins, crontab, vhost Nginx et rotation des journaux :
//   • `digisante_profile` (copie IDENTIQUE dans chaque script d'exploitation) ;
//   • `ecosystem.config.cjs` (PM2), comparé au profil ;
//   • fichiers par environnement (crontab, Nginx, logrotate) identiques hors marqueurs.
// Contrôles statiques et évaluation locale du profil/ecosystem, sans réseau ni PM2.
// ─────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const ENVS = ['preproduction', 'production'];
// Scripts d'exploitation pilotés par DIGISANTE_ENV (provision.sh : à adapter avant usage
// sur l'hôte partagé ; verify_restore.sh : machine de restauration isolée).
const PROFILED = ['deploy.sh', 'healthwatch.sh', 'verify_deploy.sh', 'internal_job.sh', 'fedapay_reconcile.sh', 'pg_dump_encrypted.sh', 'install_root_scripts.sh'];
const ROOT_GUARDED = ['healthwatch.sh', 'verify_deploy.sh', 'internal_job.sh', 'fedapay_reconcile.sh', 'pg_dump_encrypted.sh'];
const block = (text) => {
  const start = text.indexOf('# >>> digisante_profile');
  const end = text.indexOf('# <<< digisante_profile');
  return start >= 0 && end > start ? text.slice(start, end) : '';
};
const PROFILE = block(read('infra/deploy/scripts/deploy.sh'));

/** Valeurs du profil pour un environnement (bash réel, environnement contrôlé). */
function profile(env, extra = {}) {
  const keys = ['PM2_API', 'PM2_WEB', 'API_PORT', 'WEB_PORT', 'API_BASE', 'APP_USER', 'APP_DIR', 'APP_LOG_DIR', 'ETC_DIR', 'ROOT_LIB', 'STATE_DIR', 'CRON_LOG_DIR', 'BACKUP_DIR', 'DB_NAME', 'CRON_FILE', 'WS_LOG'];
  const script = `set -euo pipefail\n${PROFILE}\ndigisante_profile\n${keys.map((k) => `printf '%s=%s\\n' ${k} "$${k}"`).join('\n')}\n`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH, ...(env === undefined ? {} : { DIGISANTE_ENV: env }), ...extra } });
  return { status: r.status, stderr: r.stderr, values: Object.fromEntries(r.stdout.trim().split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2))) };
}
/** ecosystem.config.cjs évalué dans un processus neuf (il lit DIGISANTE_ENV au chargement). */
function ecosystem(env) {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(require(process.argv[1])))', join(ROOT, 'ecosystem.config.cjs')], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...(env === undefined ? {} : { DIGISANTE_ENV: env }) },
  });
  return { status: r.status, stderr: r.stderr, config: r.status === 0 ? JSON.parse(r.stdout) : null };
}

test('profil : bloc IDENTIQUE dans chaque script d’exploitation, appelé avant usage ; garde de copie root', () => {
  assert.match(PROFILE, /digisante_profile\(\) \{/);
  for (const name of PROFILED) {
    const text = read(`infra/deploy/scripts/${name}`);
    assert.equal(block(text), PROFILE, `${name} : bloc digisante_profile absent ou divergent`);
    assert.match(text, /^(?:digisante_profile \|\| exit 1|digisante_profile)$/m, `${name} : profil jamais appelé`);
    // Hors profil : aucun ancien défaut (port 3000/3001, noms PM2 ou checkout codés en dur).
    const code = text.replace(PROFILE, '').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    // (`service==="digisante-api"` de /health est le nom du service, pas un nom PM2.)
    assert.doesNotMatch(code, /127\.0\.0\.1:300[01]\b|(?:\[|n\()"digisante-(?:api|web)"|\/var\/www\/digisante-mobile|pm2 logs digisante\b/, `${name} : défaut d’environnement codé en dur`);
  }
  for (const name of ROOT_GUARDED) {
    assert.match(read(`infra/deploy/scripts/${name}`), /^\[\[ "\$\(readlink -f -- "\$ROOT_LIB"\)" == "\$SELF_ROOT" \]\] \|\| \{ echo ".*copie root d'un autre environnement/m, `${name} : garde de copie root absente`);
  }
});

test('profil : DIGISANTE_ENV obligatoire, valeurs par environnement, ports/noms/URL non surchargeables', () => {
  for (const bad of [undefined, '', 'prod', 'toString']) {
    const r = profile(bad);
    assert.notEqual(r.status, 0, String(bad));
    assert.match(r.stderr, /DIGISANTE_ENV requis/);
  }
  const pre = profile('preproduction').values;
  assert.deepEqual(
    { ...pre },
    {
      PM2_API: 'digisante-preprod-api', PM2_WEB: 'digisante-preprod-web', API_PORT: '3101', WEB_PORT: '3100', API_BASE: 'http://127.0.0.1:3101',
      APP_USER: 'digisante-preprod', APP_DIR: '/var/www/digisante-preprod', APP_LOG_DIR: '/var/log/digisante-preprod', ETC_DIR: '/etc/digisante-preprod',
      ROOT_LIB: '/usr/local/lib/digisante-preprod', STATE_DIR: '/var/lib/digisante-preprod', CRON_LOG_DIR: '/var/log/digisante-preprod-cron',
      BACKUP_DIR: '/var/backups/digisante-preprod', DB_NAME: 'digisante_preprod', CRON_FILE: '/etc/cron.d/digisante-preprod', WS_LOG: '/var/log/nginx/digisante-preprod-ws.log',
    },
  );
  const prod = profile('production').values;
  assert.deepEqual(
    { ...prod },
    {
      PM2_API: 'digisante-api', PM2_WEB: 'digisante-web', API_PORT: '3201', WEB_PORT: '3200', API_BASE: 'http://127.0.0.1:3201',
      APP_USER: 'digisante', APP_DIR: '/var/www/digisante', APP_LOG_DIR: '/var/log/digisante', ETC_DIR: '/etc/digisante',
      ROOT_LIB: '/usr/local/lib/digisante', STATE_DIR: '/var/lib/digisante', CRON_LOG_DIR: '/var/log/digisante-cron',
      BACKUP_DIR: '/var/backups/digisante', DB_NAME: 'digisante', CRON_FILE: '/etc/cron.d/digisante', WS_LOG: '/var/log/nginx/digisante-ws.log',
    },
  );
  // Aucun chemin, port ou nom commun aux deux environnements (hôte partagé).
  for (const [k, v] of Object.entries(pre)) assert.notEqual(prod[k], v, `${k} partagé entre environnements`);
  // Chemins : la valeur de l'opérateur prime. Ports, noms PM2, URL d'API : jamais (un
  // ancien API_PORT=3001 enverrait le jeton de service à Grafana).
  const over = profile('preproduction', { BACKUP_DIR: '/srv/b', API_PORT: '3001', API_BASE: 'http://127.0.0.1:3001', PM2_API: 'digisante-api' }).values;
  assert.equal(over.BACKUP_DIR, '/srv/b');
  assert.equal(over.API_PORT, '3101');
  assert.equal(over.API_BASE, 'http://127.0.0.1:3101');
  assert.equal(over.PM2_API, 'digisante-preprod-api');
});

test('ecosystem.config.cjs : DIGISANTE_ENV obligatoire, noms/ports/journaux = profil, écoute locale, API_PORT lu par l’API', () => {
  for (const bad of [undefined, '', 'prod', 'toString', 'constructor']) {
    const r = ecosystem(bad);
    assert.notEqual(r.status, 0, String(bad));
    assert.match(r.stderr, /DIGISANTE_ENV requis/);
  }
  // L'API lit API_PORT/API_HOST (jamais PORT) : la clé posée par PM2 doit être celle-là.
  const envTs = read('apps/api/src/lib/env.ts');
  assert.match(envTs, /API_PORT: z\.coerce\.number\(\)/);
  assert.match(envTs, /API_HOST: z\.string\(\)/);
  for (const env of ENVS) {
    const p = profile(env).values;
    const { config } = ecosystem(env);
    const [api, web] = config.apps;
    assert.equal(api.name, p.PM2_API);
    assert.equal(web.name, p.PM2_WEB);
    assert.equal(api.env.API_PORT, p.API_PORT, `${env} : port de l’API`);
    assert.equal(api.env.API_HOST, '127.0.0.1', `${env} : API joignable hors Nginx`);
    assert.equal(api.instances, 2);
    assert.equal(web.args, `start -p ${p.WEB_PORT} -H 127.0.0.1`);
    // Chemins ABSOLUS du checkout : PM2 (cluster) ne transmet pas le cwd aux node_args, et
    // `pm2 resurrect` démarre depuis `/` — un `.env` relatif n'était jamais trouvé.
    assert.equal(api.cwd, join(ROOT, 'apps/api'));
    assert.equal(web.cwd, join(ROOT, 'apps/web'));
    assert.equal(api.node_args, `--env-file=${join(ROOT, 'apps/api/.env')}`);
    assert.doesNotMatch(api.node_args, /\s/, 'PM2 découpe node_args sur les espaces');
    for (const app of config.apps) {
      assert.ok(app.error_file.startsWith(`${p.APP_LOG_DIR}/`) && app.out_file.startsWith(`${p.APP_LOG_DIR}/`), `${env} : journaux ${app.name}`);
    }
  }
});

/** Équivalence de deux fichiers d'environnement : l'en-tête (premier bloc de commentaires) est libre. */
function body(text) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].startsWith('#') || lines[i].trim() === '')) i++;
  return lines.slice(i).join('\n');
}
const toProduction = (text, pairs) => pairs.reduce((t, [re, to]) => t.replace(re, to), text);

test('Nginx : vhost préproduction = production hors marqueurs ; upstreams/ports = profil ; noms globaux préfixés', () => {
  const prod = read('infra/deploy/nginx/digisante.conf');
  const pre = read('infra/deploy/nginx/digisante-preprod.conf');
  const mapped = toProduction(body(pre), [
    [/\bdigisante_preprod_(web|api)\b/g, 'digisante_$1'],
    [/127\.0\.0\.1:3100\b/g, '127.0.0.1:3200'],
    [/127\.0\.0\.1:3101\b/g, '127.0.0.1:3201'],
    [/port local 3100 \(DIGISANTE_ENV=preproduction\)/g, 'port local 3200 (DIGISANTE_ENV=production)'],
    [/port local 3101,/g, 'port local 3201,'],
    [/server_name preprod\.digisantemobile\.app;/g, 'server_name digisantemobile.app www.digisantemobile.app;'],
    [/\/var\/log\/nginx\/digisante-preprod-/g, '/var/log/nginx/digisante-'],
  ]);
  assert.equal(mapped, body(prod), 'digisante-preprod.conf a dérivé de digisante.conf');
  for (const [env, text] of [['production', prod], ['preproduction', pre]]) {
    const p = profile(env).values;
    const upstreams = Object.fromEntries([...text.matchAll(/upstream (\w+) \{\s*\n\s*server 127\.0\.0\.1:(\d+);/g)].map((m) => [m[1], m[2]]));
    const sfx = env === 'production' ? '' : 'preprod_';
    assert.deepEqual(upstreams, { [`digisante_${sfx}web`]: p.WEB_PORT, [`digisante_${sfx}api`]: p.API_PORT }, `${env} : upstreams`);
    assert.ok(text.includes(`access_log ${p.WS_LOG} digisante_noquery;`), `${env} : journal WS = WS_LOG du profil (verify_deploy)`);
    // Domaine et journal général propres à l'environnement (la normalisation ci-dessus
    // les masque : un vhost préprod déclarant le domaine de production passerait sinon).
    const names = env === 'production' ? 'digisantemobile.app www.digisantemobile.app' : 'preprod.digisantemobile.app';
    assert.deepEqual([...text.matchAll(/^\s*server_name ([^;]+);/gm)].map((m) => m[1]), [names], `${env} : server_name`);
    const logSfx = env === 'production' ? '' : '-preprod';
    assert.ok(text.includes(`access_log /var/log/nginx/digisante${logSfx}-access.log digisante_noquery;`), `${env} : journal d'accès`);
    for (const proxied of text.matchAll(/proxy_pass http:\/\/(\w+);/g)) assert.ok(proxied[1] in upstreams, `${env} : ${proxied[1]}`);
    assert.match(text, /^\s+server_tokens off;$/m, `${env} : server_tokens au niveau serveur`);
    assert.match(text, /^\s+limit_req_status 429;$/m, `${env} : limit_req_status au niveau serveur`);
  }
  // Contexte http{} partagé : aucun nom générique, aucune directive globale imposée aux voisins.
  const zones = read('infra/deploy/nginx/rate-limit.conf');
  for (const [, name] of zones.matchAll(/zone=(\w+):/g)) assert.match(name, /^digisante_/, `zone ${name} non préfixée`);
  for (const [, name] of zones.matchAll(/log_format (\w+)/g)) assert.match(name, /^digisante_/, `format ${name} non préfixé`);
  const active = zones.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(active, /server_tokens|limit_req_status/, 'directive globale imposée à l’hôte partagé');
});

test('crontabs /etc/cron.d : mêmes tâches pour les deux environnements, chemins du profil, horaires lourds décalés', () => {
  const jobs = (text) => text.split('\n').filter((l) => /^[*@0-9]/.test(l));
  const prod = read('infra/deploy/crontab.example');
  const pre = read('infra/deploy/crontab.preproduction.example');
  for (const [env, text] of [['production', prod], ['preproduction', pre]]) {
    const p = profile(env).values;
    assert.match(text, new RegExp(`^DIGISANTE_ENV=${env}$`, 'm'));
    assert.match(text, new RegExp(`^J=${p.ROOT_LIB}/infra/deploy/scripts/internal_job\\.sh$`, 'm'));
    assert.ok(text.includes(`/etc/cron.d/${p.CRON_FILE.split('/').pop()}`), `${env} : installation dans CRON_FILE`);
    assert.doesNotMatch(text.split('\n').filter((l) => !l.startsWith('#')).join('\n'), /^DB_NAME=/m, `${env} : base fixée par le profil`);
    for (const line of jobs(text)) {
      for (const [, target] of line.matchAll(/>>\s*(\S+)/g)) assert.ok(target.startsWith(`${p.CRON_LOG_DIR}/`), `${env} : ${target}`);
      for (const [, path] of line.matchAll(/(\/usr\/local\/lib\/[^/\s]+)\//g)) assert.equal(path, p.ROOT_LIB, `${env} : ${line}`);
    }
  }
  const strip = (line) => line.replace(/^((?:\S+\s+){5})/, '');
  const mappedPre = jobs(pre).map((l) => strip(l).replaceAll('/usr/local/lib/digisante-preprod/', '/usr/local/lib/digisante/').replaceAll('/var/log/digisante-preprod-cron/', '/var/log/digisante-cron/'));
  assert.deepEqual(mappedPre, jobs(prod).map(strip), 'tâches divergentes entre environnements');
  // Sauvegardes et renouvellement certbot jamais simultanés sur l'hôte partagé.
  const at = (text, re) => jobs(text).find((l) => re.test(l)).split(/\s+/).slice(0, 5).join(' ');
  assert.notEqual(at(pre, /pg_dump_encrypted\.sh/), at(prod, /pg_dump_encrypted\.sh/));
  assert.notEqual(at(pre, /certbot renew/), at(prod, /certbot renew/));
});

test('logrotate : fichier préproduction = production hors chemins/utilisateur du profil', () => {
  const prod = read('infra/deploy/logrotate/digisante');
  const pre = read('infra/deploy/logrotate/digisante-preprod');
  const mapped = toProduction(body(pre), [
    [/\/var\/log\/digisante-preprod-cron\//g, '/var/log/digisante-cron/'],
    [/\/var\/log\/digisante-preprod\//g, '/var/log/digisante/'],
    [/\bdigisante-preprod\b/g, 'digisante'],
  ]);
  assert.equal(mapped, body(prod), 'logrotate/digisante-preprod a dérivé de logrotate/digisante');
  for (const [env, text] of [['production', prod], ['preproduction', pre]]) {
    const p = profile(env).values;
    assert.ok(text.includes(`${p.APP_LOG_DIR}/*.log {`), `${env} : journaux applicatifs`);
    assert.ok(text.includes(`${p.CRON_LOG_DIR}/*.log {`), `${env} : journaux root`);
    assert.match(text, new RegExp(`^\\s+su ${p.APP_USER} ${p.APP_USER}$`, 'm'), `${env} : rotation sous l’identité applicative`);
  }
});

test('workflows : checkout de déploiement = APP_DIR du profil de l’environnement déployé', () => {
  for (const [file, env] of [['.github/workflows/ci.yml', 'production'], ['.github/workflows/preproduction.yml', 'preproduction']]) {
    const text = read(file);
    assert.match(text, new RegExp(`^\\s+cd ${profile(env).values.APP_DIR}$`, 'm'), file);
    assert.match(text, new RegExp(`DEPLOY_ENVIRONMENT=${env}`), file);
  }
});
