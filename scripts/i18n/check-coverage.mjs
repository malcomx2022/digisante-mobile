#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Couverture i18n — compare chaque locale à FR (source de vérité) et liste les
// clés manquantes. Marque les clés CRITIQUES (sos./labo./payments.) qui exigent
// une DOUBLE VALIDATION (CLAUDE.md §6).
//
//   node scripts/i18n/check-coverage.mjs            → rapport
//   node scripts/i18n/check-coverage.mjs --export   → + écrit docs/i18n/todo.<locale>.csv
//   node scripts/i18n/check-coverage.mjs --strict   → exit 1 s'il manque des clés (CI)
//
// Sans dépendance : le fichier messages.ts contient des littéraux d'objet plats
// (clés + valeurs quotées), évalués ici dans un contexte isolé.
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MESSAGES = resolve(ROOT, 'apps/web/src/i18n/messages.ts');
const OUT_DIR = resolve(ROOT, 'docs/i18n');

const LOCALES = ['fr', 'en', 'fon', 'yor'];
const CRITICAL_PREFIXES = ['sos.', 'labo.', 'payments.'];

const isCritical = (key) => CRITICAL_PREFIXES.some((p) => key.startsWith(p));

/** Extrait l'objet d'une locale depuis le source TS (littéral plat évalué). */
function extractLocale(source, name) {
  const re = new RegExp(`const ${name}: Messages = (\\{[\\s\\S]*?\\n\\});`);
  const match = source.match(re);
  if (!match) throw new Error(`Bloc introuvable : ${name}`);
  // Littéral d'objet JS valide (clés/valeurs quotées, virgules finales, commentaires).
  // eslint-disable-next-line no-new-func
  return new Function(`return ${match[1]}`)();
}

function csvField(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function main() {
  const args = process.argv.slice(2);
  const doExport = args.includes('--export');
  const strict = args.includes('--strict');

  const source = readFileSync(MESSAGES, 'utf8');
  const data = Object.fromEntries(LOCALES.map((l) => [l, extractLocale(source, l)]));

  const frKeys = Object.keys(data.fr);
  const criticalCount = frKeys.filter(isCritical).length;

  console.log(`\ni18n — référence FR : ${frKeys.length} clés (dont ${criticalCount} critiques sos./labo./payments.)\n`);
  console.log('Locale   Traduites  Manquantes  dont critiques  Couverture');
  console.log('───────  ─────────  ──────────  ──────────────  ─────────');

  let totalMissing = 0;
  const exports = {};

  for (const locale of LOCALES) {
    if (locale === 'fr') continue;
    const have = data[locale];
    const missing = frKeys.filter((k) => !(k in have));
    const missingCritical = missing.filter(isCritical);
    totalMissing += missing.length;
    const coverage = (((frKeys.length - missing.length) / frKeys.length) * 100).toFixed(0);
    console.log(
      `${locale.padEnd(7)}  ${String(frKeys.length - missing.length).padStart(9)}  ${String(missing.length).padStart(10)}  ${String(missingCritical.length).padStart(14)}  ${coverage.padStart(7)}%`,
    );
    exports[locale] = missing;
  }

  if (doExport) {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const [locale, missing] of Object.entries(exports)) {
      const rows = [['key', 'critical', 'fr', 'en', locale].map(csvField).join(',')];
      for (const key of missing) {
        rows.push(
          [key, isCritical(key) ? 'CRITIQUE' : '', data.fr[key], data.en[key] ?? '', ''].map(csvField).join(','),
        );
      }
      const path = resolve(OUT_DIR, `todo.${locale}.csv`);
      writeFileSync(path, rows.join('\n') + '\n', 'utf8');
      console.log(`  → ${path} (${missing.length} clés)`);
    }
  }

  console.log('');
  if (strict && totalMissing > 0) {
    console.error(`❌ ${totalMissing} clés non traduites (mode strict).`);
    process.exit(1);
  }
}

main();
