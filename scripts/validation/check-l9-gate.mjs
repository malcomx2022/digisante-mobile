#!/usr/bin/env node
// Cohérence de preuves DÉCLARÉES : ne vérifie ni la signature privée ni l'habilitation.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, ROOT, sha256, SCOPE_FILES } from './content.mjs';
import { validateReview } from '../i18n/import-validated.mjs';

export const CLINICAL_SCOPES = ['triage', 'pev', 'maternity', 'phrasebook', 'prescriptions', 'vitals', 'education'];
export function contentHash(snapshot, scope, locale) {
  if (scope === 'ui') return sha256(JSON.stringify([snapshot.messages.fr, snapshot.messages.en, snapshot.messages[locale]]));
  if (scope === 'phrasebook-native') return sha256(JSON.stringify(snapshot.phrasebook.map((p) => [p.key, p.text.FR, p.text.EN, p.text[locale.toUpperCase()] ?? null])));
  const files = snapshot.sources.filter((file) => SCOPE_FILES[scope]?.includes(file.path));
  const prefixes = { pev: ['vaccine.', 'vaccinations.'], prescriptions: ['prescribe.', 'prescriptions.', 'posology.'], education: ['education.', 'edureview.'] }[scope] ?? [`${scope}.`];
  const labels = snapshot.clinicalTexts.filter((text) => prefixes.some((prefix) => text.key.startsWith(prefix)));
  return sha256(JSON.stringify({ files, labels, phrasebook: scope === 'phrasebook' ? snapshot.phrasebook.map((p) => ({ ...p, text: { FR: p.text.FR, EN: p.text.EN } })) : undefined }));
}

export function gateIssues(snapshot, evidence, today) {
  const issues = [];
  if (evidence.schemaVersion !== 1 || !Array.isArray(evidence.native) || !Array.isArray(evidence.clinical)) return ['Registre de preuves invalide'];
  const reference = (value) => typeof value === 'string' && Boolean(value.trim()) && !/[\r\n]/.test(value);
  for (const locale of ['en', 'fon', 'yor']) {
    const coverage = snapshot.coverage[locale];
    if (coverage.missing.length || coverage.invalid.length || coverage.unknown.length) issues.push(`${locale}: dictionnaire incomplet/invalide (${coverage.missing.length} manquantes)`);
  }
  for (const locale of ['fon', 'yor']) {
    if (snapshot.phrasebook.some((p) => typeof p.text[locale.toUpperCase()] !== 'string' || !p.text[locale.toUpperCase()].trim())) issues.push(`${locale}: phrasier incomplet`);
    for (const scope of ['ui', 'phrasebook-native']) {
      const records = evidence.native.filter((r) => r.locale === locale && r.scope === scope);
      const r = records[0];
      if (records.length !== 1 || r.decision !== 'APPROVED' || !reference(r.evidenceRef) || r.contentSha256 !== contentHash(snapshot, scope, locale)) { issues.push(`${locale}/${scope}: preuve absente, ambiguë ou périmée`); continue; }
      try { if (!validateReview({ reviewer: r.reviewer, date: r.date, second: r.secondReviewer, secondDate: r.secondDate, today })) throw new Error(); }
      catch { issues.push(`${locale}/${scope}: double relecture/date invalide`); }
    }
  }
  for (const scope of CLINICAL_SCOPES) {
    const records = evidence.clinical.filter((r) => r.scope === scope);
    const r = records[0];
    if (records.length !== 1 || r.decision !== 'APPROVED' || !reference(r.evidenceRef) || !reference(r.professionalCapacity) || r.contentSha256 !== contentHash(snapshot, scope)) { issues.push(`${scope}: contreseing absent, ambigu ou périmé`); continue; }
    try { validateReview({ reviewer: r.reviewer, date: r.date, today }); } catch { issues.push(`${scope}: signataire/date invalide`); }
    if (scope === 'education' && !reference(r.runtimeInventoryRef)) issues.push('education: inventaire des contenus DB à relire absent');
  }
  return issues;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const snapshot = buildSnapshot();
    const evidence = JSON.parse(readFileSync(resolve(ROOT, 'docs/validation/L9/evidence.json'), 'utf8'));
    const issues = gateIssues(snapshot, evidence);
    issues.forEach((issue) => console.error(`OUVERT : ${issue}`));
    console.log('Contrôle de cohérence uniquement : pièces privées et habilitations à vérifier par le porteur, aucun GO automatique.');
    process.exitCode = issues.length ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
