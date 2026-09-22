#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// pnpm release:check — contrôle de release LOCAL et NON DESTRUCTIF.
//
// Enchaîne, dans l'ordre et en s'arrêtant au PREMIER échec :
//   prérequis → i18n → compteurs → lint → typecheck → migrations → tests → build
//   → bundle web sans secret serveur
//
// Garanties (vérifiées par scripts/release-check.test.mjs) :
//   • ne déploie JAMAIS (aucun ssh, pm2, deploy.sh) ;
//   • ne contacte AUCUN fournisseur (FedaPay/Twilio/Daily/Firebase/Resend) :
//     NODE_ENV=test imposé ⇒ les services restent en stub ;
//   • n'écrit rien en base : `prisma migrate status` + `migrate diff` (lecture) —
//     pas de `migrate deploy`. La base de test doit être migrée AU PRÉALABLE ;
//   • refuse de tourner avec NODE_ENV=production.
//
// Ne duplique pas la CI : ce sont les MÊMES commandes pnpm que `ci.yml`
// (lint/typecheck/test/build) ; seule l'orchestration locale est ajoutée.
//
// Options :
//   --dry-run         affiche le plan sans rien exécuter
//   --skip=<a,b>      saute des étapes (ex. --skip=build) — signalé en sortie
//   --strict-i18n     échoue aussi sur les clés CRITIQUES manquantes en FON/YOR
//                     (sinon : simple rapport — dépend des locuteurs natifs, B1).
//                     EN incomplet échoue TOUJOURS (source complète exigée).
// ─────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Étapes, dans l'ordre. `cmd` = argv exécuté sans shell. */
export const STEPS = [
  { id: 'i18n', label: 'i18n — parité des dictionnaires', cmd: ['node', 'scripts/i18n/check-coverage.mjs', '--require-complete=en'] },
  { id: 'metrics', label: 'compteurs documentaires (metrics:check)', cmd: ['node', 'scripts/metrics/count.mjs', '--check'] },
  { id: 'lint', label: 'lint', cmd: ['pnpm', 'lint'] },
  { id: 'typecheck', label: 'typecheck', cmd: ['pnpm', 'typecheck'] },
  { id: 'migrations-validate', label: 'migrations — schéma Prisma valide', cmd: ['pnpm', '--filter', '@digisante/api', 'prisma', 'validate'] },
  { id: 'migrations-status', label: 'migrations — base de test à jour (lecture)', cmd: ['pnpm', '--filter', '@digisante/api', 'prisma', 'migrate', 'status'] },
  {
    id: 'migrations-drift',
    label: 'migrations — aucune dérive schéma ↔ migrations (lecture)',
    cmd: ['pnpm', '--filter', '@digisante/api', 'prisma', 'migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'],
  },
  { id: 'scripts-test', label: 'tests des scripts outillage', cmd: ['node', '--test', 'scripts/**/*.test.mjs'] },
  { id: 'test', label: 'tests (API + web)', cmd: ['pnpm', 'test'] },
  { id: 'build', label: 'build (shared + API + web)', cmd: ['pnpm', 'build'] },
  { id: 'bundle-secrets', label: 'bundle web — aucun secret serveur', cmd: ['node', 'scripts/check-web-bundle-secrets.mjs'] },
];

/** Commandes interdites dans ce script : garde-fou testé. */
export const FORBIDDEN = [/deploy/i, /\bssh\b/, /\bpm2\b/, /migrate\s+(deploy|dev|reset)/, /db\s+push/, /\bseed\b/];

export function parseArgs(argv) {
  const skip = new Set();
  for (const a of argv) if (a.startsWith('--skip=')) a.slice(7).split(',').filter(Boolean).forEach((s) => skip.add(s));
  return { dryRun: argv.includes('--dry-run'), strictI18n: argv.includes('--strict-i18n'), skip };
}

/** Plan effectif (étapes non sautées), avec le drapeau i18n strict. */
export function buildPlan(opts) {
  return STEPS.filter((s) => !opts.skip.has(s.id)).map((s) =>
    s.id === 'i18n' && opts.strictI18n ? { ...s, cmd: [...s.cmd, '--critical-only-strict'] } : s,
  );
}

