import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSnapshot, loadPureContent } from './content.mjs';
import { CLINICAL_SCOPES, contentHash } from './check-l9-gate.mjs';
import { buildClinicalReview } from './clinical-review.mjs';
import { REFERENCES } from './review-references.mjs';

const snapshot = buildSnapshot();
const content = loadPureContent();
const review = buildClinicalReview(snapshot, content);
const find = (caseId) => review.cases.find((entry) => entry.caseId === caseId);

test('campagne couvre exactement les sept portées et lie chaque portée au contenu courant', () => {
  assert.deepEqual(review.scopes.map((entry) => entry.scope), CLINICAL_SCOPES);
  assert.ok(review.cases.length >= 30);
  assert.equal(new Set(review.cases.map((entry) => entry.caseId)).size, review.cases.length);
  for (const scope of review.scopes) {
    assert.equal(scope.contentSha256, contentHash(snapshot, scope.scope));
    assert.ok(scope.professionalProfile.trim());
    assert.ok(scope.reviewQuestions.length >= 3);
    assert.ok(review.cases.some((entry) => entry.scope === scope.scope));
  }
});

test('aucun retour humain, contreseing ou GO fabriqué ; entrées synthétiques et observations sérialisables', () => {
  for (const entry of review.cases) {
    assert.ok(CLINICAL_SCOPES.includes(entry.scope));
    assert.ok(['BLOCKER', 'REVIEW'].includes(entry.priority));
    assert.equal(entry.reviewStatus, 'OPEN');
    for (const field of ['decision', 'requiredCorrection', 'evidenceRef']) assert.equal(entry[field], '');
    for (const field of ['risk', 'question', 'proposedTechnicalHandling']) assert.ok(entry[field].trim());
    assert.ok(Array.isArray(entry.referenceIds));
  }
  assert.ok(review.reserves.every((entry) => entry.priority === 'BLOCKER' && CLINICAL_SCOPES.includes(entry.scope)));
  assert.deepEqual(JSON.parse(JSON.stringify(review)), review);
  assert.equal(JSON.stringify(review).includes('"decision":"APPROVED"'), false);
});

test('cas posologie enregistrent les divergences réelles sans les transformer en attentes médicales acceptées', () => {
  assert.equal(find('POS01').observedOutput.parsed.output.doseCount, 0);
  assert.equal(find('POS02').observedOutput.parsed.output.doseCount, 1);
  assert.equal(find('POS03').observedOutput.parsed.output.doseCount, 1);
  assert.equal(find('POS04').observedOutput.parsed.output.doseCount, 500);
  assert.equal(find('POS04').observedOutput.parsed.output.form, null);
  assert.equal(find('POS05').observedOutput.parsed.output.form, 'TABLET');
  assert.equal(find('POS05').observedOutput.parsed.output.doseCount, 500);
  assert.equal(find('POS06').observedOutput.parsed.output.doseCount, 2);
  assert.equal(find('POS07').observedOutput.parsed.output.timesPerDay, 2);
  assert.equal(find('POS08').observedOutput.parsed.output.days, 48);
  assert.deepEqual(find('POS11').observedOutput.parsed.output.timings, ['EVENING']);
  assert.equal(find('POS12').observedOutput.parsed.output.meal, 'AFTER');
  assert.equal(find('POS12').observedOutput.parsed.output.days, 7);
  assert.equal(find('POS13').observedOutput.parsed.output.days, 2);
  assert.equal(find('POS14').observedOutput.parsed.output.recognized, false);
  for (const entry of review.cases.filter((candidate) => candidate.caseId.startsWith('POS'))) {
    assert.equal(entry.observedOutput.parsed.method, 'EXECUTED_PURE_SOURCE');
    assert.deepEqual(entry.observedOutput.parsed.output, JSON.parse(JSON.stringify(content.parsePosology(entry.input))));
    assert.equal(entry.observedOutput.rendering.method, 'STATIC_SOURCE_INSPECTION');
    assert.equal(entry.observedOutput.rendering.findings.actualSpeechNotExecuted, true);
  }
});

test('chaque motif vide et tout NON sont enregistrés ; chaque signe isolé est exercé depuis les sources', () => {
  for (const flow of content.TRIAGE_FLOWS) {
    assert.equal(find(`TRI01-${flow.id}`).observedOutput.evaluation.output, 'HOME');
    assert.equal(find(`TRI04-${flow.id}`).observedOutput.output.outcome, 'HOME');
    const table = find(`TRI05-${flow.id}`).observedOutput.output;
    assert.equal(table.length, flow.questions.length);
    for (const entry of table) assert.equal(entry.outcome, entry.configuredSeverity === 'RED' ? 'EMERGENCY' : 'CONSULT');
  }
  assert.equal(find('TRI02').observedOutput.output.outcome, 'CONSULT');
  assert.equal(find('TRI03').observedOutput.output.outcome, 'CONSULT');
});

