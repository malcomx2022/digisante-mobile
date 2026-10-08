#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Intègre des traductions FON / YOR VALIDÉES PAR DES LOCUTEURS NATIFS (chantier B1)
// depuis le CSV renvoyé par le relecteur (format de `pnpm i18n:export` : key,critical,fr,en,<locale>).
//
//   node scripts/i18n/import-validated.mjs --locale fon --csv retour.fon.csv \
//        --reviewer "Nom Prénom" --date 2026-10-01 --evidence-ref "Référence privée" \
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
//   • référence de retour privée requise (--evidence-ref), contrôles FR et EN actuels ;
//   • AUCUNE traduction n'est inventée : seules les cellules remplies sont intégrées.
// Écrit dans messages.ts (bloc de la locale) + une ligne de traçabilité
// (docs/i18n/TRACABILITE_Relectures.md : date, relecteur(s), nombre de clés — pas de contenu).
// ─────────────────────────────────────────────────────────────
import fs, { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { MESSAGES, extractLocale, isCritical } from './check-coverage.mjs';

const reviewToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

const TRACE = resolve(fileURLToPath(new URL('../../docs/i18n/TRACABILITE_Relectures.md', import.meta.url)));

/** Parse CSV RFC 4180 (guillemets doublés, retours ligne dans les champs). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closed = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error('CSV invalide : guillemet hors début de champ');
      quoted = true;
    }
    else if (c === ',') { row.push(field); field = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; closed = false;
    } else {
      if (closed) throw new Error('CSV invalide : texte après guillemet fermant');
      field += c;
    }
  }
  if (quoted) throw new Error('CSV invalide : champ non fermé');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const tokens = (s, re) => [...String(s).matchAll(re)].map((m) => m[0]).sort().join('|');
const VARS = /\{[\w.]+\}/g;
const TAGS = /<\/?[a-z][^>]*>/gi;

/** Décide pour chaque ligne : accepter ou refuser (avec raison). Fonction PURE. */
export function plan({ rows, locale, fr, en, existing, doubleValidated, overwrite = false }) {
  if (!['fon', 'yor'].includes(locale)) throw new Error('Locale native invalide');
  if (!rows.length) throw new Error('CSV vide');
  const [header, ...data] = rows;
  if (new Set(header.map((h) => h.trim())).size !== header.length) throw new Error('Colonnes CSV dupliquées');
  if (data.some((r) => r.length !== header.length)) throw new Error('Nombre de colonnes CSV incohérent');
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const col of ['key', 'fr', locale]) if (!(col in idx)) throw new Error(`Colonne manquante : ${col}`);
  if (en && !('en' in idx)) throw new Error('Colonne manquante : en');
  const keys = data.map((r) => r[idx.key].trim()).filter(Boolean);
  if (new Set(keys).size !== keys.length) throw new Error('Clés CSV dupliquées : aucun import');
  const accepted = [];
  const rejected = [];
  for (const r of data) {
    const key = (r[idx.key] ?? '').trim();
    const value = (r[idx[locale]] ?? '').trim();
    const reject = (reason) => rejected.push({ key, reason });
    if (!key) continue;
    if (!Object.hasOwn(fr, key)) { reject('clé inconnue en FR'); continue; }
    if ((r[idx.fr] ?? '') !== fr[key]) { reject('colonne fr modifiée (fichier non conforme)'); continue; }
    if (en && r[idx.en] !== en[key]) { reject('colonne en modifiée (version périmée ou fichier non conforme)'); continue; }
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
    if (keyRe.test(block)) block = block.replace(keyRe, () => line);
    else additions.push(line);
  }
  if (additions.length) block += `\n  // ── Relecture native intégrée le ${reviewToday()} (import-validated.mjs) ──\n${additions.join('\n')}`;
  return source.replace(re, (_match, _block, closing) => block + closing);
}

