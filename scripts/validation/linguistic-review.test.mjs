import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSnapshot } from './content.mjs';
import { contentHash } from './check-l9-gate.mjs';
import { isCritical } from '../i18n/check-coverage.mjs';
import { buildLinguisticReview } from './linguistic-review.mjs';

const snapshot = buildSnapshot();
const review = buildLinguisticReview(snapshot);

test('campagne complète dans chaque langue, sans confondre présence et relecture', () => {
  for (const locale of ['fon', 'yor']) {
    const ui = review.uiSheets[locale];
    const phrases = review.phrasebookSheets[locale];
    assert.deepEqual(ui.map((row) => row.key), Object.keys(snapshot.messages.fr));
    assert.deepEqual(phrases.map((row) => row.key), snapshot.phrasebook.map((phrase) => phrase.key));
    assert.equal(new Set(ui.map((row) => row.key)).size, ui.length);
    assert.equal(new Set(phrases.map((row) => row.key)).size, phrases.length);
    assert.equal(review.stats.locales[locale].missing, snapshot.coverage[locale].missing.length);
    assert.equal(review.stats.locales[locale].missingCritical, snapshot.coverage[locale].missing.filter(isCritical).length);
    for (const row of ui) {
      assert.equal(row.fr, snapshot.messages.fr[row.key]);
      assert.equal(row.en, snapshot.messages.en[row.key]);
      assert.equal(row.currentNative, snapshot.messages[locale][row.key] ?? '');
      assert.equal(row.primaryStatus, 'OPEN');
    }
    for (const row of phrases) {
      const source = snapshot.phrasebook.find((phrase) => phrase.key === row.key);
      assert.equal(row.fr, source.text.FR);
      assert.equal(row.en, source.text.EN);
      assert.equal(row.currentNative, source.text[locale.toUpperCase()] ?? '');
    }
  }
});

test('aucun candidat, contrôle humain réussi, identité ou colonne importable fabriqué', () => {
  for (const sheets of [review.uiSheets, review.phrasebookSheets]) for (const rows of Object.values(sheets)) for (const row of rows) {
    for (const field of ['contextRoute', 'contextDescription', 'proposedNative', 'primaryNotes', 'secondaryNotes', 'issueRef']) assert.equal(row[field], '');
    for (const field of ['primaryStatus', 'secondaryStatus', 'clinicalStatus', 'reviewStatus']) assert.equal(row[field], 'OPEN');
    for (const field of ['comprehensionStatus', 'oralStatus', 'displayStatus']) assert.equal(row[field], 'NOT_RUN');
    for (const field of ['fon', 'yor', 'reviewer', 'date', 'secondReviewer', 'secondDate', 'signature', 'evidenceRef', 'decision']) assert.ok(!Object.hasOwn(row, field));
  }
  for (const row of review.glossary) {
    for (const field of ['nativeTerm', 'nativeDefinition', 'primaryNotes', 'secondaryNotes']) assert.equal(row[field], '');
    assert.equal(row.reviewStatus, 'OPEN');
  }
});

test('priorités disjointes : critiques présents inclus, médical avant parcours puis reste', () => {
  for (const locale of ['fon', 'yor']) {
    const rows = review.uiSheets[locale];
    const byKey = new Map(rows.map((row) => [row.key, row]));
    for (const row of rows.filter((row) => isCritical(row.key))) assert.equal(row.priority, 'P0');
    assert.equal(byKey.get('sos.sent').priority, 'P0');
    for (const key of ['triage.disclaimer', 'prescription.status.EXPIRED', 'posology.form.INHALER', 'offline.sos_active', 'vault.network_only']) assert.equal(byKey.get(key).priority, 'P1');
    for (const key of ['subscriptions.rights', 'beneficiaries.send_confirm', 'referrals.no_dmp_note', 'teleconsult.start']) assert.equal(byKey.get(key).priority, 'P2');
    assert.equal(byKey.get('common.close').priority, 'P3');
    assert.equal(Object.values(review.stats.locales[locale].priorities).reduce((total, group) => total + group.total, 0), rows.length);
    assert.equal(Object.values(review.stats.locales[locale].priorities).reduce((total, group) => total + group.missing, 0), review.stats.locales[locale].missing);
    for (const row of review.phrasebookSheets[locale]) {
      assert.equal(row.priority, row.category === 'EMERGENCY' ? 'Q0' : ['GREETING', 'FOLLOWUP'].includes(row.category) ? 'Q2' : 'Q1');
      assert.equal(row.critical, true);
    }
  }
  assert.deepEqual(review.stats.phrasebook.priorities, { Q0: 2, Q1: 17, Q2: 8 });
});

