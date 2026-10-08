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
export const MESSAGES = resolve(ROOT, 'apps/web/src/i18n/messages.ts');
const OUT_DIR = resolve(ROOT, 'docs/i18n');

const LOCALES = ['fr', 'en', 'fon', 'yor'];
// SEULE définition des namespaces critiques du projet depuis le lot 11 (août 2026) :
// la constante `CRITICAL_NAMESPACES` de @digisante/shared a été supprimée avec le module
// API `translations` qui était son unique consommateur. Une erreur de traduction y est
// potentiellement dangereuse (urgence, résultats, argent) → double validation, CLAUDE.md §6.
// Ne pas dupliquer cette liste ailleurs : deux définitions finissent par diverger.
export const CRITICAL_PREFIXES = ['sos.', 'labo.', 'payments.'];

export const isCritical = (key) => CRITICAL_PREFIXES.some((p) => key.startsWith(p));

/** Une clé vide/non textuelle n'est pas une traduction ; variables et balises conservées. */
export function localeIssues(fr, translated) {
  const variables = (text) => [...text.matchAll(/\{[\w.]+\}|<\/?[a-z][^>]*>/gi)].map((m) => m[0]).sort().join('|');
  const missing = Object.keys(fr).filter((key) => !Object.hasOwn(translated, key) || typeof translated[key] !== 'string' || !translated[key].trim());
  const invalid = Object.keys(fr).filter((key) => !missing.includes(key) && (translated[key].includes('\uFFFD') || variables(fr[key]) !== variables(translated[key])));
  const unknown = Object.keys(translated).filter((key) => !Object.hasOwn(fr, key));
  return { missing, invalid, unknown };
}

/** Extrait l'objet d'une locale depuis le source TS (littéral plat évalué). */
export function extractLocale(source, name) {
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
  // --require-complete=en[,…] : échec si ces langues ont une clé manquante (release:check).
  const requireComplete = (args.find((a) => a.startsWith('--require-complete=')) ?? '=')
    .split('=')[1].split(',').filter(Boolean);
  // --critical-only-strict : échec si une clé CRITIQUE (sos./labo./payments.) manque.
  const criticalStrict = args.includes('--critical-only-strict');
  if (requireComplete.some((locale) => !LOCALES.includes(locale))) throw new Error('Langue inconnue dans --require-complete');
  const failures = [];

  const source = readFileSync(MESSAGES, 'utf8');
  const data = Object.fromEntries(LOCALES.map((l) => [l, extractLocale(source, l)]));

  if (Object.values(data.fr).some((text) => typeof text !== 'string' || !text.trim())) throw new Error('Référence FR vide ou non textuelle');
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
    const { missing, invalid, unknown } = localeIssues(data.fr, have);
    const missingCritical = missing.filter(isCritical);
    totalMissing += missing.length;
    const coverage = (((frKeys.length - missing.length) / frKeys.length) * 100).toFixed(0);
    console.log(
      `${locale.padEnd(7)}  ${String(frKeys.length - missing.length).padStart(9)}  ${String(missing.length).padStart(10)}  ${String(missingCritical.length).padStart(14)}  ${coverage.padStart(7)}%`,
    );
    exports[locale] = missing;
    if (invalid.length || unknown.length) console.log(`  ${locale} : ${invalid.length} textes invalides, ${unknown.length} clés hors référence`);
    if ((strict || requireComplete.includes(locale)) && (invalid.length || unknown.length)) failures.push(`${locale} : textes invalides/clés hors référence — ${[...invalid, ...unknown].join(', ')}`);
    if (criticalStrict && invalid.some(isCritical)) failures.push(`${locale} : texte critique invalide`);
    if (requireComplete.includes(locale) && missing.length > 0) {
      failures.push(`${locale} : ${missing.length} clé(s) manquante(s) — langue exigée complète`);
    }
    if (criticalStrict && missingCritical.length > 0) {
      failures.push(`${locale} : ${missingCritical.length} clé(s) CRITIQUE(S) manquante(s) — ${missingCritical.join(', ')}`);
    }
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
  if (failures.length) {
    failures.forEach((f) => console.error(`❌ ${f}`));
    process.exit(1);
  }
  if (strict && totalMissing > 0) {
    console.error(`❌ ${totalMissing} clés non traduites (mode strict).`);
    process.exit(1);
  }
}

// Exécuté en CLI seulement : le module est aussi importé (import-validated.mjs).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
