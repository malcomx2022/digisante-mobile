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
const PROFILED = ['deploy.sh', 'healthwatch.sh', 'verify_deploy.sh', 'internal_job.sh', 'fedapay_reconcile.sh', 'pg_dump_encrypted.sh', 'install_root_scripts.sh', 'provision-ionos.sh'];
const ROOT_GUARDED = ['healthwatch.sh', 'verify_deploy.sh', 'internal_job.sh', 'fedapay_reconcile.sh', 'pg_dump_encrypted.sh', 'provision-ionos.sh'];
const block = (text) => {
  const start = text.indexOf('# >>> digisante_profile');
  const end = text.indexOf('# <<< digisante_profile');
  return start >= 0 && end > start ? text.slice(start, end) : '';
};
const PROFILE = block(read('infra/deploy/scripts/deploy.sh'));

/** Valeurs du profil pour un environnement (bash réel, environnement contrôlé). */
function profile(env, extra = {}) {
  const keys = ['PM2_API', 'PM2_WEB', 'API_PORT', 'WEB_PORT', 'API_BASE', 'APP_USER', 'JOBS_USER', 'APP_DIR', 'APP_LOG_DIR', 'ETC_DIR', 'ROOT_LIB', 'STATE_DIR', 'CRON_LOG_DIR', 'BACKUP_DIR', 'DB_NAME', 'CRON_FILE', 'WS_LOG'];
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
    // provision-ionos.sh préfixe ses chemins par F() (racine de test, vide en exploitation).
    assert.match(read(`infra/deploy/scripts/${name}`), /^\[\[ "\$\(readlink -f -- "\$(?:ROOT_LIB|\(F "\$ROOT_LIB"\))"\)" == "\$SELF_ROOT" \]\] \|\| \{ echo ".*copie root d'un autre environnement/m, `${name} : garde de copie root absente`);
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
      APP_USER: 'digisante-preprod', JOBS_USER: 'digisante-preprod-jobs', APP_DIR: '/var/www/digisante-preprod', APP_LOG_DIR: '/var/log/digisante-preprod', ETC_DIR: '/etc/digisante-preprod',
      ROOT_LIB: '/usr/local/lib/digisante-preprod', STATE_DIR: '/var/lib/digisante-preprod', CRON_LOG_DIR: '/var/log/digisante-preprod-cron',
      BACKUP_DIR: '/var/backups/digisante-preprod', DB_NAME: 'digisante_preprod', CRON_FILE: '/etc/cron.d/digisante-preprod', WS_LOG: '/var/log/nginx/digisante-preprod-ws.log',
    },
  );
  const prod = profile('production').values;
  assert.deepEqual(
    { ...prod },
    {
      PM2_API: 'digisante-api', PM2_WEB: 'digisante-web', API_PORT: '3201', WEB_PORT: '3200', API_BASE: 'http://127.0.0.1:3201',
      APP_USER: 'digisante', JOBS_USER: 'digisante-jobs', APP_DIR: '/var/www/digisante', APP_LOG_DIR: '/var/log/digisante', ETC_DIR: '/etc/digisante',
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
    // Hôte partagé de 4 Go : seuil de redémarrage PM2 par processus (3 processus par environnement).
    assert.equal(api.max_memory_restart, '512M', `${env} : plafond API`);
    assert.equal(web.max_memory_restart, '512M', `${env} : plafond web`);
    assert.equal(web.args, `start -p ${p.WEB_PORT} -H 127.0.0.1`);
    // Chemins ABSOLUS du checkout (`pm2 resurrect` démarre depuis `/`).
    assert.equal(api.cwd, join(ROOT, 'apps/api'));
    assert.equal(web.cwd, join(ROOT, 'apps/web'));
    // PM2 importe le script depuis ProcessContainer(Fork).js : l'entrée doit démarrer sans
    // garde process.argv (dist/server.js restait « online » sans écouter, préprod 15/10/2026).
    assert.equal(api.script, 'dist/main.js');
    assert.equal(api.exec_mode, 'cluster');
    // .env chargé par l'API elle-même : aucun argument Node requis de PM2.
    assert.equal(api.node_args, undefined);
    // Échec de démarrage (base pas prête au reboot) : relance à délai croissant, jamais `errored`.
    assert.equal(api.exp_backoff_restart_delay, 100);
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
const logSfx0 = (env) => (env === 'production' ? '' : '-preprod');
const toProduction = (text, pairs) => pairs.reduce((t, [re, to]) => t.replace(re, to), text);

test('API : entrée PM2 sans garde process.argv, .env chargé par l’API depuis son propre checkout', () => {
  // Sous PM2, process.argv[1] = ProcessContainer(Fork).js : toute garde « lancé directement »
  // est fausse ⇒ API « online » muette (préprod 15/10/2026). L'entrée démarre toujours.
  const main = read('apps/api/src/main.ts').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(main, /process\.argv|import\.meta\.url/, 'aucune garde de lancement dans l’entrée');
  // Configuration puis serveur importés DANS le try (erreur d'évaluation couverte), puis start() ;
  // tout échec sort en code 1 — PM2 (cluster) avale les promesses rejetées sans arrêter le worker.
  const body = main.replace(/\s+/g, ' ');
  assert.match(body, /try \{ await import\('@\/lib\/env\.js'\); const \{ start \} = await import\('@\/server\.js'\); await start\(\); \} catch \(err\) \{/);
  // Sortie en code 1 APRÈS écriture effective (rappel de process.stderr.write), filet minuté.
  assert.match(body, /catch \(err\) \{ process\.exitCode = 1; const exit = \(\) => process\.exit\(1\);/);
  assert.match(body, /process\.stderr\.write\(`❌ Démarrage de l'API impossible : \$\{describeBootError\(err\)\}\\n`, \(\) => \{ clearTimeout\(fallback\); exit\(\); \}\);/);
  // env.ts LÈVE (plus de process.exit) : seule l'entrée décide de la sortie, journal vidé.
  assert.doesNotMatch(read('apps/api/src/lib/env.ts').replace(/^\s*\/\/.*$/gm, ''), /process\.exit/);
  assert.doesNotMatch(main, /void start\(\)|import \{ start \} from/, 'aucun démarrage hors du try');
  const pkg = JSON.parse(read('apps/api/package.json'));
  assert.equal(pkg.scripts.start, 'node dist/main.js');
  assert.equal(pkg.scripts.dev, 'tsx watch src/main.ts');
  // Le .env est résolu depuis le module (src/lib ou dist/lib → apps/api/.env), jamais depuis le cwd,
  // et chargé AVANT la validation.
  const envFile = read('apps/api/src/lib/env-file.ts');
  assert.match(envFile, /resolve\(dirname\(fileURLToPath\(import\.meta\.url\)\), '\.\.\/\.\.\/\.env'\)/);
  assert.match(envFile, /file: string = API_ENV_FILE,/, 'fichier par défaut = constante du module, jamais le cwd');
  // Jamais chargé sous Vitest, même avec un NODE_ENV exporté (sinon les tests visent la base du .env).
  assert.match(envFile, /if \(target\.NODE_ENV === 'test' \|\| target\.VITEST\) return 'skipped';/);
  const envTs = read('apps/api/src/lib/env.ts');
  assert.ok(envTs.indexOf('loadApiEnvFile();') > 0 && envTs.indexOf('loadApiEnvFile();') < envTs.indexOf('envSchema.safeParse(process.env)'));
});

test('Nginx : vhost préproduction = production hors marqueurs ; upstreams/ports = profil ; noms globaux préfixés', () => {
  const prod = read('infra/deploy/nginx/digisante.conf');
  const pre = read('infra/deploy/nginx/digisante-preprod.conf');
  const mapped = toProduction(body(pre), [
    [/\bdigisante_preprod_(web|api)\b/g, 'digisante_$1'],
    [/127\.0\.0\.1:3100\b/g, '127.0.0.1:3200'],
    [/127\.0\.0\.1:3101\b/g, '127.0.0.1:3201'],
    [/port local 3100 \(DIGISANTE_ENV=preproduction\)/g, 'port local 3200 (DIGISANTE_ENV=production)'],
    [/port local 3101,/g, 'port local 3201,'],
    [/preprod\.digisantemobile\.app/g, 'digisantemobile.app'],
    [/\/var\/log\/nginx\/digisante-preprod-/g, '/var/log/nginx/digisante-'],
    [/snippets\/digisante-preprod-maintenance\[\.\]conf/g, 'snippets/digisante-maintenance[.]conf'],
  ]);
  // Production seulement : bloc www (redirection vers le nom canonique) et nom www sur :80.
  const prodCore = body(prod)
    .replace(/# >>> www \(production seulement\)[\s\S]*?# <<< www\n\n/, '')
    .replace('server_name digisantemobile.app www.digisantemobile.app;', 'server_name digisantemobile.app;');
  assert.equal(mapped, prodCore, 'digisante-preprod.conf a dérivé de digisante.conf');
  assert.match(prod, /server_name www\.digisantemobile\.app;[\s\S]*?return 301 https:\/\/digisantemobile\.app\$request_uri;/, 'www redirigé vers le nom canonique');
  for (const [env, text] of [['production', prod], ['preproduction', pre]]) {
    const p = profile(env).values;
    const upstreams = Object.fromEntries([...text.matchAll(/upstream (\w+) \{\s*\n\s*server 127\.0\.0\.1:(\d+);/g)].map((m) => [m[1], m[2]]));
    const sfx = env === 'production' ? '' : 'preprod_';
    assert.deepEqual(upstreams, { [`digisante_${sfx}web`]: p.WEB_PORT, [`digisante_${sfx}api`]: p.API_PORT }, `${env} : upstreams`);
    assert.ok(text.includes(`access_log ${p.WS_LOG} digisante_noquery;`), `${env} : journal WS = WS_LOG du profil (verify_deploy)`);
    // Domaine et journal général propres à l'environnement (la normalisation ci-dessus
    // les masque : un vhost préprod déclarant le domaine de production passerait sinon).
    const names = env === 'production'
      ? ['digisantemobile.app www.digisantemobile.app', 'www.digisantemobile.app', 'digisantemobile.app']
      : ['preprod.digisantemobile.app', 'preprod.digisantemobile.app'];
    assert.deepEqual([...text.matchAll(/^\s*server_name ([^;]+);/gm)].map((m) => m[1]), names, `${env} : server_name`);
    // TLS : certificat de l'environnement, HTTP limité au challenge ACME et à la redirection.
    const cert = env === 'production' ? 'digisantemobile.app' : 'preprod.digisantemobile.app';
    assert.ok(text.includes(`ssl_certificate     /etc/letsencrypt/live/${cert}/fullchain.pem;`), `${env} : certificat`);
    assert.match(text, /location \^~ \/\.well-known\/acme-challenge\/ \{\s*\n\s*root \/var\/www\/digisante-acme;/, `${env} : ACME webroot`);
    assert.doesNotMatch(text, /(127\.0\.0\.1|localhost):300[01]\b/, `${env} : port réservé de l'hôte`);
    // Corps max = plus grand bodyLimit de l'API (8 Mio, KYC/DMP).
    assert.match(text, /^\s+client_max_body_size 8m;$/m, `${env} : client_max_body_size`);
    for (const probe of ['/api/v1/health', '/api/v1/ready']) assert.match(text, new RegExp(`location = ${probe.replace(/\//g, '\\/')} \\{\\s*\\n\\s*access_log off;`), `${env} : ${probe} sans journal`);
    // Toute location qui pose add_header ré-inclut les en-têtes de sécurité (héritage Nginx).
    for (const block of text.split(/\n    location /).slice(1)) {
      if (/add_header/.test(block.split('\n    }')[0])) {
        assert.match(block, /include \/etc\/nginx\/snippets\/digisante-headers\.conf;/, `${env} : en-têtes perdus dans ${block.split('\n')[0]}`);
        assert.match(block, /include \/etc\/nginx\/snippets\/digisante-hsts\.conf;/, `${env} : HSTS perdu dans ${block.split('\n')[0]}`);
      }
    }
    // Bloc HTTPS principal : en-têtes + HSTS L8 hérités, HSTS de l'API masqué (le navigateur ne
    // retient que le premier), maintenance facultative propre à l'environnement.
    const main = text.split(/\nserver \{\n/).find((b) => b.includes(`server_name ${cert};`) && /listen 443 ssl;/.test(b));
    assert.ok(main, `${env} : bloc HTTPS principal`);
    for (const directive of ['include /etc/nginx/snippets/digisante-headers.conf;', 'include /etc/nginx/snippets/digisante-hsts.conf;', 'proxy_hide_header Strict-Transport-Security;', `include /etc/nginx/snippets/digisante${logSfx0(env)}-maintenance[.]conf;`]) {
      assert.match(main, new RegExp(`^    ${directive.replace(/[.[\]/]/g, '\\$&')}$`, 'm'), `${env} : ${directive}`);
    }
    // Limitation de débit : authentification (zone stricte) et API ; WebSocket sans limite de corps.
    assert.match(text, /location \/api\/v1\/auth\/ \{[^}]*limit_req zone=digisante_rl_auth burst=5 nodelay;/, `${env} : limite auth`);
    assert.match(text, /location \/api\/ \{[^}]*limit_req zone=digisante_rl_api burst=20 nodelay;/, `${env} : limite API`);
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
  // HSTS L8 : 24 h, ni includeSubDomains ni preload sans qualification.
  const hsts = read('infra/deploy/nginx/hsts-after-tls.conf').split('\n').filter((l) => !/^\s*#/.test(l) && l.trim()).join('\n');
  assert.equal(hsts, 'add_header Strict-Transport-Security "max-age=86400" always;');
  const headers = read('infra/deploy/nginx/digisante-headers.conf').split('\n').filter((l) => !/^\s*#/.test(l) && l.trim());
  assert.deepEqual(headers, ['add_header X-Frame-Options "DENY" always;', 'add_header X-Content-Type-Options "nosniff" always;', 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;']);
  assert.match(prod, /server_name www\.digisantemobile\.app;[^}]*include \/etc\/nginx\/snippets\/digisante-hsts\.conf;/, 'www : HSTS');
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
  const mappedPre = jobs(pre).map((l) => strip(l).replaceAll('/usr/local/lib/digisante-preprod/', '/usr/local/lib/digisante/').replaceAll('/var/log/digisante-preprod-cron/', '/var/log/digisante-cron/').replaceAll('--cert-name preprod.digisantemobile.app', '--cert-name digisantemobile.app'));
  // Hôte partagé : certbot ne renouvelle QUE le certificat DigiSanté de l'environnement.
  for (const [text, cert] of [[prod, 'digisantemobile.app'], [pre, 'preprod.digisantemobile.app']]) {
    for (const line of jobs(text).filter((l) => /certbot/.test(l))) assert.ok(line.includes(`certbot renew --quiet --cert-name ${cert} `), line);
  }
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

/** Clés NON commentées d'un modèle .env (ordre conservé) et leurs valeurs brutes. */
const envKeys = (text) => [...text.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((m) => [m[1], m[2]]);

test('.env.preprod.example / .env.prod.example : mêmes clés que .env.example, secrets vides, valeurs = profil et provision-ionos.sh', () => {
  const base = envKeys(read('.env.example')).map(([k]) => k);
  const prov = read('infra/deploy/scripts/provision-ionos.sh');
  // Variables dont la valeur DOIT rester vide dans un modèle commité (env.ts refuse alors de démarrer).
  const SECRET = /SECRET|PASSWORD|TOKEN|_KEY$|PRIVATE|AUTH|SID$|DATABASE_URL|REDIS_URL/;
  for (const [file, env, domain, idx] of [['.env.preprod.example', 'preproduction', 'preprod.digisantemobile.app', 5], ['.env.prod.example', 'production', 'digisantemobile.app', 6]]) {
    const text = read(file);
    const entries = envKeys(text);
    const values = Object.fromEntries(entries);
    assert.deepEqual(entries.map(([k]) => k), base, `${file} : clés ≠ .env.example (parité)`);
    for (const [k, v] of entries) if (SECRET.test(k)) assert.equal(v, '""', `${file} : ${k} doit rester vide (coffre)`);
    // Aucun motif de secret réel nulle part, même en commentaire.
    assert.doesNotMatch(text, /sk_(live|sandbox)_[A-Za-z0-9]|-----BEGIN|AC[0-9a-f]{32}|re_[A-Za-z0-9]{16}/, file);
    const p = profile(env).values;
    assert.equal(values.NODE_ENV, 'production', file);
    assert.equal(values.API_PORT, p.API_PORT, file);
    assert.equal(values.API_HOST, '127.0.0.1', file);
    assert.equal(values.CORS_ORIGIN, `"https://${domain}"`, file);
    assert.equal(values.NEXT_PUBLIC_API_URL, '""', `${file} : même origine`);
    const site = env === 'production' ? 'digisante' : 'digisante-preprod';
    assert.equal(values.KYC_STORAGE_DIR, `"/var/lib/${site}-files"`, `${file} : magasin absolu = STORE_DIR de provision-ionos.sh`);
    assert.match(prov, /^STORE_DIR="\/var\/lib\/\$\{SITE\}-files"$/m);
    assert.match(prov, new RegExp(`^\\s+${env}\\) DOMAINS="${domain.replace(/\./g, '\\.')}[^"]*"; VALKEY_DB=${idx}; SITE=${site} ;;$`, 'm'));
    // Formes documentées : base dédiée, index Valkey de l'environnement, jamais 3000/3001.
    assert.match(text, new RegExp(`@127\\.0\\.0\\.1:5432/${p.DB_NAME}\\?schema=public`), file);
    assert.match(text, new RegExp(`@127\\.0\\.0\\.1:6379/${idx}\\b`), file);
    assert.doesNotMatch(text, /:300[01]\b/, file);
  }
  // Noms GitHub exacts (préprod PREPROD_VPS_*, production VPS_* lus par ci.yml) et métadonnées smoke.
  const pre = read('.env.preprod.example');
  for (const k of ['PREPROD_VPS_HOST', 'PREPROD_VPS_USER=digisante-preprod', 'PREPROD_VPS_SSH_KEY', 'PREPROD_VPS_FINGERPRINT', 'SMOKE_ENVIRONMENT=preproduction', 'SMOKE_DATABASE_NAME=digisante_preprod', 'SMOKE_REDIS_DB=5']) {
    assert.match(pre, new RegExp(`^#\\s+${k}\\b`, 'm'), k);
  }
  const ci = read('.github/workflows/ci.yml');
  for (const k of ['VPS_HOST', 'VPS_USER', 'VPS_SSH_KEY', 'VPS_FINGERPRINT']) {
    assert.match(read('.env.prod.example'), new RegExp(`^#\\s+${k}\\b`, 'm'), k);
    assert.match(ci, new RegExp(`secrets\\.${k}\\b`), `ci.yml ne lit plus ${k}`);
  }
  assert.match(read('.github/workflows/preproduction.yml'), /secrets\.PREPROD_VPS_FINGERPRINT/);
  assert.match(read('.gitignore'), /^!\.env\.preprod\.example$/m);
  assert.match(read('.gitignore'), /^!\.env\.prod\.example$/m);
});
