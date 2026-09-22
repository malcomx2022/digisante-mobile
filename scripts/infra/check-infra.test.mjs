// ─────────────────────────────────────────────────────────────
// Contrôles STATIQUES de l'infra de déploiement (infra/deploy) — sans connexion
// distante, sans mutation. Complète la revue humaine du préflight VPS.
// ─────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SCRIPTS = readdirSync(join(ROOT, 'infra/deploy/scripts')).filter((f) => f.endsWith('.sh'));

test('scripts shell : syntaxe valide (bash -n) et mode strict (set -euo pipefail)', () => {
  for (const f of SCRIPTS) {
    const p = join(ROOT, 'infra/deploy/scripts', f);
    const r = spawnSync('bash', ['-n', p], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f} : ${r.stderr}`);
    assert.match(readFileSync(p, 'utf8'), /^set -euo pipefail$/m, `${f} sans set -euo pipefail`);
  }
});

test('aucun chemin temporaire FIXE sous /tmp (attaque par lien symbolique en root)', () => {
  for (const f of SCRIPTS) {
    const code = readFileSync(join(ROOT, 'infra/deploy/scripts', f), 'utf8').replace(/^\s*#.*$/gm, '');
    assert.doesNotMatch(code, /\/tmp\/[\w.-]+/, f);
  }
});

test('crontab : aucun secret en clair, jeton jamais en argument de commande', () => {
  const cron = read('infra/deploy/crontab.example').replace(/^\s*#.*$/gm, '');
  assert.doesNotMatch(cron, /RECONCILE_TOKEN\s*=/);
  assert.doesNotMatch(cron, /x-service-token/i);
  assert.doesNotMatch(cron, /changeme/i);
});

test('crontab : CHAQUE générateur `*/reminders/generate` de l’API est planifié, + dispatch', () => {
  const server = read('apps/api/src/server.ts');
  const prefixes = Object.fromEntries(
    [...server.matchAll(/app\.register\((\w+), \{ prefix: '([^']+)' \}\)/g)].map((m) => [m[1], m[2]]),
  );
  const imports = Object.fromEntries(
    [...server.matchAll(/import (\w+) from '@\/modules\/([\w/.-]+)\.js'/g)].map((m) => [m[1], m[2]]),
  );
  const expected = [];
  for (const [name, mod] of Object.entries(imports)) {
    if (!prefixes[name]) continue;
    const routes = readFileSync(join(ROOT, 'apps/api/src/modules', `${mod}.ts`), 'utf8');
    for (const m of routes.matchAll(/app\.post\('([\w/-]*generate)'/g)) {
      const full = prefixes[name] + m[1];
      if (full.endsWith('reminders/generate')) expected.push(full);
    }
  }
  assert.ok(expected.length >= 4, `générateurs détectés : ${expected.join(', ')}`);
  const cron = read('infra/deploy/crontab.example');
  for (const path of [...expected, '/api/v1/notifications/dispatch']) {
    assert.ok(cron.includes(` ${path} `), `non planifié : ${path}`);
  }
});

test('provision : Node aligné sur la CI, fuseau réglé, mot de passe jamais interpolé dans le SQL', () => {
  const prov = read('infra/deploy/scripts/provision.sh');
  const ci = read('.github/workflows/ci.yml');
  const nodeCi = [...ci.matchAll(/node-version:\s*(\d+)/g)].map((m) => m[1]);
  const nodeProv = prov.match(/NODE_MAJOR="\$\{NODE_MAJOR:-(\d+)\}"/)[1];
  assert.ok(nodeCi.length > 0 && nodeCi.every((v) => v === nodeProv), `CI ${nodeCi} ≠ provision ${nodeProv}`);
  assert.match(prov, /timedatectl set-timezone Africa\/Porto-Novo/);
  assert.doesNotMatch(prov, /PASSWORD '\$\{DB_PASSWORD\}'/);
  assert.match(prov, /\\getenv db_pw DB_PASSWORD/);
});

test('nginx : WS journalisé sans query, zones définies, en-têtes cohérents avec Next', () => {
  const site = read('infra/deploy/nginx/digisante.conf');
  const zones = read('infra/deploy/nginx/rate-limit.conf');
  const ws = site.slice(site.indexOf('location = /api/v1/chat/ws'));
  assert.match(ws.slice(0, ws.indexOf('}')), /access_log \S+ digisante_noquery;/);
  for (const z of new Set([...site.matchAll(/zone=(\w+)/g)].map((m) => m[1]))) {
    assert.match(zones, new RegExp(`zone=${z}:`), `zone ${z} non définie`);
  }
  assert.match(zones, /log_format digisante_noquery/);
  assert.match(site, /add_header X-Frame-Options "DENY"/);
  assert.match(site, /location ~ \^\/api\/v1\/auth\/\(refresh\|logout\)\$ \{\s*\n\s*limit_req zone=api/);
});

test('deploy : migrate deploy (jamais db push), .env requis, healthcheck /ready', () => {
  const d = read('infra/deploy/scripts/deploy.sh');
  assert.match(d, /prisma migrate deploy/);
  assert.doesNotMatch(d, /prisma\s+db\s+push/);
  assert.match(d, /apps\/api\/\.env/);
  assert.match(d, /\/api\/v1\/ready/);
});
