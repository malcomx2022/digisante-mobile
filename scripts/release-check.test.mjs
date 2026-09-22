// Tests de `pnpm release:check` (node:test, sans dépendance, sans I/O réseau).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FORBIDDEN, STEPS, buildPlan, checkEnv, parseArgs } from './release-check.mjs';

test("aucune étape ne déploie, ne se connecte en SSH, ne migre en écriture ni ne seed", () => {
  for (const s of STEPS) {
    const line = s.cmd.join(' ');
    for (const re of FORBIDDEN) assert.doesNotMatch(line, re, `étape ${s.id} : ${line}`);
  }
});

test('ordre : i18n → lint → typecheck → migrations → tests → build (build en dernier)', () => {
  const ids = STEPS.map((s) => s.id);
  assert.ok(ids.indexOf('lint') < ids.indexOf('typecheck'));
  assert.ok(ids.indexOf('typecheck') < ids.indexOf('migrations-status'));
  assert.ok(ids.indexOf('migrations-drift') < ids.indexOf('test'));
  assert.equal(ids.at(-1), 'build');
  assert.equal(ids[0], 'i18n');
});

test('mêmes commandes que la CI pour lint/typecheck/test/build', () => {
  const byId = Object.fromEntries(STEPS.map((s) => [s.id, s.cmd.join(' ')]));
  assert.equal(byId.lint, 'pnpm lint');
  assert.equal(byId.typecheck, 'pnpm typecheck');
  assert.equal(byId.test, 'pnpm test');
  assert.equal(byId.build, 'pnpm build');
});

test('i18n : EN complet toujours exigé ; critiques FON/YOR seulement avec --strict-i18n', () => {
  const normal = buildPlan(parseArgs([])).find((s) => s.id === 'i18n');
  assert.ok(normal.cmd.includes('--require-complete=en'));
  assert.ok(!normal.cmd.includes('--critical-only-strict'));
  const strict = buildPlan(parseArgs(['--strict-i18n'])).find((s) => s.id === 'i18n');
  assert.ok(strict.cmd.includes('--critical-only-strict'));
});

test('--skip retire les étapes demandées, et elles seules', () => {
  const plan = buildPlan(parseArgs(['--skip=build,lint']));
  assert.equal(plan.length, STEPS.length - 2);
  assert.ok(!plan.some((s) => s.id === 'build' || s.id === 'lint'));
});

test('prérequis : production refusée, URLs requises, Redis 0 refusé (purgé par les tests)', () => {
  assert.equal(checkEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x@h:5434/d', REDIS_URL: 'redis://h:6380/1' }).length, 0);
  assert.match(checkEnv({ NODE_ENV: 'production', DATABASE_URL: 'x', REDIS_URL: 'redis://h/1' }).join(), /production/);
  assert.equal(checkEnv({}).length, 2);
  assert.match(checkEnv({ DATABASE_URL: 'x', REDIS_URL: 'redis://h:6380' }).join(), /base Redis 0/);
  assert.match(checkEnv({ DATABASE_URL: 'x', REDIS_URL: 'redis://h:6380/0' }).join(), /base Redis 0/);
});