/** Vérifie les prérequis d'environnement ; renvoie la liste des problèmes. */
export function checkEnv(env) {
  const problems = [];
  if (env.NODE_ENV === 'production') problems.push('NODE_ENV=production refusé : release:check ne tourne que sur une pile de test.');
  if (!env.DATABASE_URL) problems.push('DATABASE_URL absent — base PostgreSQL 16 de TEST migrée requise.');
  if (!env.REDIS_URL) problems.push('REDIS_URL absent — base Redis DÉDIÉE aux tests requise (ex. redis://127.0.0.1:6380/1, elle est purgée).');
  if (env.REDIS_URL) {
    let path = null;
    try { path = new URL(env.REDIS_URL).pathname; } catch { problems.push('REDIS_URL invalide.'); }
    if (path !== null && /^\/?0?$/.test(path)) {
      problems.push('REDIS_URL pointe la base Redis 0 : les tests la PURGENT (FLUSHDB). Utiliser …/1.');
    }
  }
  return problems;
}

function tcpReachable(url, defaultPort) {
  return new Promise((ok) => {
    let u;
    try { u = new URL(url); } catch { return ok(false); }
    const sock = createConnection({ host: u.hostname || '127.0.0.1', port: Number(u.port || defaultPort) });
    const done = (v) => { sock.destroy(); ok(v); };
    sock.setTimeout(2000, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

const PREREQ_HELP = `
Prérequis (pile de TEST, jamais la production) :
  pnpm services:up                         # Docker : PostgreSQL 16 :5434 + Redis :6380
  # ou services natifs équivalents sur ces ports
  export DATABASE_URL="postgresql://digisante:devpassword@127.0.0.1:5434/digisante_test?schema=public"
  export REDIS_URL="redis://127.0.0.1:6380/1"
  pnpm --filter @digisante/api prisma migrate deploy   # une fois, sur la base de TEST
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const plan = buildPlan(opts);
  const env = { ...process.env, NODE_ENV: 'test' };

  console.log('\n▶ release:check — contrôles locaux non destructifs (aucun déploiement, aucun fournisseur)\n');
  if (opts.skip.size) console.log(`⚠️  Étapes SAUTÉES (non contrôlées) : ${[...opts.skip].join(', ')}\n`);

  if (opts.dryRun) {
    plan.forEach((s, i) => console.log(`  ${i + 1}. ${s.label}\n       $ ${s.cmd.join(' ')}`));
    console.log(PREREQ_HELP);
    return;
  }

  const problems = checkEnv(process.env);
  if (!problems.length) {
    if (!(await tcpReachable(process.env.DATABASE_URL, 5432))) problems.push(`PostgreSQL injoignable (${new URL(process.env.DATABASE_URL).host}).`);
    if (!(await tcpReachable(process.env.REDIS_URL, 6379))) problems.push(`Redis injoignable (${new URL(process.env.REDIS_URL).host}).`);
  }
  if (problems.length) {
    console.error('❌ Prérequis non satisfaits :');
    problems.forEach((p) => console.error(`   - ${p}`));
    console.error(PREREQ_HELP);
    process.exit(2);
  }
  console.log('✓ prérequis : PostgreSQL et Redis joignables, NODE_ENV=test\n');

  const started = Date.now();
  for (const [i, step] of plan.entries()) {
    const t0 = Date.now();
    console.log(`── [${i + 1}/${plan.length}] ${step.label}`);
    const r = spawnSync(step.cmd[0], step.cmd.slice(1), { cwd: ROOT, env, stdio: 'inherit' });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.status !== 0) {
      console.error(`\n❌ ÉCHEC à l'étape « ${step.label} » (${secs}s, code ${r.status ?? r.signal}).`);
      if (step.id === 'migrations-status') console.error('   → base de test non migrée ? pnpm --filter @digisante/api prisma migrate deploy');
      process.exit(1);
    }
    console.log(`   ✓ ${secs}s\n`);
  }
  console.log(`✅ release:check vert — ${plan.length} étapes en ${((Date.now() - started) / 1000).toFixed(0)}s.`);
  console.log('   Non couvert ici : e2e (pnpm test:e2e, build dédié), VPS, fournisseurs réels, validations humaines.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