test('échéances, limite du jour et bornage CPN sont les sorties actuelles ; les références PEV restent des questions', () => {
  assert.deepEqual(find('PEV01').observedOutput.output.map((entry) => entry.dueDate), ['2026-10-28T00:00:00.000Z', '2027-04-26T00:00:00.000Z']);
  assert.equal(find('PEV02').observedOutput.output, 'OVERDUE');
  assert.equal(find('PEV03').observedOutput.status.output, 'DONE');
  assert.equal(find('CPN01').observedOutput.output.contacts.length, 8);
  assert.deepEqual(find('CPN02').observedOutput.gestationalWeeks.output.map((entry) => entry.weeks), [0, 42]);
  const referenceIds = review.cases.filter((entry) => /^PEV0[4-7]$/.test(entry.caseId)).flatMap((entry) => entry.referenceIds);
  assert.deepEqual(referenceIds, ['REF-MENA', 'REF-MALARIA-2024', 'REF-MALARIA-2025', 'REF-HPV']);
  for (const id of ['PEV04', 'PEV05', 'PEV06', 'PEV07']) assert.equal(find(id).decision, '');
});

test('questions cliniques reliées aux références consultées sans élargir automatiquement leur population ou leur objet', () => {
  const knownReferences = new Set(REFERENCES.map((entry) => entry.id));
  for (const entry of review.cases) for (const id of entry.referenceIds) assert.ok(knownReferences.has(id), `${entry.caseId}: référence absente ${id}`);
  assert.deepEqual(find('TRI02').referenceIds, ['REF-INFANT-2019', 'REF-INFANT-2024']);
  assert.match(find('TRI02').risk, /0–59 jours/);
  assert.match(find('TRI02').risk, /ne couvrent pas automatiquement/);
  assert.deepEqual(find('TRI03').referenceIds, ['REF-IMCI-2014']);
  assert.match(find('TRI03').risk, /deux mois à moins de cinq ans/);
  assert.deepEqual(find('CPN01').referenceIds, ['REF-ANC-2016', 'REF-ANC-CONTACTS', 'REF-ANC-2022']);
  assert.match(find('CPN01').risk, /spécifique à l’échographie/);
  assert.deepEqual(find('VIT01').referenceIds, ['REF-BP']);
  assert.match(find('VIT01').risk, /pas des bornes de saisie/);
  for (const entry of review.cases.filter((candidate) => /^(POS|ALL)/.test(candidate.caseId))) assert.deepEqual(entry.referenceIds, ['REF-MEDICATION']);
});

test('inspection statique, audio non exécuté et corpus éducatif inconnu restent explicitement distincts des sorties pures', () => {
  for (const id of ['VIT01', 'VIT02', 'VIT03', 'ALL01', 'ALL02', 'AUDIO01', 'EDU01']) {
    const observation = find(id).observedOutput;
    assert.equal(observation.method, 'STATIC_SOURCE_INSPECTION');
    assert.equal(observation.executedUI, false);
    assert.equal(observation.executedAPI, false);
    assert.ok(observation.sourcePaths.length);
  }
  assert.deepEqual(find('ALL01').observedOutput.findings.conflictsByCodeInspection, [[], []]);
  assert.deepEqual(find('ALL02').observedOutput.findings.conflictsByCodeInspection, []);
  assert.equal(find('AUDIO01').observedOutput.findings.actualSpeechNotExecuted, true);
  assert.equal(find('EDU01').observedOutput.findings.actualPublishedCorpus, 'UNKNOWN');
  assert.equal(find('EDU01').observedOutput.findings.productionDatabaseRead, false);
});

test('constructeur ne modifie pas l’instantané et emploie les fonctions pures fournies, jamais une sortie mise en cache', () => {
  const before = JSON.stringify(snapshot);
  const marker = { ...content, parsePosology: () => ({ syntheticTestMarker: 'FRESH_FUNCTION_RESULT_ONLY_IN_MEMORY' }) };
  const changed = buildClinicalReview(snapshot, marker);
  assert.equal(JSON.stringify(snapshot), before);
  assert.ok(changed.cases.filter((entry) => entry.caseId.startsWith('POS')).every((entry) => entry.observedOutput.parsed.output.syntheticTestMarker === 'FRESH_FUNCTION_RESULT_ONLY_IN_MEMORY'));
  const altered = structuredClone(snapshot);
  altered.messages.fr['triage.outcome.HOME.advice'] += ' TEST-CHANGED-CONTENT';
  altered.clinicalTexts.find((entry) => entry.key === 'triage.outcome.HOME.advice').fr = altered.messages.fr['triage.outcome.HOME.advice'];
  assert.notEqual(buildClinicalReview(altered, content).scopes.find((entry) => entry.scope === 'triage').contentSha256, review.scopes.find((entry) => entry.scope === 'triage').contentSha256);
});
