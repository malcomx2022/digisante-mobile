#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Intègre des traductions FON / YOR VALIDÉES PAR DES LOCUTEURS NATIFS (chantier B1)
// depuis le CSV renvoyé par le relecteur (format de `pnpm i18n:export` : key,critical,fr,en,<locale>).
//
//   node scripts/i18n/import-validated.mjs --locale fon --csv retour.fon.csv \
//        --reviewer "Nom Prénom" --date 2026-10-01 \
//        [--second-reviewer "Nom 2" --second-date 2026-10-03] [--dry-run]
//
// Garde-fous (CLAUDE.md §6) :
//   • clé CRITIQUE (sos./labo./payments.) refusée sans DOUBLE validation tracée
//     (--second-reviewer + --second-date, distinct du premier relecteur) ;
//   • clé inconnue en FR, colonnes key/fr modifiées, case vide, texte identique au FR
//     (probablement non traduit) → ligne ignorée et signalée ;
//   • variables `{x}` et balises `<b>` doivent être EXACTEMENT celles du FR ;
//   • encodage : caractère de remplacement U+FFFD (CSV mal encodé) → refus ;
//   • une traduction existante n'est jamais écrasée (--overwrite pour le faire) ;
//   • AUCUNE traduction n'est inventée : seules les cellules remplies sont intégrées.
// Écrit dans messages.ts (bloc de la locale) + une ligne de traçabilité
// (docs/i18n/TRACABILITE_Relectures.md : date, relecteur(s), nombre de clés — pas de contenu).
// ─────────────────────────────────────────────────────────────
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MESSAGES, extractLocale, isCritical } from './check-coverage.mjs';

const TRACE = resolve(fileURLToPath(new URL('../../docs/i18n/TRACABILITE_Relectures.md', import.meta.url)));

/** Parse CSV RFC 4180 (guillemets doublés, retours ligne dans les champs). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const tokens = (s, re) => [...String(s).matchAll(re)].map((m) => m[0]).sort().join('|');
const VARS = /\{[\w.]+\}/g;
const TAGS = /<\/?[a-z][^>]*>/gi;

/** Décide pour chaque ligne : accepter ou refuser (avec raison). Fonction PURE. */
export function plan({ rows, locale, fr, existing, doubleValidated, overwrite = false }) {
  const [header, ...data] = rows;
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const col of ['key', 'fr', locale]) if (!(col in idx)) throw new Error(`Colonne manquante : ${col}`);
  const accepted = [];
  const rejected = [];
  for (const r of data) {
    const key = (r[idx.key] ?? '').trim();
    const value = (r[idx[locale]] ?? '').trim();
    const reject = (reason) => rejected.push({ key, reason });
    if (!key) continue;
    if (!(key in fr)) { reject('clé inconnue en FR'); continue; }
    if ((r[idx.fr] ?? '') !== fr[key]) { reject('colonne fr modifiée (fichier non conforme)'); continue; }
    if (!value) { reject('case vide (repli FR conservé)'); continue; }
    if (value.includes('�')) { reject('encodage invalide (U+FFFD) — réexporter en UTF-8'); continue; }
    if (value === fr[key]) { reject('identique au français (non traduit ?)'); continue; }
    if (tokens(value, VARS) !== tokens(fr[key], VARS)) { reject(`variables ≠ FR (attendu ${tokens(fr[key], VARS) || 'aucune'})`); continue; }
    if (tokens(value, TAGS) !== tokens(fr[key], TAGS)) { reject('balises ≠ FR'); continue; }
    if (isCritical(key) && !doubleValidated) { reject('CRITIQUE sans double validation tracée'); continue; }
    if (key in existing && !overwrite) { reject('déjà traduite (--overwrite pour remplacer)'); continue; }
    accepted.push({ key, value, critical: isCritical(key) });
  }
  return { accepted, rejected };
}

/** Insère/remplace des clés dans le bloc `const <locale>: Messages = { … };` (PURE). */
export function applyToSource(source, locale, entries) {
  const re = new RegExp(`(const ${locale}: Messages = \\{[\\s\\S]*?)(\\n\\};)`);
  const m = source.match(re);
  if (!m) throw new Error(`Bloc introuvable : ${locale}`);
  let block = m[1];
  const additions = [];
  for (const { key, value } of entries) {
    const line = `  ${JSON.stringify(key).replace(/^"|"$/g, "'")}: ${JSON.stringify(value)},`;
    const keyRe = new RegExp(`^  ['"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]: .*$`, 'm');
    if (keyRe.test(block)) block = block.replace(keyRe, line);
    else additions.push(line);
  }
  if (additions.length) block += `\n  // ── Relecture native intégrée le ${new Date().toISOString().slice(0, 10)} (import-validated.mjs) ──\n${additions.join('\n')}`;
  return source.replace(re, `${block}$2`);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const locale = arg('locale');
  const csv = arg('csv');
  const reviewer = arg('reviewer');
  const date = arg('date');
  const second = arg('second-reviewer');
  const secondDate = arg('second-date');
  const dry = process.argv.includes('--dry-run');
  if (!['fon', 'yor'].includes(locale ?? '')) throw new Error('--locale fon|yor requis');
  if (!csv || !existsSync(csv)) throw new Error('--csv <fichier> introuvable');
  if (!reviewer || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('--reviewer et --date AAAA-MM-JJ requis (traçabilité)');
  const doubleValidated = Boolean(second && /^\d{4}-\d{2}-\d{2}$/.test(secondDate ?? '') && second.trim() !== reviewer.trim());

  const source = readFileSync(MESSAGES, 'utf8');
  const fr = extractLocale(source, 'fr');
  const existing = extractLocale(source, locale);
  const { accepted, rejected } = plan({ rows: parseCsv(readFileSync(csv, 'utf8')), locale, fr, existing, doubleValidated, overwrite: process.argv.includes('--overwrite') });

  console.log(`\n${locale.toUpperCase()} — ${accepted.length} clé(s) acceptée(s) (dont ${accepted.filter((a) => a.critical).length} critiques), ${rejected.length} refusée(s)`);
  for (const r of rejected) console.log(`  ✗ ${r.key} : ${r.reason}`);
  if (dry || !accepted.length) { console.log(dry ? '\n(--dry-run : rien écrit)' : ''); return; }

  writeFileSync(MESSAGES, applyToSource(source, locale, accepted));
  if (!existsSync(TRACE)) {
    writeFileSync(TRACE, '# Traçabilité des relectures natives (B1)\n\n| Date d’intégration | Langue | Relecteur | Date | 2ᵉ relecteur (critiques) | Date | Clés | dont critiques |\n|---|---|---|---|---|---|---|---|\n');
  }
  appendFileSync(TRACE, `| ${new Date().toISOString().slice(0, 10)} | ${locale.toUpperCase()} | ${reviewer} | ${date} | ${doubleValidated ? second : '—'} | ${doubleValidated ? secondDate : '—'} | ${accepted.length} | ${accepted.filter((a) => a.critical).length} |\n`);
  console.log(`\n→ messages.ts mis à jour · traçabilité : docs/i18n/TRACABILITE_Relectures.md\n  Vérifier ensuite : pnpm i18n:check && pnpm --filter @digisante/web test`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
}
