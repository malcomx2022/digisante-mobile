#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Compteurs du dépôt — mesure DÉTERMINISTE (statique, sans réseau, sans base).
//
//   node scripts/metrics/count.mjs            → affiche les mesures (JSON)
//   node scripts/metrics/count.mjs --check    → compare à docs/metrics.json ET aux
//                                              documents actifs ; exit 1 si dérive
//   node scripts/metrics/count.mjs --write    → réécrit docs/metrics.json (source unique)
//
// RÈGLES DE COMPTAGE (fixées ici pour éviter les faux positifs) :
//   • rest       : appels `app.get|post|put|patch|delete(` (ou `<Generic>(`) dans les
//                  fichiers NON-test de apps/api/src, SAUF ceux déclarant
//                  `websocket: true` dans leurs options. Commentaires ignorés.
//   • websocket  : les mêmes déclarations AVEC `websocket: true`.
//   • modules    : sous-dossiers de apps/api/src/modules (les fichiers isolés,
//                  ex. journeys.test.ts, ne sont pas des modules).
//   • pages      : fichiers `page.tsx` sous apps/web/src/app (patientPages : sous /patient).
//   • models / enums : blocs `model X {` / `enum X {` de schema.prisma.
//   • migrations : dossiers de apps/api/prisma/migrations.
//   • tests      : fichiers `*.test.ts` (API, web) / `*.spec.ts` (e2e) — hors
//                  `*.smoke.test.ts` (fournisseurs réels, opt-in, comptés à part) ; cas = appels
//                  `it(`/`test(` en début de ligne (aucun test paramétré dans le dépôt :
//                  ce compte statique égale le compte d'exécution — 325/37/8 vérifié
//                  le 22/09/2026 ; un `it.each` futur serait compté UNE fois).
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SOURCE = 'docs/metrics.json';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Retire les commentaires `//` et `/* *\/` (suffisant pour du code de routes). */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const ROUTE_RE = /\bapp\.(get|post|put|patch|delete)\s*(<[^>]*>)?\s*\(/g;

/** Compte les déclarations de routes d'un source : { rest, websocket }. */
export function countRoutes(src) {
  const code = stripComments(src);
  let rest = 0;
  let websocket = 0;
  for (const m of code.matchAll(ROUTE_RE)) {
    // Options de route : on regarde jusqu'au handler (fenêtre bornée).
    const window = code.slice(m.index, m.index + 300);
    if (/websocket\s*:\s*true/.test(window.split(/=>|function\s*\(/)[0])) websocket++;
    else rest++;
  }
  return { rest, websocket };
}

/** Compte les cas de test déclarés dans un source. */
export function countCases(src) {
  return (stripComments(src).match(/^\s*(it|test)(\.only)?\s*\(/gm) ?? []).length;
}

export function measure(root = ROOT) {
  const api = join(root, 'apps/api/src');
  const apiFiles = walk(api).filter((f) => f.endsWith('.ts'));
  // Smoke tests fournisseurs (appels réels, opt-in) : hors `pnpm test`, comptés à part.
  const apiSmoke = apiFiles.filter((f) => f.endsWith('.smoke.test.ts'));
  const apiTests = apiFiles.filter((f) => f.endsWith('.test.ts') && !f.endsWith('.smoke.test.ts'));
  let rest = 0;
  let websocket = 0;
  for (const f of apiFiles.filter((f) => !f.endsWith('.test.ts'))) {
    const c = countRoutes(readFileSync(f, 'utf8'));
    rest += c.rest;
    websocket += c.websocket;
  }
  const modulesDir = join(api, 'modules');
  const modules = readdirSync(modulesDir).filter((n) => statSync(join(modulesDir, n)).isDirectory()).length;

  const appDir = join(root, 'apps/web/src/app');
  const pageFiles = walk(appDir).filter((f) => f.endsWith('/page.tsx'));
  const patientPages = pageFiles.filter((f) => relative(appDir, f).startsWith('patient/')).length;

  const webTests = walk(join(root, 'apps/web/src')).filter((f) => f.endsWith('.test.ts'));
  const e2eSpecs = walk(join(root, 'e2e')).filter((f) => f.endsWith('.spec.ts'));
  const cases = (files) => files.reduce((n, f) => n + countCases(readFileSync(f, 'utf8')), 0);

  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  const migDir = join(root, 'apps/api/prisma/migrations');
  const migrations = readdirSync(migDir).filter((n) => statSync(join(migDir, n)).isDirectory()).length;

  const apiCases = cases(apiTests);
  const webCases = cases(webTests);
  return {
    rest,
    websocket,
    modules,
    pages: pageFiles.length,
    patientPages,
    models: (schema.match(/^model\s+\w+\s*\{/gm) ?? []).length,
    enums: (schema.match(/^enum\s+\w+\s*\{/gm) ?? []).length,
    migrations,
    apiTestFiles: apiTests.length,
    webTestFiles: webTests.length,
    e2eSpecFiles: e2eSpecs.length,
    smokeTestFiles: apiSmoke.length,
    apiTests: apiCases,
    webTests: webCases,
    e2eTests: cases(e2eSpecs),
    unitTests: apiCases + webCases,
  };
}

/**
 * Mentions publiées dans les documents ACTIFS (les archives datées ne sont pas
 * contrôlées : elles décrivent l'état à leur date). Chaque motif capture UNE valeur.
 */
export const DOC_CHECKS = [
  { file: 'CLAUDE.md', metric: 'rest', re: /\*\*(\d+) endpoints REST \+ 1 canal WebSocket\*\*/ },
  { file: 'CLAUDE.md', metric: 'modules', re: /\*\*(\d+) modules\*\* \+ 5 intégrations/ },
  { file: 'CLAUDE.md', metric: 'pages', re: /\*\*(\d+) pages frontend\*\*/ },
  { file: 'CLAUDE.md', metric: 'patientPages', re: /pages frontend\*\* \(dont (\d+) espace patient\)/ },
  { file: 'CLAUDE.md', metric: 'models', re: /\*\*(\d+) modèles Prisma\*\*/ },
  { file: 'CLAUDE.md', metric: 'enums', re: /modèles Prisma\*\*, (\d+) enums/ },
  { file: 'CLAUDE.md', metric: 'migrations', re: /enums, (\d+) migrations/ },
  { file: 'CLAUDE.md', metric: 'unitTests', re: /\*\*(\d+) tests\*\* \(\d+ API/ },
  { file: 'CLAUDE.md', metric: 'apiTests', re: /tests\*\* \((\d+) API \+/ },
  { file: 'CLAUDE.md', metric: 'webTests', re: /API \+ (\d+) web\) \+/ },
  { file: 'CLAUDE.md', metric: 'e2eTests', re: /web\) \+ (\d+) e2e/ },
  { file: 'README.md', metric: 'pages', re: /PWA\) — (\d+) pages/ },
  { file: 'README.md', metric: 'rest', re: /Fastify — (\d+) endpoints REST/ },
  { file: 'README.md', metric: 'modules', re: /WebSocket \/ (\d+) modules/ },
  { file: 'README.md', metric: 'models', re: /schéma Prisma \((\d+) modèles/ },
  { file: 'README.md', metric: 'enums', re: /modèles, (\d+) enums\)/ },
  { file: 'SETUP_GIT.md', metric: 'models', re: /par tes (\d+) modèles/ },
  { file: 'SETUP_GIT.md', metric: 'enums', re: /modèles \/ (\d+) enums/ },
  { file: 'apps/api/prisma/schema.prisma', metric: 'models', re: /^\/\/ (\d+) modèles \+/m },
  { file: 'apps/api/prisma/schema.prisma', metric: 'enums', re: /^\/\/ \d+ modèles \+ (\d+) enums/m },
  { file: 'docs/DEPLOIEMENT_Checklist.md', metric: 'modules', re: /backend \*\*(\d+) modules\*\*/ },
  { file: 'docs/DEPLOIEMENT_Checklist.md', metric: 'rest', re: /\*\*(\d+) endpoints REST \+ 1 WS\*\*/ },
  { file: 'docs/DEPLOIEMENT_Checklist.md', metric: 'pages', re: /\*\*(\d+) pages\*\*/ },
  { file: 'docs/DEPLOIEMENT_Checklist.md', metric: 'unitTests', re: /\*\*(\d+) tests verts\*\*/ },
  { file: 'docs/DEPLOIEMENT_Checklist.md', metric: 'apiTests', re: /tests verts\*\* — (\d+) API/ },
  { file: 'docs/DEPLOIEMENT_Checklist.md', metric: 'webTests', re: /API \+ (\d+) web/ },
  { file: 'docs/PLAYBOOK_Codage_DigiSante.md', metric: 'rest', re: /\((\d+) endpoints REST \+ 1 WebSocket/ },
  { file: 'docs/PLAYBOOK_Codage_DigiSante.md', metric: 'modules', re: /1 WebSocket \/ (\d+) modules/ },
  { file: 'docs/PLAYBOOK_Codage_DigiSante.md', metric: 'models', re: /modules, (\d+) modèles Prisma/ },
  { file: 'docs/PLAYBOOK_Codage_DigiSante.md', metric: 'pages', re: /modèles Prisma, (\d+) pages/ },
];

/** Renvoie la liste des dérives (vide = OK). */
export function check(measured, published, docs = DOC_CHECKS, read = (f) => readFileSync(join(ROOT, f), 'utf8')) {
  const drifts = [];
  if (measured.websocket !== 1) drifts.push(`websocket : ${measured.websocket} mesuré(s), la documentation annonce 1 canal`);
  for (const [k, v] of Object.entries(measured)) {
    if (published[k] !== v) drifts.push(`${SOURCE} → ${k} : publié ${published[k] ?? '∅'}, mesuré ${v}`);
  }
  for (const { file, metric, re } of docs) {
    const m = read(file).match(re);
    if (!m) drifts.push(`${file} → motif introuvable pour « ${metric} » (${re})`);
    else if (Number(m[1]) !== measured[metric]) drifts.push(`${file} → ${metric} : écrit ${m[1]}, mesuré ${measured[metric]}`);
  }
  return drifts;
}

function main() {
  const args = process.argv.slice(2);
  const measured = measure();
  if (args.includes('--write')) {
    writeFileSync(join(ROOT, SOURCE), JSON.stringify(measured, null, 2) + '\n');
    console.log(`→ ${SOURCE} mis à jour`);
  }
  if (!args.includes('--check')) {
    console.log(JSON.stringify(measured, null, 2));
    return;
  }
  const published = JSON.parse(readFileSync(join(ROOT, SOURCE), 'utf8'));
  const drifts = check(measured, published);
  if (drifts.length) {
    console.error('❌ Dérive des compteurs :');
    drifts.forEach((d) => console.error(`   - ${d}`));
    console.error(`\nMesurer : node scripts/metrics/count.mjs · corriger les documents · puis --write pour ${SOURCE}.`);
    process.exit(1);
  }
  console.log(`✓ metrics:check — ${Object.keys(measured).length} compteurs conformes à ${SOURCE} et ${DOC_CHECKS.length} mentions documentaires.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