/** Métadonnées déclarées : vérification de forme, pas authentification du signataire. */
export function validateReview({ reviewer, date, second, secondDate, today = reviewToday() }) {
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value && value <= today;
  const identity = (name) => String(name ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
  if (!identity(reviewer) || /[\r\n|]/.test(reviewer) || !validDate(date)) throw new Error('Relecteur et date réelle non future requis');
  if (second || secondDate) {
    if (!identity(second) || /[\r\n|]/.test(second) || !validDate(secondDate) || secondDate < date || identity(second) === identity(reviewer)) throw new Error('Second relecteur distinct et date de relecture valide requis');
  }
  return Boolean(second && secondDate);
}

/** Deux fichiers : publication par rename et rollback sur erreur ; pas de promesse anti-crash. */
export function writeImport({ messagesPath, tracePath, source, updated, traceEntry }, io = fs) {
  const lock = `${messagesPath}.import-lock`;
  const fd = io.openSync(lock, 'wx');
  let temp;
  let tracePublished = false;
  const hadTrace = io.existsSync(tracePath);
  try {
    if (io.readFileSync(messagesPath, 'utf8') !== source) throw new Error('Source modifiée depuis le contrôle : recommencer');
    temp = io.mkdtempSync(resolve(dirname(messagesPath), '.native-import-'));
    const previousTrace = hadTrace ? io.readFileSync(tracePath, 'utf8') : '# Traçabilité des relectures natives (B1)\n';
    io.writeFileSync(resolve(temp, 'messages'), updated);
    io.writeFileSync(resolve(temp, 'trace'), previousTrace + traceEntry);
    if (hadTrace) io.writeFileSync(resolve(temp, 'trace-backup'), previousTrace);
    io.renameSync(resolve(temp, 'trace'), tracePath);
    tracePublished = true;
    io.renameSync(resolve(temp, 'messages'), messagesPath);
  } catch (error) {
    if (tracePublished) {
      if (hadTrace) io.renameSync(resolve(temp, 'trace-backup'), tracePath);
      else io.unlinkSync(tracePath);
    }
    throw error;
  } finally {
    if (temp) io.rmSync(temp, { recursive: true, force: true });
    io.closeSync(fd); io.unlinkSync(lock);
  }
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
  const evidence = arg('evidence-ref');
  if (!evidence?.trim() || /[\r\n]/.test(evidence)) throw new Error('--evidence-ref requis : référence du retour natif vérifié (pièce privée)');
  if (!['fon', 'yor'].includes(locale ?? '')) throw new Error('--locale fon|yor requis');
  if (!csv || !existsSync(csv)) throw new Error('--csv <fichier> introuvable');
  if (!reviewer || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('--reviewer et --date AAAA-MM-JJ requis (traçabilité)');
  const doubleValidated = validateReview({ reviewer, date, second, secondDate });

  const source = readFileSync(MESSAGES, 'utf8');
  const fr = extractLocale(source, 'fr');
  const en = extractLocale(source, 'en');
  const existing = extractLocale(source, locale);
  const csvBytes = readFileSync(csv);
  const { accepted, rejected } = plan({ rows: parseCsv(csvBytes.toString('utf8')), locale, fr, en, existing, doubleValidated, overwrite: process.argv.includes('--overwrite') });
  if (process.argv.includes('--require-all') && rejected.length) throw new Error('Import intégral refusé : corriger toutes les lignes avant écriture');

  console.log(`\n${locale.toUpperCase()} — ${accepted.length} clé(s) acceptée(s) (dont ${accepted.filter((a) => a.critical).length} critiques), ${rejected.length} refusée(s)`);
  for (const r of rejected) console.log(`  ✗ ${r.key} : ${r.reason}`);
  if (dry || !accepted.length) { console.log(dry ? '\n(--dry-run : rien écrit)' : ''); return; }

  const updated = applyToSource(source, locale, accepted);
  const row = `\n## Import ${locale.toUpperCase()} — ${reviewToday()}\n\n| Date d’intégration | Langue | Relecteur | Date | 2ᵉ relecteur (critiques) | Date | Clés | dont critiques |\n|---|---|---|---|---|---|---|---|\n| ${reviewToday()} | ${locale.toUpperCase()} | ${reviewer} | ${date} | ${doubleValidated ? second : '—'} | ${doubleValidated ? secondDate : '—'} | ${accepted.length} | ${accepted.filter((a) => a.critical).length} |\n`;
  const sha = (value) => createHash('sha256').update(value).digest('hex');
  const traceEntry = row + `\nPreuve technique : CSV SHA256 \`${sha(csvBytes)}\`, source avant \`${sha(source)}\`, après \`${sha(updated)}\`. Clés : ${accepted.map((entry) => `\`${entry.key}\``).join(', ')}. Référence de retour : ${JSON.stringify(evidence)}. Métadonnées déclarées ; vérifier la pièce et la qualité des relecteurs avant fusion.\n\n`;
  writeImport({ messagesPath: MESSAGES, tracePath: TRACE, source, updated, traceEntry });
  console.log(`\n→ messages.ts mis à jour · traçabilité : docs/i18n/TRACABILITE_Relectures.md\n  Vérifier ensuite : pnpm i18n:check && pnpm --filter @digisante/web test`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
}
