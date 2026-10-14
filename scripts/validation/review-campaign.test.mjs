import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildCampaignArtifacts, writeNewCampaign, objectsCsv } from './prepare-review-campaign.mjs';
import { buildSnapshot, ROOT, sha256 } from './content.mjs';
import { CLINICAL_SCOPES, contentHash, gateIssues } from './check-l9-gate.mjs';
import { parseCsv, plan } from '../i18n/import-validated.mjs';

test('campagne complète sans fabriquer une clôture humaine ou changer les registres', () => {
  const evidencePath = resolve(ROOT, 'docs/validation/L9/evidence.json');
  const bytes = readFileSync(evidencePath);
  const snapshot = buildSnapshot();
  const { campaign, files } = buildCampaignArtifacts(snapshot);
  assert.deepEqual(campaign.scopes.map((row) => row.scope), CLINICAL_SCOPES);
  assert.equal(campaign.nativeScopes.length, 4);
  for (const row of campaign.scopes) assert.equal(row.contentSha256, contentHash(snapshot, row.scope));
  for (const row of campaign.nativeScopes) assert.equal(row.contentSha256, contentHash(snapshot, row.scope, row.locale));
  assert.deepEqual(campaign.humanApprovals, []);
  assert.equal(campaign.runtimeEducationInventory.status, 'NOT_PROVIDED');
  assert.equal(campaign.status, 'PREPARED_FOR_REVIEW');
  assert.ok(campaign.clinicalCases >= 30);
  assert.equal(campaign.sourceQuestions.length, 13);
  const sourceManifest = JSON.parse(files['source-manifest.json']);
  for (const [name, digest] of Object.entries(sourceManifest.artifacts)) {
    assert.ok(name in files, 'Le manifest embarqué doit viser les noms réellement distribués');
    assert.equal(sha256(files[name]), digest);
  }
  for (const locale of ['fon', 'yor']) {
    const ui = parseCsv(files[`ui.${locale}.review.csv`]);
    const phrases = parseCsv(files[`phrasebook.${locale}.review.csv`]);
    assert.equal(ui.length - 1, Object.keys(snapshot.messages.fr).length);
    assert.equal(phrases.length - 1, snapshot.phrasebook.length);
    assert.ok(!ui[0].includes(locale));
    assert.throws(() => plan({ rows: ui, locale, fr: snapshot.messages.fr, en: snapshot.messages.en, existing: snapshot.messages[locale], doubleValidated: true, overwrite: true }), /colonne.*manquante/i);
  }
  assert.ok(readFileSync(evidencePath).equals(bytes));
  assert.ok(gateIssues(snapshot, JSON.parse(bytes)).length > 0);
});

test('un dossier de retours existant reste intact même si le générateur est relancé', () => {
  const temp = mkdtempSync(join(tmpdir(), 'l9-campaign-'));
  const out = join(temp, 'campaign');
  try {
    writeNewCampaign(out, { 'returns.csv': 'proposition initiale\n' });
    writeFileSync(join(out, 'returns.csv'), 'retour humain à conserver\n');
    const before = readFileSync(join(out, 'returns.csv'));
    const manifestBefore = readFileSync(join(out, 'manifest.json'));
    assert.throws(() => writeNewCampaign(out, { 'returns.csv': 'écrasement\n' }), /aucun écrasement/);
    assert.ok(readFileSync(join(out, 'returns.csv')).equals(before));
    assert.ok(readFileSync(join(out, 'manifest.json')).equals(manifestBefore));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('un contenu différent ne reprend pas l’identité ni les dates de la campagne initiale', () => {
  const snapshot = buildSnapshot();
  snapshot.sourceSnapshotSha256 = 'a'.repeat(64);
  assert.throws(() => buildCampaignArtifacts(snapshot), /Version source différente/);
});

test('le générateur refuse de sortir un fichier du dossier de campagne', () => {
  const temp = mkdtempSync(join(tmpdir(), 'l9-campaign-'));
  try {
    assert.throws(() => writeNewCampaign(join(temp, 'campaign'), { '../return.csv': 'x' }), /Nom de fichier/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('les retours CSV conservent exactement unités, accents, virgules et retours à la ligne', () => {
  const records = [{ key: 'synthetic', text: '0,5 mL — Fɔ̀ngbè\n« citation, \"texte\" »', current: { timings: ['EVENING'], days: null }, proposal: '' }];
  const parsed = parseCsv(objectsCsv(records));
  assert.deepEqual(parsed[1], ['synthetic', records[0].text, JSON.stringify(records[0].current), '']);
});
