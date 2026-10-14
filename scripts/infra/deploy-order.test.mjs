import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// Permet de rejouer les régressions sur une copie du script antérieur sans modifier
// le checkout partagé avec les autres agents. Aucun appel réseau ni service réel.
const SCRIPT = process.env.DEPLOY_TEST_SCRIPT ?? join(ROOT, 'infra/deploy/scripts/deploy.sh');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'digisante-deploy-order-'));
  const seed = join(dir, 'seed');
  const origin = join(dir, 'origin.git');
  const app = join(dir, 'app');
  const log = join(dir, 'log');
  const bin = join(dir, 'bin');
  const trace = join(dir, 'trace');
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', timeout: 10_000 });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(dir, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  git(dir, 'init', '--quiet', '--initial-branch=main', seed);
  git(seed, 'config', 'user.name', 'Synthetic deploy test');
  git(seed, 'config', 'user.email', 'deploy@example.invalid');
  writeFileSync(join(seed, '.gitignore'), 'apps/api/.env\n');
  git(seed, 'add', '.gitignore');
  git(seed, 'commit', '--quiet', '-m', 'bootstrap');
  const first = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'commit', '--quiet', '--allow-empty', '-m', 'older qualified candidate');
  const older = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'commit', '--quiet', '--allow-empty', '-m', 'newer qualified candidate');
  const newer = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'checkout', '--quiet', '-b', 'side', first);
  git(seed, 'commit', '--quiet', '--allow-empty', '-m', 'divergent candidate later merged');
  const divergent = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'checkout', '--quiet', 'main');
  git(seed, 'merge', '--quiet', '--no-ff', '--no-edit', 'side');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '--quiet', 'origin', 'main');
  git(dir, 'clone', '--quiet', origin, app);
  git(app, 'checkout', '--quiet', '--detach', newer);
  mkdirSync(join(app, 'apps/api'), { recursive: true });
  const apiEnv = join(app, 'apps/api/.env');
  const databaseUrl = 'postgresql://digisante_preprod:synthetic%40%3A%2F%23@127.0.0.1:5432/digisante_preprod?schema=public';
  const redisUrl = 'redis://:synthetic%40%3A%2F%23@127.0.0.1:6379/5';
  const writeEnv = (values = {}) => writeFileSync(apiEnv, Object.entries({ NODE_ENV: 'production', DATABASE_URL: databaseUrl, REDIS_URL: redisUrl, ...values }).map(([key, value]) => `${key}=${value}\n`).join(''));
  writeEnv();
  chmodSync(join(app, 'apps/api/.env'), 0o600);
  mkdirSync(log); mkdirSync(bin); writeFileSync(trace, '');
  for (const [name, body] of Object.entries({
    pnpm: 'printf "pnpm %s\\n" "$*" >> "$TRACE"',
    // deploy.sh : `corepack pnpm …` (version épinglée) ; la simulation délègue au pnpm simulé.
    corepack: '[[ "$1" == pnpm ]] || exit 2; shift; exec pnpm "$@"',
    pm2: 'printf "pm2 %s\\n" "$*" >> "$TRACE"; [[ "$1" != jlist ]] || printf "[]\\n"',
    curl: 'printf "curl %s\\n" "$*" >> "$TRACE"; printf \'{"status":"ready","db":"up","redis":"up"}\\n\'',
  })) {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\nset -eu\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const env = { ...gitEnv, PATH: `${bin}:${process.env.PATH}`, TRACE: trace, APP_DIR: app, LOG_DIR: log,
    DIGISANTE_ENV: 'preproduction', DEPLOY_ENVIRONMENT: 'preproduction', DEPLOY_MAINTENANCE_READY: '1',
    DEPLOY_ALLOW_ROLLBACK: '', ROOT_LIB: join(dir, 'uninstalled-root-scripts') };
  delete env.DATABASE_URL; delete env.REDIS_URL; env.NODE_ENV = 'production';
  return {
    older, newer, divergent, app, log, writeEnv, databaseUrl, redisUrl,
    checkout: (sha) => git(app, 'checkout', '--quiet', '--detach', sha),
    head: () => git(app, 'rev-parse', 'HEAD'),
    run: (sha, extra = {}) => spawnSync('bash', [SCRIPT], { env: { ...env, DEPLOY_REF: sha, ...extra }, encoding: 'utf8', timeout: 10_000 }),
    trace: () => readFileSync(trace, 'utf8'),
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('déploiement : une CI ancienne après une plus récente est refusée avant PM2/checkout/migration', () => {
  const f = fixture();
  try {
    const r = f.run(f.older);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /rollback explicite requis/);
    assert.equal(f.head(), f.newer);
    assert.equal(f.trace(), '');
    assert.equal(existsSync(join(f.log, 'deploy_history.log')), false);
  } finally { f.clean(); }
});

test('déploiement : descendant et même SHA acceptés avec maintenance conservée', () => {
  const f = fixture();
  try {
    f.checkout(f.older);
    for (let i = 0; i < 2; i++) {
      const r = f.run(f.newer);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(f.head(), f.newer);
      assert.match(r.stdout, /maintenance à conserver/);
    }
    assert.match(readFileSync(join(f.log, 'deploy_history.log'), 'utf8'), /status=SUCCESS/);
  } finally { f.clean(); }
});

test('déploiement : retour à un ancêtre exige le drapeau manuel et conserve les gates', () => {
  const f = fixture();
  try {
    const r = f.run(f.older, { DEPLOY_ALLOW_ROLLBACK: '1' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(f.head(), f.older);
    assert.match(r.stdout, /Rollback explicite/);
    assert.match(r.stdout, /aucune migration appliquée n'est annulée/);
    assert.match(r.stdout, /maintenance à conserver/);
    f.checkout(f.newer);
    const blocked = f.run(f.older, { DEPLOY_ALLOW_ROLLBACK: '1', DEPLOY_MAINTENANCE_READY: '0' });
    assert.notEqual(blocked.status, 0);
    assert.equal(f.head(), f.newer);
  } finally { f.clean(); }
});

test('déploiement : branche divergente pourtant sur main refusée même en rollback explicite', () => {
  const f = fixture();
  try {
    for (const rollback of ['', '1']) {
      const r = f.run(f.divergent, { DEPLOY_ALLOW_ROLLBACK: rollback });
      assert.notEqual(r.status, 0, r.stdout + r.stderr);
      assert.equal(f.head(), f.newer);
      assert.equal(f.trace(), '');
    }
  } finally { f.clean(); }
});

test('déploiement : invocation concurrente refusée avant effets sur le checkout', async () => {
  const f = fixture();
  // Un vrai verrou du même environnement : la seconde invocation ne doit pas lire
  // un HEAD susceptible de changer pendant la première.
  const holder = spawn('flock', [join(f.log, 'deploy.lock'), 'bash', '-c', 'printf ready; cat'], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await once(holder.stdout, 'data');
    const r = f.run(f.newer);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /déploiement de cet environnement est déjà en cours/);
    assert.equal(f.head(), f.newer);
    assert.equal(f.trace(), '');
  } finally {
    holder.stdin.end();
    await once(holder, 'close');
    f.clean();
  }
});

test('déploiement : fichier préproduction visant production, mauvais rôle/schéma/hôte/index refusé avant effets', () => {
  const f = fixture();
  try {
    for (const values of [
      { DATABASE_URL: 'postgresql://digisante:synthetic@127.0.0.1:5432/digisante?schema=public' },
      { DATABASE_URL: f.databaseUrl.replace('digisante_preprod:', 'digisante:') },
      { DATABASE_URL: f.databaseUrl.replace('schema=public', 'schema=private') },
      { DATABASE_URL: f.databaseUrl.replace('127.0.0.1', 'db.example.invalid') },
      { DATABASE_URL: `${f.databaseUrl}&host=db.example.invalid` },
      { REDIS_URL: f.redisUrl.replace('/5', '/6') },
      { REDIS_URL: f.redisUrl.replace('/5', '/') },
      { REDIS_URL: f.redisUrl.replace('6379', '6380') },
      { REDIS_URL: f.redisUrl.replace('127.0.0.1', 'redis.example.invalid') },
      { NODE_ENV: 'test' },
    ]) {
      f.writeEnv(values);
      const r = f.run(f.newer);
      assert.notEqual(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stderr, /aucun processus arrêté ni migration lancée/);
      assert.doesNotMatch(r.stderr + r.stdout, /synthetic%40|postgresql:\/\/|redis:\/\//);
      assert.equal(f.trace(), '');
      assert.equal(f.head(), f.newer);
    }
  } finally { f.clean(); }
});

test('déploiement : priorité des variables héritées contrôlée, credentials encodés et IPv6 locale acceptés', () => {
  const f = fixture();
  try {
    for (const override of [
      { DATABASE_URL: f.databaseUrl.replace('digisante_preprod', 'digisante') },
      { REDIS_URL: f.redisUrl.replace('/5', '/6') },
      { NODE_ENV: 'test' },
    ]) {
      const r = f.run(f.newer, override);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /hérité différent/);
      assert.doesNotMatch(r.stderr, /synthetic|postgresql:\/\/|redis:\/\//);
      assert.equal(f.trace(), '');
    }
    f.writeEnv({ DATABASE_URL: f.databaseUrl.replace('127.0.0.1', '[::1]'), REDIS_URL: f.redisUrl.replace('127.0.0.1', 'localhost') });
    const r = f.run(f.newer);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(f.head(), f.newer);
  } finally { f.clean(); }
});

test('workflows : garde au SHA main relevé, candidate applicative qualifiée inchangée, aucun rollback implicite', () => {
  for (const [file, candidate] of [
    ['.github/workflows/ci.yml', "DEPLOY_REF='${{ github.sha }}'"],
    ['.github/workflows/preproduction.yml', 'DEPLOY_REF="$CANDIDATE_SHA"'],
  ]) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const fetch = text.indexOf('git fetch origin main');
    const resolve = text.indexOf('MAIN_SHA="$(git rev-parse --verify \'origin/main^{commit}\')"');
    const extract = text.indexOf('git show "$MAIN_SHA:infra/deploy/scripts/deploy.sh"');
    assert.ok(fetch >= 0 && resolve > fetch && extract > resolve, file);
    assert.ok(text.includes(`DEPLOY_TOOLING_SHA="$MAIN_SHA" ${candidate}`), file);
    assert.doesNotMatch(text, /git show [^\n]*(?:CANDIDATE_SHA|github\.sha)|DEPLOY_ALLOW_ROLLBACK/, file);
  }
  const preproduction = readFileSync(join(ROOT, '.github/workflows/preproduction.yml'), 'utf8');
  assert.ok(preproduction.indexOf('node scripts/preproduction/verify-candidate.mjs') < preproduction.indexOf('git fetch origin main'));
});
