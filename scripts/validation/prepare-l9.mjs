#!/usr/bin/env node
// Instantané unsigned régénérable ; ne remplace jamais une pièce retournée/signée.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, ROOT, sha256 } from './content.mjs';
import { isCritical } from '../i18n/check-coverage.mjs';

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const csv = (rows) => rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
export function reviewArtifacts(snapshot) {
  const files = { 'snapshot.json': JSON.stringify(snapshot, null, 2) + '\n' };
  for (const locale of ['fon', 'yor']) {
    files[`messages.${locale}.csv`] = csv([
      ['key', 'critical', 'fr', 'en', `current_${locale}`, locale],
      ...Object.keys(snapshot.messages.fr).map((key) => [key, isCritical(key) ? 'CRITIQUE' : '', snapshot.messages.fr[key], snapshot.messages.en[key], snapshot.messages[locale][key] ?? '', '']),
    ]);
    files[`phrasebook.${locale}.csv`] = csv([
      ['key', 'critical', 'category', 'fr', 'en', `current_${locale}`, locale],
      ...snapshot.phrasebook.map((p) => [p.key, 'CLINIQUE_DOUBLE_RELECTURE', p.category, p.text.FR, p.text.EN, p.text[locale.toUpperCase()] ?? '', '']),
    ]);
  }
  files['manifest.json'] = JSON.stringify({ schemaVersion: 1, sourceSnapshotSha256: snapshot.sourceSnapshotSha256, artifacts: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, sha256(value)])) }, null, 2) + '\n';
  return files;
}

export function main(args = process.argv.slice(2)) {
  const outIndex = args.indexOf('--output-dir');
  if (outIndex >= 0 && (!args[outIndex + 1] || args[outIndex + 1].startsWith('--'))) throw new Error('--output-dir exige un chemin');
  const out = resolve(outIndex >= 0 ? args[outIndex + 1] : resolve(ROOT, 'docs/validation/L9'));
  const check = args.includes('--check');
  const snapshot = buildSnapshot();
  const files = reviewArtifacts(snapshot);
  if (!check) mkdirSync(out, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    const target = resolve(out, name);
    if (check) { if (readFileSync(target, 'utf8') !== data) throw new Error(`Instantané périmé ou altéré : ${name}`); }
    else writeFileSync(target, data);
  }
  console.log(`${check ? 'Vérifié' : 'Préparé'} : ${Object.keys(files).length} artefacts, ${Object.keys(snapshot.messages.fr).length} clés UI, ${snapshot.phrasebook.length} phrases ; snapshot ${snapshot.sourceSnapshotSha256}.`);
  console.log('Pièces/relectures natives et signature clinique à vérifier séparément ; aucun GO déduit de ce contrôle.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