test('variables et balises inventoriées littéralement, doublons conservés', () => {
  const changed = structuredClone(snapshot);
  changed.messages.fr['common.synthetic_review_test'] = 'TEST {name} / {days} / {name} <b>{n}</b>';
  changed.messages.en['common.synthetic_review_test'] = 'TEST {name} / {days} / {name} <b>{n}</b>';
  const row = buildLinguisticReview(changed).uiSheets.fon.find((entry) => entry.key === 'common.synthetic_review_test');
  assert.equal(row.placeholders, '</b> | <b> | {days} | {name} | {name} | {n}');
  assert.equal(row.proposedNative, '');
  assert.equal(row.missing, true);
  assert.equal(row.priority, 'P3');
  assert.equal(review.uiSheets.fon.find((entry) => entry.key === 'beneficiaries.send_confirm').placeholders, '{amount} | {name}');
});

test('empreintes officielles par portée et source, sans mutation de l’instantané', () => {
  const original = JSON.stringify(snapshot);
  const result = buildLinguisticReview(snapshot);
  assert.equal(JSON.stringify(snapshot), original);
  for (const locale of ['fon', 'yor']) for (const [scope, rows] of [['ui', result.uiSheets[locale]], ['phrasebook-native', result.phrasebookSheets[locale]]]) {
    const expected = contentHash(snapshot, scope, locale);
    assert.ok(rows.every((row) => row.contentSha256 === expected && row.sourceSnapshotSha256 === snapshot.sourceSnapshotSha256));
  }
  const changed = structuredClone(snapshot);
  changed.messages.en['common.close'] += ' TEST SOURCE CHANGE';
  const changedReview = buildLinguisticReview(changed);
  assert.notEqual(changedReview.uiSheets.fon[0].contentSha256, result.uiSheets.fon[0].contentSha256);
  assert.equal(changedReview.phrasebookSheets.fon[0].contentSha256, result.phrasebookSheets.fon[0].contentSha256);
  const changedPhrase = structuredClone(snapshot);
  changedPhrase.phrasebook[0].text.EN += ' TEST SOURCE CHANGE';
  assert.notEqual(buildLinguisticReview(changedPhrase).phrasebookSheets.fon[0].contentSha256, result.phrasebookSheets.fon[0].contentSha256);
});

test('treize questions et quinze concepts renvoient uniquement aux sources exactes', () => {
  assert.equal(review.questions.length, 13);
  assert.equal(review.glossary.length, 15);
  assert.equal(new Set(review.questions.map((question) => question.id)).size, review.questions.length);
  assert.equal(new Set(review.glossary.map((entry) => entry.id)).size, review.glossary.length);
  for (const question of review.questions) for (const key of question.keys) {
    assert.ok(Object.hasOwn(snapshot.messages.fr, key));
    assert.ok(Object.hasOwn(snapshot.messages.en, key));
    for (const locale of ['fon', 'yor']) {
      const row = review.uiSheets[locale].find((entry) => entry.key === key);
      assert.ok(row.sourceQuestionIds.split(' | ').includes(question.id));
    }
  }
  assert.equal(review.uiSheets.fon.find((row) => row.key === 'prescribe.dosage').sourceQuestionIds, 'SQ13');
  for (const entry of review.glossary) {
    assert.equal(entry.sourceTerm, snapshot.messages.fr[entry.sourceKey]);
    for (const key of entry.exampleKeys) assert.ok(Object.hasOwn(snapshot.messages.fr, key));
  }
});

test('identité au FR signalée sans rejet automatique ni proposition fabriquée', () => {
  const row = review.uiSheets.fon.find((entry) => entry.key === 'common.fcfa');
  assert.equal(row.sameAsFrench, true);
  assert.equal(row.missing, false);
  assert.equal(row.reviewStatus, 'OPEN');
  assert.equal(row.proposedNative, '');
  assert.equal(review.uiSheets.fon.find((entry) => entry.key === 'sos.im_ok').sameAsFrench, false);
});

test('sources absentes, empreinte invalide, doublons et catégorie inconnue refusés', () => {
  for (const mutate of [
    (s) => { delete s.messages.en['common.close']; },
    (s) => { delete s.messages.fr['maternity.objective.2']; },
    (s) => { s.sourceSnapshotSha256 = 'TEST INVALID HASH'; },
    (s) => { s.phrasebook.push(structuredClone(s.phrasebook[0])); },
    (s) => { s.phrasebook[0].category = 'TEST UNREVIEWED CATEGORY'; },
    (s) => { s.phrasebook[0].text.EN = ''; },
  ]) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    assert.throws(() => buildLinguisticReview(changed));
  }
});
